import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, BrandAccent, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, type Activity } from '@/lib/api';
import { formatDuration, formatKm, formatPace, formatWhen } from '@/lib/format';

/** Historial: lista de salidas (el detalle con mapa y splits llega con el tracking). */
export default function HistorialScreen() {
  const theme = useTheme();
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    api.activities(100)
      .then((a) => { setActivities(a); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setRefreshing(false));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle" style={styles.title}>Historial</ThemedText>
        {error && <ThemedText type="small" style={styles.error}>{error}</ThemedText>}
        <FlatList
          data={activities ?? []}
          keyExtractor={(a) => String(a.id)}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
          }
          ListEmptyComponent={
            activities ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
                Todavía no registraste salidas. ¡Andá a la pestaña Correr!
              </ThemedText>
            ) : null
          }
          renderItem={({ item }) => (
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
            </View>
          )}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: { flex: 1, maxWidth: MaxContentWidth, width: '100%' },
  title: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
  error: { color: '#ff6b6b', textAlign: 'center', padding: Spacing.two },
  list: { padding: Spacing.three, paddingBottom: BottomTabInset + Spacing.three, gap: Spacing.two },
  empty: { textAlign: 'center', marginTop: Spacing.five },
  card: { borderRadius: 16, padding: Spacing.three, gap: Spacing.one },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  metrics: { alignItems: 'flex-end' },
});
