import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import { ShareCard } from '@/components/share-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, BrandAccent, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, type Activity, type ActivityDetail } from '@/lib/api';
import { goPremium } from '@/lib/billing';
import { useEntitlement } from '@/lib/entitlement';
import { formatDuration, formatKm, formatPace, formatWhen } from '@/lib/format';

const num = (n: number, d = 1) => n.toFixed(d).replace('.', ',');

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DOW = ['L', 'M', 'M', 'J', 'V', 'S', 'D']; // semana lunes–domingo
const ON_ACCENT = '#06281d';

/** Salidas: calendario de hábito (días corridos del mes) + lista de ese mes;
 *  tocar una salida despliega los splits. */
export default function HistorialScreen() {
  const theme = useTheme();
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [details, setDetails] = useState<Record<number, ActivityDetail | 'loading'>>({});
  const [expanded, setExpanded] = useState<number | null>(null);
  const [sharing, setSharing] = useState<Activity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { access } = useEntitlement();

  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth();
  const curD = now.getDate();
  const [sel, setSel] = useState({ y: curY, m: curM });

  const load = useCallback(() => {
    api.activities(100)
      .then((a) => { setActivities(a); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setRefreshing(false));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Salidas del mes seleccionado, días corridos y límites de navegación.
  const { monthRuns, runDays, monthKm, canPrev, canNext } = useMemo(() => {
    const acts = activities ?? [];
    const inMonth = acts
      .filter((a) => {
        const d = new Date(a.started_at);
        return d.getFullYear() === sel.y && d.getMonth() === sel.m;
      })
      .sort((a, b) => +new Date(b.started_at) - +new Date(a.started_at));
    const days = new Set<number>();
    let meters = 0;
    for (const a of inMonth) { days.add(new Date(a.started_at).getDate()); meters += a.distance_m; }

    const selKey = sel.y * 12 + sel.m;
    const curKey = curY * 12 + curM;
    let earliestKey = curKey;
    for (const a of acts) {
      const d = new Date(a.started_at);
      earliestKey = Math.min(earliestKey, d.getFullYear() * 12 + d.getMonth());
    }
    return {
      monthRuns: inMonth,
      runDays: days,
      monthKm: meters / 1000,
      canPrev: selKey > earliestKey,
      canNext: selKey < curKey,
    };
  }, [activities, sel, curY, curM]);

  function shift(delta: number) {
    setSel((s) => {
      const k = s.y * 12 + s.m + delta;
      return { y: Math.floor(k / 12), m: ((k % 12) + 12) % 12 };
    });
    setExpanded(null);
  }

  function tryShare(item: Activity) {
    if (access) {
      setSharing(item);
    } else {
      Alert.alert(
        '🖼 Compartir es premium',
        'Las tarjetas para compartir tus salidas son premium. ¿Querés pasarte a premium?',
        [{ text: 'Ahora no', style: 'cancel' }, { text: '⭐ Hacerme premium', onPress: goPremium }],
      );
    }
  }

  function confirmDelete(item: Activity) {
    Alert.alert(
      'Eliminar salida',
      `¿Borrar la salida de ${formatKm(item.distance_m)} del ${formatWhen(item.started_at)}? También deja de contar para tu racha y los rankings.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteActivity(item.id);
              setExpanded(null);
              setActivities((a) => a?.filter((x) => x.id !== item.id) ?? null);
            } catch (e) {
              Alert.alert('Ups', e instanceof Error ? e.message : 'No se pudo eliminar.');
            }
          },
        },
      ],
    );
  }

  function toggle(id: number) {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (!details[id]) {
      setDetails((d) => ({ ...d, [id]: 'loading' }));
      api.activityDetail(id)
        .then((det) => setDetails((d) => ({ ...d, [id]: det })))
        .catch(() => setDetails((d) => { const { [id]: _drop, ...rest } = d; return rest; }));
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle" style={styles.title}>Salidas</ThemedText>
        {error && <ThemedText type="small" style={styles.error}>{error}</ThemedText>}

        {activities == null ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>Cargando…</ThemedText>
        ) : activities.length === 0 ? (
          <View style={styles.emptyWrap}>
            <ThemedText style={styles.emptyEmoji}>👟</ThemedText>
            <ThemedText type="smallBold">Tu historial está vacío</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
              Tocá el <ThemedText type="smallBold" style={styles.accent}>botón verde ▶</ThemedText> de abajo para estrenarlo.
            </ThemedText>
          </View>
        ) : (
          <FlatList
            data={monthRuns}
            keyExtractor={(a) => String(a.id)}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
            }
            ListHeaderComponent={
              <MonthCalendar
                y={sel.y}
                m={sel.m}
                runDays={runDays}
                count={monthRuns.length}
                km={monthKm}
                isCurrentMonth={sel.y === curY && sel.m === curM}
                today={curD}
                canPrev={canPrev}
                canNext={canNext}
                onPrev={() => shift(-1)}
                onNext={() => shift(1)}
              />
            }
            ListEmptyComponent={
              <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
                Sin salidas en {MESES[sel.m].toLowerCase()}.
              </ThemedText>
            }
            renderItem={({ item }) => (
              <Pressable onPress={() => toggle(item.id)}>
                <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    {formatWhen(item.started_at)}
                  </ThemedText>
                  <View style={styles.row}>
                    <ThemedText type="subtitle" style={{ color: BrandAccent }}>
                      {formatKm(item.distance_m)}
                    </ThemedText>
                    <View style={styles.metrics}>
                      <ThemedText type="smallBold">{formatDuration(item.duration_s)}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {formatPace(item.avg_pace_s_per_km)}
                      </ThemedText>
                    </View>
                  </View>
                  {expanded === item.id && (
                    <>
                      <Splits detail={details[item.id]} dividerColor={theme.backgroundSelected} />
                      <View style={styles.actionsRow}>
                        <Pressable
                          style={[styles.shareRow, styles.actionFlex, { backgroundColor: theme.backgroundSelected }]}
                          onPress={() => tryShare(item)}>
                          <ThemedText type="smallBold" style={{ color: BrandAccent }}>
                            ↗ Compartir{access ? '' : ' ⭐'}
                          </ThemedText>
                        </Pressable>
                        <Pressable
                          style={[styles.shareRow, styles.actionFlex, { backgroundColor: theme.backgroundSelected }]}
                          onPress={() => confirmDelete(item)}>
                          <ThemedText type="smallBold" style={styles.deleteText}>
                            🗑 Eliminar
                          </ThemedText>
                        </Pressable>
                      </View>
                    </>
                  )}
                </View>
              </Pressable>
            )}
          />
        )}
        {sharing && <ShareCard activity={sharing} onClose={() => setSharing(null)} />}
      </SafeAreaView>
    </ThemedView>
  );
}

/** Calendario mensual con los días corridos marcados; navegable mes a mes. */
function MonthCalendar({
  y, m, runDays, count, km, isCurrentMonth, today, canPrev, canNext, onPrev, onNext,
}: {
  y: number; m: number; runDays: Set<number>; count: number; km: number;
  isCurrentMonth: boolean; today: number;
  canPrev: boolean; canNext: boolean; onPrev: () => void; onNext: () => void;
}) {
  const theme = useTheme();
  const firstDow = (new Date(y, m, 1).getDay() + 6) % 7; // 0 = lunes
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <View style={[styles.calCard, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.calNav}>
        <Pressable onPress={canPrev ? onPrev : undefined} hitSlop={12} style={!canPrev && styles.navOff}>
          <ThemedText style={styles.chev}>‹</ThemedText>
        </Pressable>
        <ThemedText type="smallBold">{MESES[m]} {y}</ThemedText>
        <Pressable onPress={canNext ? onNext : undefined} hitSlop={12} style={!canNext && styles.navOff}>
          <ThemedText style={styles.chev}>›</ThemedText>
        </Pressable>
      </View>

      <View style={styles.calRow}>
        {DOW.map((d, i) => (
          <ThemedText key={i} type="small" themeColor="textSecondary" style={styles.dow}>{d}</ThemedText>
        ))}
      </View>

      {weeks.map((wk, wi) => (
        <View key={wi} style={styles.calRow}>
          {wk.map((day, di) => {
            if (day == null) return <View key={di} style={styles.cell} />;
            const run = runDays.has(day);
            const isToday = isCurrentMonth && day === today;
            return (
              <View key={di} style={styles.cell}>
                <View
                  style={[
                    styles.dayDot,
                    run && { backgroundColor: BrandAccent },
                    !run && isToday && { borderColor: BrandAccent, borderWidth: 1.5 },
                  ]}>
                  <ThemedText
                    type="small"
                    style={[
                      styles.dayNum,
                      run ? styles.dayRun : { color: isToday ? BrandAccent : theme.textSecondary },
                    ]}>
                    {day}
                  </ThemedText>
                </View>
              </View>
            );
          })}
        </View>
      ))}

      <ThemedText type="small" themeColor="textSecondary" style={styles.calSummary}>
        {count > 0 ? `${count} ${count === 1 ? 'salida' : 'salidas'} · ${num(km)} km` : 'Sin salidas este mes'}
      </ThemedText>
    </View>
  );
}

function Splits({ detail, dividerColor }: { detail?: ActivityDetail | 'loading'; dividerColor: string }) {
  if (!detail || detail === 'loading') {
    return (
      <ThemedText type="small" themeColor="textSecondary">Cargando splits…</ThemedText>
    );
  }
  if (detail.splits.length === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        Sin splits (la salida no llegó al kilómetro).
      </ThemedText>
    );
  }
  const slowest = Math.max(...detail.splits);
  return (
    <View style={[styles.splits, { borderTopColor: dividerColor }]}>
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.splitsTitle}>
        SPLITS
      </ThemedText>
      {detail.splits.map((s, i) => (
        <View key={i} style={styles.splitRow}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.splitKm}>
            km {i + 1}
          </ThemedText>
          <View style={styles.splitBarTrack}>
            <View
              style={[
                styles.splitBar,
                { width: `${Math.max(8, (s / slowest) * 100)}%` as const },
              ]}
            />
          </View>
          <ThemedText type="smallBold" style={styles.splitTime}>
            {formatPace(s).replace(' /km', '')}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: { flex: 1, maxWidth: MaxContentWidth, width: '100%' },
  title: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
  error: { color: '#ff6b6b', textAlign: 'center', padding: Spacing.two },
  list: { padding: Spacing.three, paddingBottom: BottomTabInset + Spacing.three, gap: Spacing.two },
  empty: { textAlign: 'center', marginTop: Spacing.five },
  emptyWrap: { alignItems: 'center', gap: Spacing.two, marginTop: Spacing.five, paddingHorizontal: Spacing.three },
  emptyEmoji: { fontSize: 40, lineHeight: 48 },
  center: { textAlign: 'center' },
  accent: { color: BrandAccent },
  // calendario
  calCard: { borderRadius: 16, padding: Spacing.three, gap: Spacing.two, marginBottom: Spacing.two },
  calNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.one },
  chev: { fontSize: 22, fontWeight: '800', paddingHorizontal: Spacing.two },
  navOff: { opacity: 0.25 },
  calRow: { flexDirection: 'row' },
  dow: { flex: 1, textAlign: 'center' },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 3 },
  dayDot: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  dayNum: { fontVariant: ['tabular-nums'] },
  dayRun: { color: ON_ACCENT, fontWeight: '800' },
  calSummary: { textAlign: 'center', marginTop: 2 },
  // tarjetas de salida
  card: { borderRadius: 16, padding: Spacing.three, gap: Spacing.one },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  metrics: { alignItems: 'flex-end' },
  splits: { borderTopWidth: 1, marginTop: Spacing.two, paddingTop: Spacing.two, gap: 6 },
  splitsTitle: { letterSpacing: 2, marginBottom: 2 },
  splitRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  splitKm: { width: 44 },
  splitBarTrack: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  splitBar: { height: 8, borderRadius: 4, backgroundColor: BrandAccent },
  splitTime: { width: 52, textAlign: 'right' },
  shareRow: {
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: Spacing.two,
  },
  actionsRow: { flexDirection: 'row', gap: Spacing.two },
  actionFlex: { flex: 1 },
  deleteText: { color: '#ff6b6b' },
});
