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
  const hasData = summary
    ? summary.streak_weeks > 0 || summary.week.days_run > 0 || summary.month.activities > 0
    : false;

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

          {/* Sin salidas todavía: bienvenida en lugar de tarjetas en cero */}
          {summary && !hasData && (
            <View style={[card, styles.welcomeCard]}>
              <ThemedText style={styles.welcomeEmoji}>👟</ThemedText>
              <ThemedText type="smallBold" style={styles.welcomeTitle}>
                Tu resumen aparecerá acá
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.welcomeText}>
                Cuando registres tu primera salida vas a ver tu racha, el progreso
                de la semana y los kilómetros del mes.
              </ThemedText>
            </View>
          )}

          {/* Con datos: semana destacada + fila compacta de racha y mes */}
          {summary && hasData && (
            <>
              <View style={card}>
                <ThemedText type="smallBold" themeColor="textSecondary" style={styles.cardTitle}>
                  ESTA SEMANA
                </ThemedText>
                <View style={styles.weekRow}>
                  <View style={styles.weekDays}>
                    <ThemedText type="subtitle" style={goalMet ? { color: BrandAccent } : undefined}>
                      {week!.days_run}
                      <ThemedText type="small" themeColor="textSecondary"> de {week!.goal} días</ThemedText>
                    </ThemedText>
                    <View style={styles.dots}>
                      {Array.from({ length: week!.goal }, (_, i) => (
                        <View
                          key={i}
                          style={[
                            styles.dot,
                            { backgroundColor: i < week!.days_run ? BrandAccent : theme.backgroundSelected },
                          ]}
                        />
                      ))}
                    </View>
                  </View>
                  <Stat value={week!.km.toFixed(1).replace('.', ',')} label="km" />
                </View>
              </View>

              <View style={styles.miniRow}>
                <View style={[card, styles.miniCard]}>
                  <ThemedText type="smallBold" themeColor="textSecondary" style={styles.cardTitle}>
                    RACHA
                  </ThemedText>
                  <ThemedText type="subtitle" style={{ color: BrandAccent }}>
                    {summary.streak_weeks} 🔥
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {summary.streak_weeks === 1 ? 'semana' : 'semanas'}
                  </ThemedText>
                </View>
                <View style={[card, styles.miniCard]}>
                  <ThemedText type="smallBold" themeColor="textSecondary" style={styles.cardTitle}>
                    ESTE MES
                  </ThemedText>
                  <ThemedText type="subtitle">
                    {summary.month.km.toFixed(1).replace('.', ',')}
                    <ThemedText type="small" themeColor="textSecondary"> km</ThemedText>
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {summary.month.activities} {summary.month.activities === 1 ? 'salida' : 'salidas'} ·{' '}
                    {summary.month.days_run} {summary.month.days_run === 1 ? 'día' : 'días'}
                  </ThemedText>
                </View>
              </View>
            </>
          )}
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
  cardTitle: { letterSpacing: 2 },
  stat: { gap: 2, alignItems: 'flex-end' },
  dots: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  dot: { width: 14, height: 14, borderRadius: 7 },
  weekRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  weekDays: { gap: 2 },
  miniRow: { flexDirection: 'row', gap: Spacing.three },
  miniCard: { flex: 1 },
  welcomeCard: { alignItems: 'center', paddingVertical: Spacing.five },
  welcomeEmoji: { fontSize: 40, lineHeight: 48 },
  welcomeTitle: { marginTop: Spacing.one },
  welcomeText: { textAlign: 'center', paddingHorizontal: Spacing.three },
});
