import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import { Avatar } from '@/components/avatar';
import { PremiumUpsell } from '@/components/premium-upsell';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, BrandAccent, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError, type Ranking, type RankingEntry, type RankingScope } from '@/lib/api';
import { useEntitlement } from '@/lib/entitlement';

type Period = 'week' | 'month';
type OrderBy = 'km' | 'days_run';

/** Ranking entre amigos: pestañas Semana/Mes, ordenable por km o días corridos. */
export default function RankingScreen() {
  const theme = useTheme();
  const [period, setPeriod] = useState<Period>('week');
  const [scope, setScope] = useState<RankingScope>('friends');
  const [orderBy, setOrderBy] = useState<OrderBy>('km');
  const [ranking, setRanking] = useState<Ranking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { access } = useEntitlement();

  // Mundial es premium: si no hay acceso, mostramos el muro sin llamar al server.
  const globalLocked = scope === 'global' && !access;

  const load = useCallback(() => {
    if (scope === 'global' && !access) { setLocked(true); setRefreshing(false); return; }
    api.ranking(period, scope)
      .then((r) => { setRanking(r); setError(null); setLocked(false); })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 402) setLocked(true);
        else setError(e.message);
      })
      .finally(() => setRefreshing(false));
  }, [period, scope, access]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // En el global manda la posición real del servidor; ordenar por días es local.
  const entries =
    scope === 'global' && orderBy === 'km'
      ? (ranking?.entries ?? [])
      : [...(ranking?.entries ?? [])].sort((a, b) => b[orderBy] - a[orderBy]);

  const segmented = (
    options: { key: string; label: string }[],
    value: string,
    onChange: (v: string) => void,
  ) => (
    <View style={[styles.segmented, { backgroundColor: theme.backgroundElement }]}>
      {options.map((o) => (
        <Pressable
          key={o.key}
          onPress={() => onChange(o.key)}
          style={[styles.segment, value === o.key && { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText type="small" style={value === o.key ? { color: BrandAccent } : undefined}>
            {o.label}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );

  const renderRow = ({ item, index }: { item: RankingEntry; index: number }) => {
    const pos = scope === 'global' && orderBy === 'km' ? item.position : index + 1;
    return (
      <View
        style={[
          styles.rowCard,
          { backgroundColor: theme.backgroundElement },
          item.is_me && { borderColor: BrandAccent, borderWidth: 1 },
        ]}>
        <ThemedText type="subtitle" style={styles.position}>{pos ?? '–'}</ThemedText>
        <Avatar url={item.avatar_url} name={item.username ?? item.full_name} size={40} />
        <View style={styles.who}>
          <ThemedText type="smallBold">
            {item.username ?? item.full_name ?? 'corredor'}
            {item.is_me ? '  (vos)' : ''}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {item.days_run} {item.days_run === 1 ? 'día' : 'días'} · {item.activities}{' '}
            {item.activities === 1 ? 'salida' : 'salidas'}
          </ThemedText>
        </View>
        <ThemedText type="smallBold" style={{ color: BrandAccent }}>
          {item.km.toFixed(1).replace('.', ',')} km
        </ThemedText>
      </View>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle" style={styles.title}>Ranking</ThemedText>

        <View style={styles.controls}>
          {segmented(
            [{ key: 'friends', label: 'Amigos' }, { key: 'global', label: '🌎 Mundial' }],
            scope,
            (v) => setScope(v as RankingScope),
          )}
          {segmented(
            [{ key: 'week', label: 'Semana' }, { key: 'month', label: 'Mes' }],
            period,
            (v) => setPeriod(v as Period),
          )}
        </View>
        <View style={styles.controls}>
          {segmented(
            [{ key: 'km', label: 'por km' }, { key: 'days_run', label: 'por días' }],
            orderBy,
            (v) => setOrderBy(v as OrderBy),
          )}
        </View>

        {error && <ThemedText type="small" style={styles.error}>{error}</ThemedText>}

        {globalLocked || locked ? (
          <PremiumUpsell
            emoji="🌎"
            title="Ranking mundial"
            detail="Competí con corredores de todo el mundo y participá por premios. El ranking mundial es premium; el de amigos es gratis."
          />
        ) : (
        <FlatList
          data={entries}
          keyExtractor={(e, i) => e.username ?? String(i)}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
          }
          ListEmptyComponent={
            ranking ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
                Agregá amigos desde tu perfil para competir en el ranking.
              </ThemedText>
            ) : null
          }
          renderItem={renderRow}
        />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: { flex: 1, maxWidth: MaxContentWidth, width: '100%' },
  title: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
  controls: { flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  segmented: { flexDirection: 'row', borderRadius: 10, padding: 3 },
  segment: { paddingHorizontal: Spacing.three, paddingVertical: 6, borderRadius: 8 },
  error: { color: '#ff6b6b', textAlign: 'center', padding: Spacing.two },
  list: { padding: Spacing.three, paddingBottom: BottomTabInset + Spacing.three, gap: Spacing.two },
  empty: { textAlign: 'center', marginTop: Spacing.five },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: 16,
    padding: Spacing.three,
  },
  position: { minWidth: 36, textAlign: 'center' },
  who: { flex: 1, gap: 2 },
});
