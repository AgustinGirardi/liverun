import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, FlatList, Pressable, RefreshControl, Share, StyleSheet,
  TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';

import { Avatar } from '@/components/avatar';
import { FadeIn } from '@/components/fade-in';
import { FriendRequests } from '@/components/friend-requests';
import { PremiumUpsell } from '@/components/premium-upsell';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Segmented } from '@/components/ui';
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

/** Un puesto del podio "héroe": el 1º va elevado y con anillo; 2º/3º a los lados. */
function PodiumSpot({ entry, place, theme }: { entry: RankingEntry; place: number; theme: ReturnType<typeof useTheme> }) {
  const isFirst = place === 1;
  const avatar = <Avatar url={entry.avatar_url} name={entry.username ?? entry.full_name} size={isFirst ? 72 : 52} />;
  return (
    <View style={styles.spot}>
      <ThemedText style={styles.spotTop}>{isFirst ? '👑' : MEDALS[place - 1]}</ThemedText>
      {isFirst ? <View style={styles.firstRing}>{avatar}</View> : avatar}
      <ThemedText type="smallBold" numberOfLines={1} style={styles.spotName}>
        {entry.username ?? entry.full_name ?? 'corredor'}{entry.is_me ? ' (vos)' : ''}
      </ThemedText>
      <ThemedText type="smallBold" style={{ color: BrandAccent }}>{fmtKm(entry.km)}</ThemedText>
      <View
        style={[
          styles.pedestal,
          place === 1 ? styles.pedH1 : place === 2 ? styles.pedH2 : styles.pedH3,
          isFirst ? styles.pedFirst : { backgroundColor: theme.backgroundSelected },
        ]}>
        <ThemedText style={[styles.pedNum, { color: isFirst ? BrandAccent : theme.textSecondary }]}>{place}</ThemedText>
      </View>
    </View>
  );
}

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
  // Podio colapsable: se achica al hacer scroll de la lista.
  const scrollY = useRef(new Animated.Value(0)).current;
  const [podiumH, setPodiumH] = useState(0);
  const [listH, setListH] = useState(0);
  const [contentH, setContentH] = useState(0);

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

  // Al cambiar de scope/período: reseteo el colapso del podio (se re-mide solo).
  useEffect(() => { scrollY.setValue(0); setPodiumH(0); }, [scope, period, scrollY]);

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
  // Podio "héroe": 2º a la izquierda, 1º al centro (elevado), 3º a la derecha.
  const podiumSpots = [
    { place: 2, e: top3[1] },
    { place: 1, e: top3[0] },
    { place: 3, e: top3[2] },
  ].filter((s): s is { place: number; e: RankingEntry } => !!s.e);
  const rest = entries.slice(3);
  const me = entries.find((e) => e.is_me);
  const meOutsideList = me && scope === 'global' && !entries.slice(0, 50).some((e) => e.is_me);
  // Podio: al bajar se achica como bloque a la mitad (anclado arriba, sin recortar)
  // + degradado oscuro. Solo colapsa si la lista da para scrollear; si no, queda
  // fijo y completo (evita el "salto"/sensación de trabado con pocas filas).
  const canCollapse = podiumH > 0 && contentH > listH + 24;
  const podiumScale = canCollapse ? scrollY.interpolate({ inputRange: [0, 140], outputRange: [1, 0.5], extrapolate: 'clamp' }) : 1;
  const podiumTransY = canCollapse ? scrollY.interpolate({ inputRange: [0, 140], outputRange: [0, -(podiumH * 0.25)], extrapolate: 'clamp' }) : 0;
  const podiumHeight = podiumH ? (canCollapse ? scrollY.interpolate({ inputRange: [0, 140], outputRange: [podiumH, podiumH * 0.5], extrapolate: 'clamp' }) : podiumH) : undefined;
  const podiumDim = canCollapse ? scrollY.interpolate({ inputRange: [0, 140], outputRange: [0, 0.6], extrapolate: 'clamp' }) : 0;

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
        `🏃 Ranking LiveRun · ${scopeLabel} · ${periodLabel}\n\n` +
        `${lines.join('\n')}${mine}\n\n¿Me ganás? Sumate y competimos: ${PORTAL_URL}`,
    }).catch(() => {});
  }

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

        {/* Solicitudes de amistad entrantes (agrupadas) */}
        <FriendRequests requests={friends?.incoming ?? []} onAccept={accept} style={styles.section} />

        {/* Scope como tabs subrayadas + filtros chicos debajo */}
        <View style={styles.scopeTabs}>
          {([{ key: 'friends', label: '👥 Amigos' }, { key: 'global', label: '🌎 Mundial' }] as const).map((o) => {
            const on = scope === o.key;
            return (
              <Pressable key={o.key} onPress={() => setScope(o.key)} style={styles.scopeTab} hitSlop={8}>
                <ThemedText style={[styles.scopeLabel, { color: on ? theme.text : theme.textSecondary }]}>
                  {o.label}
                </ThemedText>
                <View style={[styles.scopeUnderline, on && { backgroundColor: BrandAccent }]} />
              </Pressable>
            );
          })}
        </View>
        <View style={styles.filterRow}>
          <Segmented
            options={[{ key: 'week', label: 'Semana' }, { key: 'month', label: 'Mes' }]}
            value={period}
            onChange={setPeriod}
          />
          <Pressable
            onPress={() => setOrderBy((o) => (o === 'km' ? 'days_run' : 'km'))}
            style={[styles.orderChip, { backgroundColor: theme.backgroundElement }]}
            hitSlop={8}>
            <ThemedText type="small" themeColor="textSecondary">
              {orderBy === 'km' ? 'por km' : 'por días'} ⇅
            </ThemedText>
          </Pressable>
        </View>

        {error && <ThemedText type="small" style={styles.error}>{error}</ThemedText>}

        {globalLocked || locked ? (
          <PremiumUpsell
            emoji="🌎"
            title="Ranking mundial"
            detail="Competí con corredores de todo el mundo y participá por premios. El ranking mundial es premium; el de amigos es gratis."
          />
        ) : (
          <FadeIn key={`${scope}-${period}`} style={styles.flex}>
            {top3.length > 0 && (
              <Animated.View style={[styles.podiumWrap, podiumHeight != null && { height: podiumHeight }]}>
                <Animated.View
                  onLayout={(e) => { if (!podiumH) setPodiumH(Math.round(e.nativeEvent.layout.height)); }}
                  style={{ transform: [{ translateY: podiumTransY }, { scale: podiumScale }] }}>
                  <View style={styles.podium}>
                    {podiumSpots.map(({ place, e }) => (
                      <PodiumSpot key={e.username ?? place} entry={e} place={place} theme={theme} />
                    ))}
                  </View>
                </Animated.View>
                <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: podiumDim }]}>
                  <LinearGradient colors={['transparent', 'rgba(8,10,11,0.92)']} style={StyleSheet.absoluteFill} />
                </Animated.View>
              </Animated.View>
            )}
            <Animated.FlatList
              style={styles.flex}
              data={rest}
              keyExtractor={(e, i) => (e as RankingEntry).username ?? String(i)}
              contentContainerStyle={styles.list}
              scrollEventThrottle={16}
              onLayout={(e) => setListH(e.nativeEvent.layout.height)}
              onContentSizeChange={(_w, h) => setContentH(h)}
              onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
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
              renderItem={renderRow as any}
            />
          </FadeIn>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: { flex: 1, maxWidth: MaxContentWidth, width: '100%' },
  flex: { flex: 1 },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.three, paddingTop: Spacing.two,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  iconBtn: { width: 38, height: 38, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  iconTxt: { fontSize: 16 },
  shareBtn: { paddingHorizontal: Spacing.three, paddingVertical: 9, borderRadius: 999 },
  section: { paddingHorizontal: Spacing.three, paddingTop: Spacing.one },
  scopeTabs: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.five, paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
  scopeTab: { alignItems: 'center', gap: 5 },
  scopeLabel: { fontSize: 16, fontWeight: '700' },
  scopeUnderline: { height: 2, borderRadius: 1, alignSelf: 'stretch', backgroundColor: 'transparent' },
  filterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  orderChip: { borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 7 },
  error: { color: '#ff6b6b', textAlign: 'center', padding: Spacing.two },
  list: { padding: Spacing.three, paddingBottom: BottomTabInset + Spacing.three, gap: Spacing.two },
  empty: { textAlign: 'center', marginTop: Spacing.five, paddingHorizontal: Spacing.three },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderRadius: 16, padding: Spacing.three },
  position: { minWidth: 30, textAlign: 'center' },
  who: { flex: 1, gap: 2 },
  // Podio "héroe"
  podium: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-end' },
  podiumWrap: { overflow: 'hidden', paddingHorizontal: Spacing.three, marginBottom: Spacing.two },
  spot: { flex: 1, alignItems: 'center', gap: 5 },
  spotTop: { fontSize: 22, lineHeight: 26, height: 26 },
  firstRing: {
    borderRadius: 999, borderWidth: 3, borderColor: BrandAccent,
    shadowColor: BrandAccent, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, elevation: 8,
  },
  spotName: { textAlign: 'center', maxWidth: '100%' },
  pedestal: { width: '100%', borderTopLeftRadius: 12, borderTopRightRadius: 12, alignItems: 'center', paddingTop: 8, marginTop: 2 },
  pedFirst: { backgroundColor: 'rgba(0,229,160,0.14)' },
  pedH1: { height: 64 },
  pedH2: { height: 46 },
  pedH3: { height: 36 },
  pedNum: { fontSize: 20, fontWeight: '900', fontVariant: ['tabular-nums'] },
  meFooter: { borderWidth: 1, marginTop: Spacing.two },
  // Buscador
  searchHeader: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.three,
    paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.one,
  },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 10 },
  searchIcon: { fontSize: 15 },
  searchInput: { flex: 1, fontSize: 15 },
  addBtn: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 7 },
});
