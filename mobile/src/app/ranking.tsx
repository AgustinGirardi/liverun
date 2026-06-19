import { useCallback, useState } from 'react';
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl, Share, StyleSheet,
  TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import { Avatar } from '@/components/avatar';
import { PremiumUpsell } from '@/components/premium-upsell';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, BrandAccent, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  api, ApiError, type FriendLists, type Ranking, type RankingEntry,
  type RankingScope, type SearchedUser,
} from '@/lib/api';
import { useEntitlement } from '@/lib/entitlement';

type Period = 'week' | 'month';
type OrderBy = 'km' | 'days_run';

const PORTAL_URL = 'https://chronotrack-portal.onrender.com';
const MEDALS = ['🥇', '🥈', '🥉'];

const fmtKm = (km: number) => `${km.toFixed(1).replace('.', ',')} km`;

/** Ranking práctico: buscador para agregar amigos, podio, mi posición y compartir. */
export default function RankingScreen() {
  const theme = useTheme();
  const [period, setPeriod] = useState<Period>('week');
  const [scope, setScope] = useState<RankingScope>('friends');
  const [orderBy, setOrderBy] = useState<OrderBy>('km');
  const [ranking, setRanking] = useState<Ranking | null>(null);
  const [friends, setFriends] = useState<FriendLists | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { access } = useEntitlement();

  // Buscador
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchedUser[]>([]);
  const [searching, setSearching] = useState(false);
  // Solicitudes entrantes desplegadas
  const [showRequests, setShowRequests] = useState(false);

  const globalLocked = scope === 'global' && !access;

  const load = useCallback(() => {
    api.friends().then(setFriends).catch(() => {});
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

  async function runSearch(q: string) {
    setQuery(q);
    if (q.trim().length < 3) { setResults([]); return; }
    setSearching(true);
    try { setResults(await api.searchFriends(q.trim())); }
    catch { /* best-effort */ }
    finally { setSearching(false); }
  }

  async function addFriend(u: SearchedUser) {
    if (!u.username) return;
    setResults((prev) => prev.map((r) => (r.username === u.username ? { ...r, relation: 'pending' } : r)));
    try { await api.requestFriend(u.username); } catch { load(); }
  }

  async function accept(friendshipId: number) {
    try { await api.acceptFriend(friendshipId); load(); } catch { /* noop */ }
  }

  const entries =
    scope === 'global' && orderBy === 'km'
      ? (ranking?.entries ?? [])
      : [...(ranking?.entries ?? [])].sort((a, b) => b[orderBy] - a[orderBy]);

  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3);
  const me = entries.find((e) => e.is_me);
  const meOutsideList = me && scope === 'global' && !entries.slice(0, 50).some((e) => e.is_me);

  async function shareRanking() {
    const scopeLabel = scope === 'friends' ? 'mis amigos' : 'el mundial';
    const periodLabel = period === 'week' ? 'esta semana' : 'este mes';
    const lines = entries.slice(0, 5).map((e, i) => {
      const pos = scope === 'global' && orderBy === 'km' ? e.position : i + 1;
      return `${MEDALS[i] ?? `${pos}.`} ${e.username ?? e.full_name ?? 'corredor'} — ${fmtKm(e.km)}`;
    });
    const mine = me ? `\nYo voy ${fmtKm(me.km)} 💪` : '';
    await Share.share({
      message:
        `🏃 Ranking ChronoTrack Run · ${scopeLabel} · ${periodLabel}\n\n` +
        `${lines.join('\n')}${mine}\n\n¿Me ganás? Sumate y competimos: ${PORTAL_URL}`,
    }).catch(() => {});
  }

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

  const relationLabel = (rel: SearchedUser['relation']) =>
    rel === 'friend' ? '✓ Amigo' : rel === 'pending' ? 'Pendiente' : '+ Agregar';

  const renderRow = ({ item, index }: { item: RankingEntry; index: number }) => {
    const pos = scope === 'global' && orderBy === 'km' ? item.position : index + 4; // rest empieza en 4
    return (
      <View
        style={[
          styles.rowCard,
          { backgroundColor: theme.backgroundElement },
          item.is_me && { borderColor: BrandAccent, borderWidth: 1 },
        ]}>
        <ThemedText type="smallBold" style={styles.position}>{pos ?? '–'}</ThemedText>
        <Avatar url={item.avatar_url} name={item.username ?? item.full_name} size={38} />
        <View style={styles.who}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {item.username ?? item.full_name ?? 'corredor'}{item.is_me ? '  (vos)' : ''}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {item.days_run} {item.days_run === 1 ? 'día' : 'días'} · {item.activities}{' '}
            {item.activities === 1 ? 'salida' : 'salidas'}
          </ThemedText>
        </View>
        <ThemedText type="smallBold" style={{ color: BrandAccent }}>{fmtKm(item.km)}</ThemedText>
      </View>
    );
  };

  // ── Buscador a pantalla completa ──
  if (searchOpen) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.searchHeader}>
            <View style={[styles.searchBox, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={styles.searchIcon}>🔍</ThemedText>
              <TextInput
                value={query}
                onChangeText={runSearch}
                placeholder="Buscar corredor por username…"
                placeholderTextColor={theme.textSecondary}
                autoFocus
                autoCapitalize="none"
                style={[styles.searchInput, { color: theme.text }]}
              />
              {searching && <ActivityIndicator size="small" color={BrandAccent} />}
            </View>
            <Pressable onPress={() => { setSearchOpen(false); setQuery(''); setResults([]); }}>
              <ThemedText type="smallBold" style={{ color: BrandAccent }}>Listo</ThemedText>
            </Pressable>
          </View>

          <FlatList
            data={results}
            keyExtractor={(u, i) => u.username ?? String(i)}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
                {query.trim().length < 3
                  ? 'Escribí al menos 3 letras del username para buscar.'
                  : 'Sin resultados. Probá con otro username.'}
              </ThemedText>
            }
            renderItem={({ item }) => (
              <View style={[styles.rowCard, { backgroundColor: theme.backgroundElement }]}>
                <Avatar url={item.avatar_url} name={item.username ?? item.full_name} size={38} />
                <View style={styles.who}>
                  <ThemedText type="smallBold" numberOfLines={1}>{item.username ?? 'corredor'}</ThemedText>
                  {item.full_name ? (
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{item.full_name}</ThemedText>
                  ) : null}
                </View>
                <Pressable
                  disabled={item.relation !== 'none'}
                  onPress={() => addFriend(item)}
                  style={[
                    styles.addBtn,
                    { borderColor: item.relation === 'none' ? BrandAccent : theme.backgroundSelected },
                    item.relation === 'friend' && { backgroundColor: theme.backgroundSelected },
                  ]}>
                  <ThemedText
                    type="small"
                    style={item.relation === 'none' ? { color: BrandAccent } : { color: theme.textSecondary }}>
                    {relationLabel(item.relation)}
                  </ThemedText>
                </Pressable>
              </View>
            )}
          />
        </SafeAreaView>
      </ThemedView>
    );
  }

  // ── Ranking ──
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.headerRow}>
          <ThemedText type="subtitle">Ranking</ThemedText>
          <View style={styles.headerActions}>
            <Pressable onPress={() => setSearchOpen(true)} style={[styles.iconBtn, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={styles.iconTxt}>🔍</ThemedText>
            </Pressable>
            <Pressable
              onPress={shareRanking}
              disabled={entries.length === 0}
              style={[styles.shareBtn, { backgroundColor: BrandAccent, opacity: entries.length === 0 ? 0.5 : 1 }]}>
              <ThemedText type="smallBold" style={{ color: '#06281d' }}>↗ Compartir</ThemedText>
            </Pressable>
          </View>
        </View>

        {/* Solicitudes de amistad entrantes */}
        {friends && friends.incoming.length > 0 && (
          <View style={styles.requests}>
            <Pressable onPress={() => setShowRequests((v) => !v)} style={[styles.requestPill, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="smallBold" style={{ color: BrandAccent }}>
                {friends.incoming.length} {friends.incoming.length === 1 ? 'solicitud de amistad' : 'solicitudes de amistad'}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{showRequests ? '▲' : '▼'}</ThemedText>
            </Pressable>
            {showRequests && friends.incoming.map((f) => (
              <View key={f.friendship_id} style={[styles.rowCard, { backgroundColor: theme.backgroundElement }]}>
                <Avatar url={f.avatar_url} name={f.username ?? f.full_name} size={34} />
                <View style={styles.who}>
                  <ThemedText type="smallBold" numberOfLines={1}>{f.username ?? f.full_name ?? 'corredor'}</ThemedText>
                </View>
                <Pressable onPress={() => accept(f.friendship_id)} style={[styles.addBtn, { borderColor: BrandAccent }]}>
                  <ThemedText type="small" style={{ color: BrandAccent }}>Aceptar</ThemedText>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <View style={styles.controls}>
          {segmented(
            [{ key: 'friends', label: 'Amigos' }, { key: 'global', label: '🌎 Mundial' }],
            scope, (v) => setScope(v as RankingScope),
          )}
          {segmented(
            [{ key: 'week', label: 'Semana' }, { key: 'month', label: 'Mes' }],
            period, (v) => setPeriod(v as Period),
          )}
        </View>
        <View style={styles.controls}>
          {segmented(
            [{ key: 'km', label: 'por km' }, { key: 'days_run', label: 'por días' }],
            orderBy, (v) => setOrderBy(v as OrderBy),
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
            data={rest}
            keyExtractor={(e, i) => e.username ?? String(i)}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
            ListHeaderComponent={
              top3.length > 0 ? (
                <View style={styles.podium}>
                  {top3.map((e, i) => (
                    <View
                      key={e.username ?? i}
                      style={[
                        styles.podiumCard,
                        { backgroundColor: theme.backgroundElement },
                        i === 0 && styles.podiumFirst,
                        e.is_me && { borderColor: BrandAccent, borderWidth: 1 },
                      ]}>
                      <ThemedText style={styles.medal}>{MEDALS[i]}</ThemedText>
                      <Avatar url={e.avatar_url} name={e.username ?? e.full_name} size={i === 0 ? 56 : 46} />
                      <ThemedText type="smallBold" numberOfLines={1} style={styles.podiumName}>
                        {e.username ?? e.full_name ?? 'corredor'}{e.is_me ? ' (vos)' : ''}
                      </ThemedText>
                      <ThemedText type="smallBold" style={{ color: BrandAccent }}>{fmtKm(e.km)}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">{e.days_run}d · {e.activities} sal.</ThemedText>
                    </View>
                  ))}
                </View>
              ) : null
            }
            ListEmptyComponent={
              ranking && top3.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
                  {scope === 'friends'
                    ? 'Todavía no tenés amigos en el ranking. Tocá 🔍 para buscar y agregar corredores.'
                    : 'Sin datos todavía.'}
                </ThemedText>
              ) : null
            }
            ListFooterComponent={
              meOutsideList && me ? (
                <View style={[styles.rowCard, styles.meFooter, { backgroundColor: theme.backgroundElement, borderColor: BrandAccent }]}>
                  <ThemedText type="smallBold" style={styles.position}>{me.position ?? '–'}</ThemedText>
                  <Avatar url={me.avatar_url} name={me.username} size={38} />
                  <View style={styles.who}>
                    <ThemedText type="smallBold">{me.username ?? 'vos'} (vos)</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">tu posición</ThemedText>
                  </View>
                  <ThemedText type="smallBold" style={{ color: BrandAccent }}>{fmtKm(me.km)}</ThemedText>
                </View>
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
  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.three, paddingTop: Spacing.two,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  iconBtn: { width: 38, height: 38, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  iconTxt: { fontSize: 16 },
  shareBtn: { paddingHorizontal: Spacing.three, paddingVertical: 9, borderRadius: 999 },
  controls: { flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one },
  segmented: { flexDirection: 'row', borderRadius: 999, padding: 3 },
  segment: { paddingHorizontal: Spacing.three, paddingVertical: 6, borderRadius: 999 },
  error: { color: '#ff6b6b', textAlign: 'center', padding: Spacing.two },
  list: { padding: Spacing.three, paddingBottom: BottomTabInset + Spacing.three, gap: Spacing.two },
  empty: { textAlign: 'center', marginTop: Spacing.five, paddingHorizontal: Spacing.three },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderRadius: 16, padding: Spacing.three },
  position: { minWidth: 30, textAlign: 'center' },
  who: { flex: 1, gap: 2 },
  // Podio
  podium: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-end', marginBottom: Spacing.two },
  podiumCard: { flex: 1, alignItems: 'center', gap: 4, borderRadius: 16, paddingVertical: Spacing.three, paddingHorizontal: Spacing.one },
  podiumFirst: { paddingVertical: Spacing.four },
  podiumName: { textAlign: 'center', maxWidth: '100%' },
  medal: { fontSize: 22 },
  meFooter: { borderWidth: 1, marginTop: Spacing.two },
  // Buscador
  searchHeader: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.three,
    paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.one,
  },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 10 },
  searchIcon: { fontSize: 15 },
  searchInput: { flex: 1, fontSize: 15 },
  requests: { paddingHorizontal: Spacing.three, gap: Spacing.two, paddingTop: Spacing.one },
  requestPill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 10 },
  addBtn: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 7 },
});
