import * as Crypto from 'expo-crypto';
import { useKeepAwake } from 'expo-keep-awake';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, BrandAccent, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDuration, formatPace } from '@/lib/format';
import { saveActivity } from '@/lib/run-store';
import {
  addPoint,
  autoPauseStep,
  avgPaceSPerKm,
  currentPaceSPerKm,
  encodePolyline,
  newTracker,
  type AutoPauseState,
  type TrackerState,
} from '@/lib/tracking';

type Phase = 'idle' | 'running' | 'paused' | 'autopaused' | 'saving';

/** Correr: cronómetro + GPS en primer plano, splits con voz y auto-pausa. */
export default function CorrerScreen() {
  const theme = useTheme();
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsedS, setElapsedS] = useState(0);
  const [tracker, setTracker] = useState<TrackerState>(newTracker());
  const [gpsReady, setGpsReady] = useState<boolean | null>(null);

  // Refs para que el callback del GPS y el timer vean el estado vigente.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const elapsedRef = useRef(elapsedS);
  elapsedRef.current = elapsedS;
  const trackerRef = useRef(tracker);
  trackerRef.current = tracker;
  const autoPauseRef = useRef<AutoPauseState>({ paused: false, stillSince: null });
  const startedAtRef = useRef<Date | null>(null);
  const watcherRef = useRef<Location.LocationSubscription | null>(null);

  useKeepAwake(); // pantalla encendida mientras esta pestaña está activa

  // Cronómetro: avanza solo en running (las pausas no suman tiempo neto).
  useEffect(() => {
    if (phase !== 'running') return;
    const id = setInterval(() => setElapsedS((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => () => { watcherRef.current?.remove(); }, []);

  function announceKm(km: number, splits: number[]) {
    const splitS = splits[splits.length - 1];
    const total = formatDuration(elapsedRef.current).replace(':', ' minutos ') + ' segundos';
    const pace = formatPace(splitS).replace(':', ' ').replace(' /km', ' por kilómetro');
    Speech.speak(`Kilómetro ${km}. Tiempo ${total}. Último kilómetro a ${pace}.`, { language: 'es' });
  }

  function onLocation(loc: Location.LocationObject) {
    const ph = phaseRef.current;
    if (ph !== 'running' && ph !== 'autopaused') return;

    const result = addPoint(
      trackerRef.current,
      {
        lat: loc.coords.latitude,
        lon: loc.coords.longitude,
        t: loc.timestamp,
        accuracy: loc.coords.accuracy,
      },
      elapsedRef.current,
    );

    if (result.accepted) {
      setTracker(result.state);
      if (result.completedKm) announceKm(result.completedKm, result.state.splits);

      const ap = autoPauseStep(autoPauseRef.current, result.state.speedMps, loc.timestamp);
      if (ap.paused !== autoPauseRef.current.paused) {
        setPhase(ap.paused ? 'autopaused' : 'running');
      }
      autoPauseRef.current = ap;
    }
  }

  async function start() {
    setGpsReady(null);
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setGpsReady(false);
      Alert.alert(
        'Sin permiso de ubicación',
        'Para registrar tu recorrido, permití el acceso a la ubicación en los ajustes del teléfono.',
      );
      return;
    }
    setGpsReady(true);
    setTracker(newTracker());
    setElapsedS(0);
    autoPauseRef.current = { paused: false, stillSince: null };
    startedAtRef.current = new Date();
    watcherRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 3000,
        distanceInterval: 5,
      },
      onLocation,
    );
    setPhase('running');
    Speech.speak('Salida iniciada. ¡Vamos!', { language: 'es' });
  }

  function togglePause() {
    if (phase === 'running' || phase === 'autopaused') {
      autoPauseRef.current = { paused: false, stillSince: null };
      setPhase('paused');
    } else if (phase === 'paused') {
      setPhase('running');
    }
  }

  function confirmFinish() {
    const km = (trackerRef.current.distanceM / 1000).toFixed(2);
    Alert.alert('Terminar salida', `¿Guardar esta salida de ${km} km?`, [
      { text: 'Seguir corriendo', style: 'cancel' },
      { text: 'Descartar', style: 'destructive', onPress: reset },
      { text: 'Guardar', onPress: finish },
    ]);
  }

  function reset() {
    watcherRef.current?.remove();
    watcherRef.current = null;
    setPhase('idle');
    setTracker(newTracker());
    setElapsedS(0);
  }

  async function finish() {
    watcherRef.current?.remove();
    watcherRef.current = null;
    setPhase('saving');
    const t = trackerRef.current;
    try {
      const { uploaded } = await saveActivity({
        client_uuid: Crypto.randomUUID(),
        started_at: (startedAtRef.current ?? new Date()).toISOString(),
        duration_s: Math.max(1, elapsedRef.current),
        distance_m: Math.round(t.distanceM * 10) / 10,
        avg_pace_s_per_km: avgPaceSPerKm(t.distanceM, elapsedRef.current) ?? undefined,
        splits: t.splits.map((s) => Math.round(s * 10) / 10),
        polyline: t.path.length > 1 ? encodePolyline(t.path) : undefined,
      });
      Alert.alert(
        uploaded ? '¡Salida guardada!' : 'Salida guardada en el teléfono',
        uploaded
          ? 'Ya está en tu historial.'
          : 'No hay conexión: se sube sola cuando vuelva la señal.',
      );
    } catch {
      Alert.alert('Ups', 'No se pudo guardar la salida.');
    }
    setPhase('idle');
    setTracker(newTracker());
    setElapsedS(0);
  }

  const distanceKm = (tracker.distanceM / 1000).toFixed(2).replace('.', ',');
  const avgPace = avgPaceSPerKm(tracker.distanceM, elapsedS);
  const curPace = phase === 'running' ? currentPaceSPerKm(tracker.speedMps) : null;
  const running = phase === 'running' || phase === 'autopaused' || phase === 'paused';

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        {phase === 'idle' ? (
          <View style={styles.center}>
            <ThemedText style={styles.brand}>
              CHRONO<ThemedText style={[styles.brand, { color: BrandAccent }]}>TRACK</ThemedText> RUN
            </ThemedText>
            <Pressable style={styles.bigButton} onPress={start}>
              <ThemedText style={styles.bigButtonText}>INICIAR</ThemedText>
            </Pressable>
            {gpsReady === false && (
              <ThemedText type="small" themeColor="textSecondary" style={styles.gpsHint}>
                Falta el permiso de ubicación.
              </ThemedText>
            )}
            <ThemedText type="small" themeColor="textSecondary" style={styles.gpsHint}>
              Llevá el teléfono con la app abierta durante la salida.
            </ThemedText>
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

            <ThemedText style={styles.time}>{formatDuration(elapsedS)}</ThemedText>

            <View style={styles.metricsRow}>
              <Metric value={distanceKm} label="km" big />
            </View>
            <View style={styles.metricsRow}>
              <Metric value={formatPace(avgPace).replace(' /km', '')} label="ritmo prom." />
              <Metric value={formatPace(curPace).replace(' /km', '')} label="ritmo actual" />
              <Metric value={String(tracker.splits.length)} label="splits" />
            </View>

            <View style={styles.actions}>
              <Pressable
                style={[styles.actionButton, { backgroundColor: theme.backgroundElement }]}
                onPress={togglePause}
                disabled={phase === 'saving'}>
                <ThemedText type="smallBold">
                  {phase === 'paused' ? '▶ Reanudar' : '⏸ Pausar'}
                </ThemedText>
              </Pressable>
              <Pressable
                style={[styles.actionButton, styles.finishButton]}
                onPress={confirmFinish}
                disabled={phase === 'saving'}>
                <ThemedText type="smallBold" style={styles.finishText}>
                  {phase === 'saving' ? 'Guardando…' : '⏹ Terminar'}
                </ThemedText>
              </Pressable>
            </View>
          </View>
        )}
        {running && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.gpsFooter}>
            GPS activo · la pantalla queda encendida
          </ThemedText>
        )}
      </SafeAreaView>
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
  bigButton: {
    backgroundColor: BrandAccent,
    width: 180,
    height: 180,
    borderRadius: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigButtonText: { color: '#000', fontSize: 24, fontWeight: '900', letterSpacing: 2 },
  gpsHint: { textAlign: 'center', paddingHorizontal: Spacing.four },
  badge: { paddingHorizontal: Spacing.three, paddingVertical: 6, borderRadius: 99 },
  time: { fontSize: 72, lineHeight: 80, fontWeight: '900', fontVariant: ['tabular-nums'] },
  metricsRow: { flexDirection: 'row', gap: Spacing.five },
  metric: { alignItems: 'center', gap: 2 },
  metricBig: { fontSize: 56, lineHeight: 62, fontWeight: '800', color: BrandAccent },
  metricValue: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
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
});
