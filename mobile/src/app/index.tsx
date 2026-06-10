import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

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
          <ThemedText style={styles.brand}>
            CHRONO<ThemedText style={[styles.brand, { color: BrandAccent }]}>TRACK</ThemedText> RUN
          </ThemedText>

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
