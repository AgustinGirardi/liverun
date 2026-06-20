import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Ring } from '@/components/ring';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, BrandAccent, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, type Activity, type Profile, type Summary } from '@/lib/api';
import { formatPace } from '@/lib/format';
import { computeBadges, computeRecords, kmByWeek } from '@/lib/progress';

const num = (n: number, d = 1) => n.toFixed(d).replace('.', ',');

/** Inicio: dashboard de progreso — meta semanal, km por semana, récords y logros. */
export default function InicioScreen() {
  const theme = useTheme();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [acts, setActs] = useState<Activity[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    Promise.all([api.summary(), api.activities(100), api.profile().catch(() => null)])
      .then(([s, a, p]) => { setSummary(s); setActs(a); setProfile(p); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setRefreshing(false));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const card = [styles.card, { backgroundColor: theme.backgroundElement }];
  const week = summary?.week;
  const goalMet = week ? week.days_run >= week.goal : false;
  const records = computeRecords(acts);
  const badges = computeBadges(summary, records);
  const weeks = kmByWeek(acts, 8);
  const maxKm = Math.max(1, ...weeks.map((w) => w.km));
  const hasData = records.runs > 0;
  const name = (profile?.full_name || profile?.username || '').split(' ')[0];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
          }>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <ThemedText type="title" style={styles.hello}>
                Hola{name ? `, ${name}` : ''} 👋
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">Tu progreso de un vistazo</ThemedText>
            </View>
            {summary && summary.streak_weeks > 0 && (
              <View style={[styles.streak, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText style={styles.streakNum}>{summary.streak_weeks}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">🔥 sem</ThemedText>
              </View>
            )}
          </View>

          {error && <ThemedText type="small" style={styles.error}>{error}</ThemedText>}

          {!hasData ? (
            <View style={[card, styles.welcome]}>
              <ThemedText style={styles.welcomeEmoji}>👟</ThemedText>
              <ThemedText type="smallBold">Tu progreso aparecerá acá</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
                Registrá tu primera salida y vas a ver tu meta, el gráfico de km, tus récords y logros.
              </ThemedText>
              <Link href="/correr" asChild>
                <Pressable style={styles.cta}>
                  <ThemedText style={styles.ctaText}>▶  Salir a correr</ThemedText>
                </Pressable>
              </Link>
            </View>
          ) : (
            <>
              {/* Meta semanal + mes */}
              <View style={styles.row}>
                <View style={[card, styles.ringCard]}>
                  <Ring
                    progress={week ? week.days_run / Math.max(1, week.goal) : 0}
                    track={theme.backgroundSelected}
                    color={goalMet ? BrandAccent : BrandAccent}
                    center={`${week?.days_run ?? 0}/${week?.goal ?? 0}`}
                    sub="días"
                  />
                  <ThemedText type="smallBold" themeColor="textSecondary" style={styles.cardTitle}>
                    META SEMANAL
                  </ThemedText>
                </View>
                <View style={[card, styles.monthCard]}>
                  <ThemedText type="smallBold" themeColor="textSecondary" style={styles.cardTitle}>ESTE MES</ThemedText>
                  <ThemedText style={styles.bigNum}>{num(summary!.month.km)}<ThemedText type="small" themeColor="textSecondary"> km</ThemedText></ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {summary!.month.activities} {summary!.month.activities === 1 ? 'salida' : 'salidas'} · {summary!.month.days_run} {summary!.month.days_run === 1 ? 'día' : 'días'}
                  </ThemedText>
                  <Link href="/correr" asChild>
                    <Pressable style={styles.smallCta}>
                      <ThemedText style={styles.smallCtaText}>▶ Salir a correr</ThemedText>
                    </Pressable>
                  </Link>
                </View>
              </View>

              {/* Gráfico km por semana */}
              <View style={card}>
                <ThemedText type="smallBold" themeColor="textSecondary" style={styles.cardTitle}>KM POR SEMANA</ThemedText>
                <View style={styles.chart}>
                  {weeks.map((w, i) => (
                    <View key={i} style={styles.barCol}>
                      <View style={styles.barTrack}>
                        <View
                          style={[
                            styles.bar,
                            {
                              height: `${Math.max(3, (w.km / maxKm) * 100)}%`,
                              backgroundColor: w.isCurrent ? BrandAccent : theme.backgroundSelected,
                            },
                          ]}
                        />
                      </View>
                    </View>
                  ))}
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  Últimas 8 semanas · pico {num(maxKm)} km
                </ThemedText>
              </View>

              {/* Récords */}
              <View style={card}>
                <ThemedText type="smallBold" themeColor="textSecondary" style={styles.cardTitle}>RÉCORDS</ThemedText>
                <View style={styles.recRow}>
                  <Rec value={num(records.totalKm)} unit="km" label="total" />
                  <Rec value={String(records.runs)} label="salidas" />
                  <Rec value={num(records.longestKm)} unit="km" label="más larga" />
                  <Rec value={formatPace(records.bestPaceSPerKm).replace(' /km', '')} label="mejor ritmo" />
                </View>
              </View>

              {/* Logros */}
              <View style={card}>
                <ThemedText type="smallBold" themeColor="textSecondary" style={styles.cardTitle}>LOGROS</ThemedText>
                <View style={styles.badges}>
                  {badges.map((b) => (
                    <View
                      key={b.key}
                      style={[
                        styles.badge,
                        { backgroundColor: theme.backgroundSelected, opacity: b.earned ? 1 : 0.4 },
                        b.earned && { borderColor: BrandAccent, borderWidth: 1 },
                      ]}>
                      <ThemedText style={styles.badgeEmoji}>{b.emoji}</ThemedText>
                      <ThemedText type="small" style={styles.badgeLabel} numberOfLines={2}>{b.label}</ThemedText>
                    </View>
                  ))}
                </View>
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Rec({ value, unit, label }: { value: string; unit?: string; label: string }) {
  return (
    <View style={styles.rec}>
      <ThemedText style={styles.recValue}>
        {value}{unit ? <ThemedText type="small" themeColor="textSecondary"> {unit}</ThemedText> : null}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: { flex: 1, maxWidth: MaxContentWidth, width: '100%' },
  scroll: { padding: Spacing.three, paddingBottom: BottomTabInset + Spacing.three, gap: Spacing.three },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingTop: Spacing.one },
  hello: { fontSize: 24 },
  streak: { alignItems: 'center', borderRadius: 14, paddingVertical: 8, paddingHorizontal: 14 },
  streakNum: { fontSize: 22, fontWeight: '900', color: BrandAccent, fontVariant: ['tabular-nums'] },
  error: { color: '#ff6b6b', textAlign: 'center' },
  card: { borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  cardTitle: { letterSpacing: 2 },
  center: { textAlign: 'center' },
  row: { flexDirection: 'row', gap: Spacing.three },
  ringCard: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  monthCard: { flex: 1, justifyContent: 'center' },
  bigNum: { fontSize: 30, fontWeight: '900', fontVariant: ['tabular-nums'] },
  smallCta: { marginTop: Spacing.one, backgroundColor: BrandAccent, borderRadius: 999, paddingVertical: 9, alignItems: 'center' },
  smallCtaText: { color: '#06281d', fontWeight: '800', fontSize: 13 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 80, marginVertical: Spacing.one },
  barCol: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  barTrack: { height: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 5, minHeight: 4 },
  recRow: { flexDirection: 'row', justifyContent: 'space-between' },
  rec: { alignItems: 'center', gap: 1, flex: 1 },
  recValue: { fontSize: 19, fontWeight: '800', fontVariant: ['tabular-nums'] },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  badge: { width: '31%', alignItems: 'center', gap: 4, borderRadius: 12, paddingVertical: Spacing.three, paddingHorizontal: 4 },
  badgeEmoji: { fontSize: 26 },
  badgeLabel: { textAlign: 'center', fontWeight: '600' },
  welcome: { alignItems: 'center', paddingVertical: Spacing.five, gap: Spacing.two },
  welcomeEmoji: { fontSize: 40, lineHeight: 48 },
  cta: { marginTop: Spacing.two, backgroundColor: BrandAccent, borderRadius: 999, paddingVertical: 13, paddingHorizontal: Spacing.five, alignItems: 'center' },
  ctaText: { color: '#06281d', fontWeight: '800' },
});
