import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link, useFocusEffect } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, BrandAccent, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, type Summary } from '@/lib/api';

/** Inicio: racha semanal, progreso de la semana contra la meta y resumen del mes. */
export default function InicioScreen() {
  const theme = useTheme();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    api.summary()
      .then((s) => { setSummary(s); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setRefreshing(false));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const card = [styles.card, { backgroundColor: theme.backgroundElement }];
  const week = summary?.week;
  const goalMet = week ? week.days_run >= week.goal : false;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
          }>
          {/* Hero de marca: degradado mint→teal con sombra interna */}
          <LinearGradient
            colors={['#00bf85', '#00e5a0']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.hero}>
            <View style={styles.heroShade} />
            <ThemedText style={styles.heroBrand}>CHRONOTRACK RUN</ThemedText>
            <ThemedText style={styles.heroTitle}>
              {goalMet ? '¡Meta de la semana cumplida! 💪' : '¿Salimos a correr hoy?'}
            </ThemedText>
            <ThemedText style={styles.heroSub}>
              {summary && summary.streak_weeks > 0
                ? `Llevás ${summary.streak_weeks} ${summary.streak_weeks === 1 ? 'semana' : 'semanas'} de racha 🔥 — no la cortes.`
                : 'Cada salida suma. Arrancá tu racha esta semana.'}
            </ThemedText>
            <Link href="/correr" asChild>
              <Pressable style={styles.heroButton}>
                <ThemedText style={styles.heroButtonText}>▶  EMPEZAR UNA SALIDA</ThemedText>
              </Pressable>
            </Link>
          </LinearGradient>

          {error && (
            <ThemedText type="small" style={styles.error}>{error}</ThemedText>
          )}

          {/* Racha */}
          <View style={[card, styles.streakCard]}>
            <ThemedText style={styles.streakNumber}>
              {summary ? summary.streak_weeks : '–'}
            </ThemedText>
            <ThemedText type="smallBold">
              {summary?.streak_weeks === 1 ? 'semana de racha' : 'semanas de racha'} 🔥
            </ThemedText>
          </View>

          {/* Semana */}
          <View style={card}>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.cardTitle}>
              ESTA SEMANA
            </ThemedText>
            <View style={styles.row}>
              <Stat value={week ? `${week.days_run}/${week.goal}` : '–'} label="días (meta)" highlight={goalMet} />
              <Stat value={week ? week.km.toFixed(1).replace('.', ',') : '–'} label="km" />
            </View>
            <View style={styles.dots}>
              {week &&
                Array.from({ length: week.goal }, (_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.dot,
                      { backgroundColor: i < week.days_run ? BrandAccent : theme.backgroundSelected },
                    ]}
                  />
                ))}
            </View>
          </View>

          {/* Mes */}
          <View style={card}>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.cardTitle}>
              ESTE MES
            </ThemedText>
            <View style={styles.row}>
              <Stat value={summary ? summary.month.km.toFixed(1).replace('.', ',') : '–'} label="km" />
              <Stat value={summary ? String(summary.month.activities) : '–'} label="salidas" />
              <Stat value={summary ? String(summary.month.days_run) : '–'} label="días" />
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Stat({ value, label, highlight }: { value: string; label: string; highlight?: boolean }) {
  return (
    <View style={styles.stat}>
      <ThemedText type="subtitle" style={highlight ? { color: BrandAccent } : undefined}>
        {value}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: { flex: 1, maxWidth: MaxContentWidth },
  scroll: {
    padding: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
    gap: Spacing.three,
  },
  brand: { fontSize: 12, fontWeight: '900', letterSpacing: 3, textAlign: 'center', marginVertical: Spacing.two },
  hero: {
    borderRadius: 20,
    padding: Spacing.four,
    gap: Spacing.two,
    overflow: 'hidden',
  },
  heroShade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  heroBrand: { fontSize: 11, fontWeight: '900', letterSpacing: 3, color: 'rgba(0,0,0,0.65)' },
  heroTitle: { fontSize: 28, lineHeight: 33, fontWeight: '900', color: '#06281d' },
  heroSub: { fontSize: 14, lineHeight: 19, color: 'rgba(2,40,29,0.85)' },
  heroButton: {
    backgroundColor: '#06281d',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  heroButtonText: { color: '#00e5a0', fontWeight: '900', letterSpacing: 1, fontSize: 14 },
  error: { color: '#ff6b6b', textAlign: 'center' },
  card: { borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  streakCard: { alignItems: 'center' },
  streakNumber: { fontSize: 64, lineHeight: 72, fontWeight: '900', color: BrandAccent },
  cardTitle: { letterSpacing: 2 },
  row: { flexDirection: 'row', gap: Spacing.four },
  stat: { gap: 2 },
  dots: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  dot: { width: 14, height: 14, borderRadius: 7 },
});
