import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import { ShareCard } from '@/components/share-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, BrandAccent, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, type Activity, type ActivityDetail } from '@/lib/api';
import { formatDuration, formatKm, formatPace, formatWhen } from '@/lib/format';

/** Historial: lista de salidas; tocar una despliega los splits km a km. */
export default function HistorialScreen() {
  const theme = useTheme();
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [details, setDetails] = useState<Record<number, ActivityDetail | 'loading'>>({});
  const [expanded, setExpanded] = useState<number | null>(null);
  const [sharing, setSharing] = useState<Activity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    api.activities(100)
      .then((a) => { setActivities(a); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setRefreshing(false));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

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
                    <Pressable
                      style={[styles.shareRow, { backgroundColor: theme.backgroundSelected }]}
                      onPress={() => setSharing(item)}>
                      <ThemedText type="smallBold" style={{ color: BrandAccent }}>
                        ↗ Compartir tarjeta
                      </ThemedText>
                    </Pressable>
                  </>
                )}
              </View>
            </Pressable>
          )}
        />
        {sharing && <ShareCard activity={sharing} onClose={() => setSharing(null)} />}
      </SafeAreaView>
    </ThemedView>
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
});
