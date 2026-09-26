import * as Crypto from 'expo-crypto';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RouteMap } from '@/components/route-map';
import { StoryCard } from '@/components/story-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, BrandAccent, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, type Activity, type MotivoError, type NewActivity } from '@/lib/api';
import { useEntitlement } from '@/lib/entitlement';
import { formatDuration, formatKm, formatPace, formatWhen } from '@/lib/format';
import { detenerTareaUbicacion, LOCATION_TASK } from '@/lib/location-task';
import { runSession, type FinishData } from '@/lib/run-session';
import { clearSessionSnapshot, enqueueActivity, isQueued, loadSessionSnapshot, syncPending } from '@/lib/run-store';
import { encodePolyline } from '@/lib/tracking';

// Suscripción del watcher de primer plano a nivel de módulo: sobrevive a
// cambios de pestaña, así la salida sigue corriendo. La tarea de background NO
// se recuerda en una bandera (se perdía si el SO relanzaba la app): se le
// pregunta al SO cada vez (ver detenerTareaUbicacion).
let fgWatcher: Location.LocationSubscription | null = null;

/** Correr: cronómetro + GPS, sigue registrando con la pantalla bloqueada
 *  (en un build de desarrollo; en Expo Go usa el watcher de primer plano). */
export default function CorrerScreen() {
  const theme = useTheme();
  const [, force] = useReducer((x) => x + 1, 0);
  const [lastActivity, setLastActivity] = useState<Activity | null>(null);
  const [gpsDenied, setGpsDenied] = useState(false);
  const [bgActive, setBgActive] = useState(false);
  const [photoData, setPhotoData] = useState<FinishData | null>(null);
  const { access } = useEntitlement();
  const startingRef = useRef(false);

  useEffect(() => { runSession.setVoice(access); }, [access]);

  // Re-render ante cualquier cambio de la sesión (km, pausa, etc.).
  useEffect(() => runSession.subscribe(force), []);

  // Recuperación: si la app se cerró con una salida en curso, ofrecer retomarla.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (runSession.snapshot().phase !== 'idle') return;
      const saved = await loadSessionSnapshot();
      if (!alive || runSession.snapshot().phase !== 'idle') return;
      if (!saved) {
        // Sin salida en curso: si la app murió con la tarea de GPS prendida,
        // apagarla (si no, queda gastando batería y con la notificación).
        await detenerTareaUbicacion();
        return;
      }
      // La app murió después de escribir la salida en la cola (durante
      // "Guardando…"): ya está a salvo, no ofrecerla de nuevo.
      if (saved.clientUuid && (await isQueued(saved.clientUuid))) {
        await clearSessionSnapshot();
        if (runSession.snapshot().phase === 'idle') await detenerTareaUbicacion();
        return;
      }
      if (!alive || runSession.snapshot().phase !== 'idle') return;
      runSession.restoreFrom(saved); // queda en pausa, con el tiempo neto congelado
      const km = (saved.tracker.distanceM / 1000).toFixed(2).replace('.', ',');
      Alert.alert(
        'Salida recuperada',
        `La app se cerró con una salida en curso (${km} km). Quedó en pausa: podés seguir corriendo o guardarla.`,
        [
          // Descartar pide una segunda confirmación (no se puede deshacer).
          { text: 'Descartar…', onPress: confirmDiscard },
          { text: 'Guardar', onPress: finish },
          { text: 'Seguir corriendo', onPress: () => { void reanudar(); } },
        ],
      );
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const snap = runSession.snapshot();
  const phase = snap.phase;
  const active = phase === 'running' || phase === 'autopaused';

  // Tick de 1 s para el cronómetro mientras corre.
  useEffect(() => {
    if (!active) return;
    const id = setInterval(force, 1000);
    return () => clearInterval(id);
  }, [active]);

  // Pantalla encendida sólo mientras hay salida en curso.
  useEffect(() => {
    if (phase === 'idle') { deactivateKeepAwake().catch(() => {}); return; }
    activateKeepAwakeAsync().catch(() => {});
  }, [phase]);

  useFocusEffect(
    useCallback(() => {
      if (runSession.snapshot().phase === 'idle') {
        api.activities(1).then((a) => setLastActivity(a[0] ?? null)).catch(() => {});
      }
    }, []),
  );

  async function stopUpdates() {
    fgWatcher?.remove();
    fgWatcher = null;
    await detenerTareaUbicacion();
    setBgActive(false);
  }

  /** Conecta el GPS a la sesión: background si se puede (o ya está corriendo),
   *  si no el watcher de primer plano. Reutilizado al iniciar y al recuperar.
   *  Tira error si no hay forma de recibir ubicaciones. */
  async function ensureWatchers(): Promise<void> {
    // Intentar tracking en background (pantalla bloqueada). En Expo Go o sin
    // permiso de fondo, cae al watcher de primer plano.
    let backgroundOk = false;
    try {
      if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
        // La tarea sobrevivió al cierre de la app: reconectar sin reiniciarla.
        backgroundOk = true;
      } else {
        const bg = await Location.requestBackgroundPermissionsAsync();
        if (bg.status === 'granted') {
          await Location.startLocationUpdatesAsync(LOCATION_TASK, {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 2000,
            distanceInterval: 5,
            pausesUpdatesAutomatically: false,
            showsBackgroundLocationIndicator: true,
            activityType: Location.ActivityType.Fitness,
            foregroundService: {
              notificationTitle: 'LiveRun',
              notificationBody: 'Registrando tu salida…',
              notificationColor: '#00e5a0',
            },
          });
          backgroundOk = true;
        }
      }
    } catch {
      backgroundOk = false;
    }
    setBgActive(backgroundOk);

    if (!backgroundOk && !fgWatcher) {
      fgWatcher = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 3000, distanceInterval: 5 },
        (loc) =>
          runSession.ingest([
            {
              coords: {
                latitude: loc.coords.latitude,
                longitude: loc.coords.longitude,
                accuracy: loc.coords.accuracy,
                speed: loc.coords.speed,
              },
              timestamp: loc.timestamp,
            },
          ]),
      );
    }
  }

  /** Aviso con botón directo a los ajustes del teléfono. */
  function avisarConAjustes(titulo: string, mensaje: string) {
    Alert.alert(titulo, mensaje, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Abrir ajustes', onPress: () => { Linking.openSettings().catch(() => {}); } },
    ]);
  }

  /** Conecta el GPS; si no se puede (ubicación del teléfono apagada, permiso
   *  revocado) avisa con acceso a Ajustes y devuelve false. */
  async function conectarGps(): Promise<boolean> {
    try {
      if (!(await Location.hasServicesEnabledAsync())) throw new Error('ubicación apagada');
      await ensureWatchers();
      return true;
    } catch {
      avisarConAjustes(
        'No se pudo activar el GPS',
        'Revisá que la ubicación del teléfono esté prendida y que LiveRun tenga permiso de ubicación.',
      );
      return false;
    }
  }

  async function start() {
    if (startingRef.current) return;
    startingRef.current = true;
    setGpsDenied(false);
    try {
      const fg = await Location.requestForegroundPermissionsAsync();
      if (fg.status !== 'granted') {
        setGpsDenied(true);
        avisarConAjustes(
          'Sin permiso de ubicación',
          'Para registrar tu recorrido, permití el acceso a la ubicación en los ajustes del teléfono.',
        );
        return;
      }
      // El id de la salida se fija acá (no al guardar): reintentos y
      // recuperaciones reusan el mismo y el backend no la duplica.
      runSession.start(Crypto.randomUUID());
      if (!(await conectarGps())) {
        // Sin GPS no hay salida: no dejarla "corriendo" en el vacío.
        await stopUpdates();
        runSession.reset();
      }
    } catch {
      await stopUpdates();
      runSession.reset();
      avisarConAjustes('No se pudo iniciar la salida', 'Revisá la ubicación del teléfono e intentá de nuevo.');
    } finally {
      startingRef.current = false;
    }
  }

  /** Reanuda reconectando el GPS (tras una recuperación o un guardado fallido
   *  los watchers pueden estar caídos; si ya están vivos no cuesta nada). */
  async function reanudar() {
    if (await conectarGps()) runSession.resume();
  }

  function togglePause() {
    if (active) {
      runSession.pause();
    } else if (phase === 'paused') {
      void reanudar();
    }
  }

  function confirmFinish() {
    const km = (snap.distanceM / 1000).toFixed(2).replace('.', ',');
    // Solo dos opciones: descartar vive aparte (link en pausa) y con doble
    // confirmación, para que no se toque por error al lado de Guardar.
    Alert.alert('Terminar salida', `¿Guardar esta salida de ${km} km?`, [
      { text: 'Seguir corriendo', style: 'cancel' },
      { text: 'Guardar', onPress: finish },
    ]);
  }

  /** Segunda confirmación explícita antes de borrar la salida. */
  function confirmDiscard() {
    const s = runSession.snapshot();
    const km = (s.distanceM / 1000).toFixed(2).replace('.', ',');
    const min = Math.round(s.elapsedS / 60);
    Alert.alert('¿Descartar la salida?', `Se borran ${km} km y ${min} min. No se puede deshacer.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sí, descartar', style: 'destructive', onPress: discard },
    ]);
  }

  async function discard() {
    await stopUpdates();
    runSession.reset();
  }

  async function finish() {
    if (runSession.snapshot().phase === 'saving') return;
    await stopUpdates();
    const data = runSession.finishData();
    runSession.markSaving();
    const activity: NewActivity = {
      client_uuid: data.clientUuid ?? Crypto.randomUUID(),
      started_at: data.startedAt.toISOString(),
      duration_s: data.durationS,
      distance_m: Math.round(data.distanceM * 10) / 10,
      avg_pace_s_per_km: data.avgPaceSPerKm ?? undefined,
      splits: data.splits.map((s) => Math.round(s * 10) / 10),
      polyline: data.path.length > 1 ? encodePolyline(data.path) : undefined,
    };
    try {
      // Solo se espera la escritura local; la subida sigue en segundo plano.
      await enqueueActivity(activity);
    } catch {
      // No descartar: la salida vuelve a pausa y se puede reintentar.
      runSession.abortSaving();
      Alert.alert('Ups', 'No se pudo guardar la salida en el teléfono. Quedó en pausa: tocá Terminar para reintentar.');
      return;
    }
    // Ya está en la cola: se borra el snapshot, así si la app muere ahora no
    // aparece además como "Salida recuperada".
    runSession.reset();
    setPhotoData(data); // ofrecer capturar el momento con la cámara
    void subirEnSegundoPlano(activity.client_uuid);
  }

  /** Sube la cola sin bloquear la pantalla; si esta salida queda pendiente,
   *  explica por qué (sin red / servidor). La sesión vencida la avisa el
   *  AuthProvider, que además cierra la sesión. */
  async function subirEnSegundoPlano(clientUuid: string) {
    let motivo: MotivoError | null = 'servidor';
    try {
      const res = await syncPending();
      const rechazo = res.rechazadas.find((r) => r.actividad.client_uuid === clientUuid);
      if (rechazo) {
        Alert.alert(
          'No se pudo registrar la salida',
          rechazo.detalle || 'El servidor la rechazó porque los datos no son válidos.',
        );
        return;
      }
      if (!res.pending.some((a) => a.client_uuid === clientUuid)) return;
      motivo = res.motivo;
    } catch {
      // motivo queda 'servidor'
    }
    if (motivo === 'sesion') return;
    Alert.alert(
      'Salida guardada en el teléfono',
      motivo === 'sin-red'
        ? 'No hay conexión: se sube sola cuando vuelva la señal.'
        : 'El servidor no la pudo recibir ahora. Queda guardada y se reintenta sola; mientras, la ves en Salidas como "Pendiente de subir".',
    );
  }

  const distanceKm = (snap.distanceM / 1000).toFixed(2).replace('.', ',');
  const avgPace = snap.avgPaceSPerKm;
  const curPace = snap.curPaceSPerKm;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        {phase === 'idle' ? (
          <View style={styles.idleWrap}>
            <View style={styles.idleTop}>
              <ThemedText style={styles.brand}>
                LIVE<ThemedText style={[styles.brand, { color: BrandAccent }]}>RUN</ThemedText>
              </ThemedText>
              <ThemedText type="subtitle" style={styles.idleTitle}>¿Listo para salir?</ThemedText>
            </View>

            {lastActivity ? (
              <View style={[styles.lastCard, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText type="smallBold" themeColor="textSecondary" style={styles.lastTitle}>
                  TU ÚLTIMA SALIDA
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {formatWhen(lastActivity.started_at)}
                </ThemedText>
                <View style={styles.lastRow}>
                  <ThemedText type="subtitle" style={{ color: BrandAccent }}>
                    {formatKm(lastActivity.distance_m)}
                  </ThemedText>
                  <View style={styles.lastMetrics}>
                    <ThemedText type="smallBold">{formatDuration(lastActivity.duration_s)}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {formatPace(lastActivity.avg_pace_s_per_km)}
                    </ThemedText>
                  </View>
                </View>
                <ThemedText type="small" themeColor="textSecondary">¿La superamos hoy?</ThemedText>
              </View>
            ) : (
              <View style={[styles.lastCard, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText style={styles.lastEmoji}>🏃</ThemedText>
                <ThemedText type="smallBold" style={styles.lastCenter}>Tu primera salida te espera</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.lastCenter}>
                  Tiempo, distancia, ritmo y splits por km, con avisos de voz.
                </ThemedText>
              </View>
            )}

            <View style={styles.idleBottom}>
              {gpsDenied && (
                <ThemedText type="small" themeColor="textSecondary" style={styles.gpsHint}>
                  Falta el permiso de ubicación.
                </ThemedText>
              )}
              <Pressable onPress={start} style={({ pressed }) => pressed && styles.pressed}>
                <LinearGradient
                  colors={['#00bf85', '#00e5a0']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.startButton}>
                  <ThemedText style={styles.startButtonText}>▶  INICIAR SALIDA</ThemedText>
                </LinearGradient>
              </Pressable>
              <ThemedText type="small" themeColor="textSecondary" style={styles.gpsHint}>
                Podés bloquear la pantalla: la salida sigue registrándose.
                {!access ? ' Los avisos de voz por km son premium ⭐' : ''}
              </ThemedText>
            </View>
          </View>
        ) : (
          <View style={styles.center}>
            {phase === 'autopaused' && (
              <View style={[styles.badge, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText type="smallBold" style={{ color: BrandAccent }}>AUTO-PAUSA</ThemedText>
              </View>
            )}
            {phase === 'paused' && (
              <View style={[styles.badge, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText type="smallBold" themeColor="textSecondary">PAUSADO</ThemedText>
              </View>
            )}

            <ThemedText style={styles.time}>{formatDuration(snap.elapsedS)}</ThemedText>

            <View style={styles.metricsRow}>
              <Metric value={distanceKm} label="km" big />
            </View>
            <View style={styles.metricsRow}>
              <Metric value={formatPace(avgPace).replace(' /km', '')} label="ritmo prom." />
              <Metric value={formatPace(curPace).replace(' /km', '')} label="ritmo actual" />
              <Metric value={String(snap.splits.length)} label="splits" />
            </View>

            {snap.path.length > 1 && (
              <RouteMap path={snap.path} live height={170} style={styles.liveMap} />
            )}

            <View style={styles.actions}>
              <Pressable
                style={({ pressed }) => [styles.actionButton, { backgroundColor: theme.backgroundElement }, pressed && styles.pressed]}
                onPress={togglePause}
                disabled={phase === 'saving'}>
                <ThemedText type="smallBold">
                  {phase === 'paused' ? '▶ Reanudar' : '⏸ Pausar'}
                </ThemedText>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.actionButton, styles.finishButton, pressed && styles.pressed]}
                onPress={confirmFinish}
                disabled={phase === 'saving'}>
                <ThemedText type="smallBold" style={styles.finishText}>
                  {phase === 'saving' ? 'Guardando…' : '⏹ Terminar'}
                </ThemedText>
              </Pressable>
            </View>
            {phase === 'paused' && (
              // Acción secundaria y lejos de Guardar: pide confirmación aparte.
              <Pressable onPress={confirmDiscard} hitSlop={12} style={styles.discardLink}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.discardText}>
                  Descartar salida
                </ThemedText>
              </Pressable>
            )}
          </View>
        )}
        {phase !== 'idle' && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.gpsFooter}>
            {bgActive ? 'GPS activo · seguí con la pantalla bloqueada' : 'GPS activo · mantené la app abierta'}
          </ThemedText>
        )}
      </SafeAreaView>

      {photoData && (
        <StoryCard
          stats={{
            km: formatKm(photoData.distanceM),
            time: formatDuration(photoData.durationS),
            pace: formatPace(photoData.avgPaceSPerKm).replace(' /km', ''),
            speed:
              photoData.durationS > 0
                ? ((photoData.distanceM / photoData.durationS) * 3.6).toFixed(1).replace('.', ',')
                : undefined,
          }}
          polyline={photoData.path.length > 1 ? encodePolyline(photoData.path) : undefined}
          onClose={() => setPhotoData(null)}
        />
      )}
    </ThemedView>
  );
}

function Metric({ value, label, big }: { value: string; label: string; big?: boolean }) {
  return (
    <View style={styles.metric}>
      <ThemedText style={big ? styles.metricBig : styles.metricValue}>{value}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
    width: '100%',
    paddingBottom: BottomTabInset + Spacing.three,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  brand: { fontSize: 12, fontWeight: '900', letterSpacing: 3 },
  idleWrap: { flex: 1, paddingHorizontal: Spacing.three, justifyContent: 'space-between' },
  idleTop: { alignItems: 'center', gap: Spacing.two, paddingTop: Spacing.four },
  idleTitle: { textAlign: 'center' },
  lastCard: { borderRadius: 16, padding: Spacing.four, gap: Spacing.one },
  lastTitle: { letterSpacing: 2 },
  lastRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  lastMetrics: { alignItems: 'flex-end' },
  lastEmoji: { fontSize: 40, lineHeight: 48, textAlign: 'center' },
  lastCenter: { textAlign: 'center' },
  idleBottom: { gap: Spacing.two, paddingBottom: Spacing.two },
  startButton: {
    borderRadius: 99,
    paddingVertical: 18,
    alignItems: 'center',
  },
  startButtonText: { color: '#06281d', fontSize: 17, fontWeight: '900', letterSpacing: 1.5 },
  gpsHint: { textAlign: 'center', paddingHorizontal: Spacing.four },
  badge: { paddingHorizontal: Spacing.three, paddingVertical: 6, borderRadius: 99 },
  time: { fontSize: 72, lineHeight: 80, fontWeight: '900', fontVariant: ['tabular-nums'] },
  metricsRow: { flexDirection: 'row', gap: Spacing.five },
  metric: { alignItems: 'center', gap: 2 },
  metricBig: { fontSize: 56, lineHeight: 62, fontWeight: '800', color: BrandAccent },
  metricValue: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  liveMap: { alignSelf: 'stretch', marginHorizontal: Spacing.three, marginTop: Spacing.two },
  actions: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.four },
  actionButton: {
    paddingHorizontal: Spacing.four,
    paddingVertical: 14,
    borderRadius: 14,
    minWidth: 140,
    alignItems: 'center',
  },
  finishButton: { backgroundColor: BrandAccent },
  finishText: { color: '#000' },
  gpsFooter: { textAlign: 'center' },
  discardLink: { marginTop: Spacing.two, paddingVertical: Spacing.one },
  discardText: { textDecorationLine: 'underline' },
  pressed: { opacity: 0.9, transform: [{ scale: 0.97 }] },
});
