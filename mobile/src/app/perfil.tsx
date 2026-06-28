import Constants from 'expo-constants';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';

import { Avatar } from '@/components/avatar';
import { FriendRequests } from '@/components/friend-requests';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { SectionTitle, StatTile, useCardStyle } from '@/components/ui';
import { BottomTabInset, BrandAccent, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError, type FriendLists, type Profile, type Summary } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { goPremium } from '@/lib/billing';
import { useEntitlement } from '@/lib/entitlement';

const AMBER = '#f5a524'; // estado "atención" (prueba por terminar / terminada)

/** Días enteros desde hoy hasta `iso` (negativo si ya pasó). */
function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / 86400000);
}

/** Etiqueta corta del plan para el chip del hero. */
function planChip(profile: Profile): { label: string; color: string } {
  const left = daysUntil(profile.plan === 'premium' ? profile.premium_until : profile.trial_ends_at);
  if (profile.plan === 'admin') return { label: '⭐ Ilimitada', color: BrandAccent };
  if (profile.plan === 'premium') return { label: left != null ? `⭐ Premium · ${left}d` : '⭐ Premium', color: BrandAccent };
  if (profile.plan === 'trial') {
    return { label: left != null ? `🎁 Prueba · ${left} ${left === 1 ? 'día' : 'días'}` : '🎁 Prueba', color: AMBER };
  }
  return { label: '⏰ Prueba terminada', color: AMBER };
}

/** Tarjeta de estado de la suscripción. Muro "suave": informa y anima, no bloquea. */
function SubscriptionCard({ profile, card }: { profile: Profile; card: StyleProp<ViewStyle> }) {
  const left = daysUntil(profile.plan === 'premium' ? profile.premium_until : profile.trial_ends_at);
  const [busy, setBusy] = useState(false);

  let title: string;
  let detail: string;
  let accent = BrandAccent;
  if (profile.plan === 'admin') {
    title = '⭐ Cuenta ilimitada';
    detail = 'Tenés acceso total a ChronoTrack Run.';
  } else if (profile.plan === 'premium') {
    title = '⭐ Premium activo';
    detail = left != null ? `Te quedan ${left} ${left === 1 ? 'día' : 'días'} de premium.` : 'Suscripción activa.';
  } else if (profile.plan === 'trial') {
    title = '🎁 Prueba gratis';
    detail = left != null
      ? `Te ${left === 1 ? 'queda' : 'quedan'} ${left} ${left === 1 ? 'día' : 'días'} de prueba. ¡Disfrutá todo!`
      : 'Estás en tu período de prueba.';
    if (left != null && left <= 14) accent = AMBER;
  } else {
    title = '⏰ Prueba terminada';
    detail = 'Tu prueba gratis terminó. Pasate a premium para seguir disfrutando todo.';
    accent = AMBER;
  }

  // El botón de pago aparece para quien no es admin ni tiene premium vigente.
  const canSubscribe = profile.plan === 'trial' || profile.plan === 'expired';

  return (
    <View style={[card, { borderWidth: 1, borderColor: `${accent}55` }]}>
      <ThemedText type="smallBold" style={{ color: accent }}>{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{detail}</ThemedText>
      {canSubscribe && (
        <Pressable
          style={[styles.premiumButton, busy && { opacity: 0.6 }]}
          disabled={busy}
          onPress={async () => { setBusy(true); await goPremium(); setBusy(false); }}>
          <ThemedText type="smallBold" style={styles.onAccent}>
            {busy ? 'Abriendo…' : '⭐ Hacerme premium'}
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
}

/** Perfil: identidad + cuenta. Lo social (buscar amigos, solicitudes) vive en Ranking. */
export default function PerfilScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { logout } = useAuth();
  const { refresh: refreshEntitlement } = useEntitlement();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [friends, setFriends] = useState<FriendLists | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [username, setUsername] = useState('');
  const [editingUser, setEditingUser] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [coupon, setCoupon] = useState('');
  const [redeeming, setRedeeming] = useState(false);

  const load = useCallback(() => {
    Promise.all([api.profile(), api.friends(), api.summary().catch(() => null)])
      .then(([p, f, s]) => {
        setProfile(p);
        setFriends(f);
        setSummary(s);
        setUsername(p.username ?? '');
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setRefreshing(false));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 2500);
  }

  async function run(action: () => Promise<unknown>, okMsg?: string) {
    try {
      await action();
      if (okMsg) flash(okMsg);
      load();
    } catch (e) {
      Alert.alert('Ups', e instanceof ApiError ? e.message : 'Algo salió mal.');
    }
  }

  function saveUsername() {
    setEditingUser(false);
    run(() => api.updateProfile({ username: username.trim() }), 'Username guardado');
  }

  async function redeem() {
    const code = coupon.trim();
    if (!code || redeeming) return;
    setRedeeming(true);
    try {
      const r = await api.redeemCoupon(code);
      setCoupon('');
      load();
      refreshEntitlement(); // que el resto de la app vea el nuevo acceso
      Alert.alert('¡Cupón canjeado!', r.message);
    } catch (e) {
      Alert.alert('Cupón', e instanceof ApiError ? e.message : 'No se pudo canjear.');
    } finally {
      setRedeeming(false);
    }
  }

  async function changeAvatar() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (result.canceled || !result.assets[0]) return;
    try {
      const p = await api.uploadAvatar(result.assets[0].uri);
      setProfile(p);
      flash('Foto actualizada');
    } catch (e) {
      Alert.alert('Ups', e instanceof ApiError ? e.message : 'No se pudo subir la foto.');
    }
  }

  const card = useCardStyle();
  const inputStyle = [styles.input, { backgroundColor: theme.backgroundSelected, color: theme.text }];
  const goal = profile?.weekly_goal ?? 3;
  const chip = profile ? planChip(profile) : null;
  const friendCount = friends?.friends.length ?? 0;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
          }>
          {error && <ThemedText type="small" style={styles.error}>{error}</ThemedText>}
          {notice && <ThemedText type="small" style={styles.notice}>{notice}</ThemedText>}

          {/* Hero de identidad: foto, nombre, @username (editable) y plan */}
          <View style={[card, styles.hero]}>
            <Pressable onPress={changeAvatar}>
              <Avatar url={profile?.avatar_url} name={profile?.full_name ?? profile?.username} size={80} />
              <View style={styles.avatarBadge}>
                <ThemedText style={styles.avatarBadgeText}>✎</ThemedText>
              </View>
            </Pressable>
            <View style={styles.heroWho}>
              <ThemedText style={styles.heroName} numberOfLines={1}>
                {profile?.full_name ?? profile?.username ?? '—'}
              </ThemedText>
              {editingUser ? (
                <View style={styles.inline}>
                  <TextInput
                    style={[inputStyle, styles.flex, styles.userInput]}
                    placeholder="username"
                    placeholderTextColor={theme.textSecondary}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoFocus
                    value={username}
                    onChangeText={setUsername}
                    onSubmitEditing={saveUsername}
                  />
                  <Pressable style={styles.smallButton} onPress={saveUsername}>
                    <ThemedText type="smallBold" style={styles.onAccent}>OK</ThemedText>
                  </Pressable>
                </View>
              ) : (
                <Pressable onPress={() => setEditingUser(true)}>
                  {profile?.username ? (
                    <ThemedText type="small" themeColor="textSecondary">@{profile.username}</ThemedText>
                  ) : (
                    <ThemedText type="small" style={styles.accent}>Agregá tu @username ✎</ThemedText>
                  )}
                </Pressable>
              )}
              {chip && (
                <View style={[styles.chip, { backgroundColor: `${chip.color}26` }]}>
                  <ThemedText type="small" style={{ color: chip.color, fontWeight: '700' }}>{chip.label}</ThemedText>
                </View>
              )}
            </View>
          </View>

          {/* Solicitudes de amistad entrantes (agrupadas; se aceptan acá) */}
          <FriendRequests
            requests={friends?.incoming ?? []}
            onAccept={(id) => run(() => api.acceptFriend(id), '¡Ahora son amigos!')}
          />

          {/* Strip de identidad */}
          <View style={styles.strip}>
            <StatTile icon="🔥" value={String(summary?.streak_weeks ?? 0)} label="racha (sem)" />
            <StatTile icon="🏃" value={String(summary?.month.activities ?? 0)} label="salidas (mes)" />
            <StatTile icon="🎯" value={String(goal)} label="meta (días)" />
          </View>

          {/* Suscripción (muro suave: informa, todavía no bloquea) */}
          {profile && <SubscriptionCard profile={profile} card={card} />}

          {/* Amigos: el conteo y el acceso; la gestión vive en Ranking */}
          <Pressable onPress={() => router.navigate('/ranking')} style={card}>
            <View style={styles.amigosHead}>
              <SectionTitle>AMIGOS {friendCount > 0 ? `(${friendCount})` : ''}</SectionTitle>
              <ThemedText type="smallBold" style={styles.accent}>Ver ranking ›</ThemedText>
            </View>
            {friendCount > 0 ? (
              <View style={styles.friendRow}>
                {friends!.friends.slice(0, 6).map((f, i) => (
                  <Avatar key={f.username ?? i} url={f.avatar_url} name={f.username ?? f.full_name} size={36} />
                ))}
                {friendCount > 6 && (
                  <ThemedText type="small" themeColor="textSecondary">+{friendCount - 6}</ThemedText>
                )}
              </View>
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                Todavía no tenés amigos. Buscá corredores en Ranking para agregarlos.
              </ThemedText>
            )}
          </Pressable>

          {/* Meta semanal */}
          <View style={card}>
            <SectionTitle>META SEMANAL (DÍAS)</SectionTitle>
            <View style={styles.goalRow}>
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <Pressable
                  key={n}
                  onPress={() => run(() => api.updateProfile({ weekly_goal: n }))}
                  style={[
                    styles.goalChip,
                    { backgroundColor: n === goal ? BrandAccent : theme.backgroundSelected },
                  ]}>
                  <ThemedText type="smallBold" style={n === goal ? styles.onAccent : undefined}>
                    {n}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              Tu racha cuenta las semanas en que corrés al menos {goal} {goal === 1 ? 'día' : 'días'}.
            </ThemedText>
          </View>

          {/* Canjear cupón */}
          <View style={card}>
            <SectionTitle>CANJEAR CUPÓN</SectionTitle>
            <View style={styles.inline}>
              <TextInput
                style={[inputStyle, styles.flex, { textTransform: 'uppercase' }]}
                placeholder="Código (ej. VERANO2026)"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="characters"
                autoCorrect={false}
                value={coupon}
                onChangeText={setCoupon}
                onSubmitEditing={redeem}
              />
              <Pressable style={[styles.smallButton, redeeming && { opacity: 0.6 }]} onPress={redeem} disabled={redeeming}>
                <ThemedText type="smallBold" style={styles.onAccent}>{redeeming ? '…' : 'Canjear'}</ThemedText>
              </Pressable>
            </View>
          </View>

          <Pressable style={[styles.logout, { borderColor: theme.border }]} onPress={logout}>
            <ThemedText type="smallBold" themeColor="textSecondary">Cerrar sesión</ThemedText>
          </Pressable>
          <ThemedText type="small" themeColor="textSecondary" style={styles.version}>
            ChronoTrack Run · v{Constants.expoConfig?.version ?? '1.0.0'}
          </ThemedText>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: { flex: 1, maxWidth: MaxContentWidth, width: '100%' },
  scroll: { padding: Spacing.three, paddingBottom: BottomTabInset + Spacing.three, gap: Spacing.four },
  error: { color: '#ff6b6b' },
  notice: { color: BrandAccent },
  accent: { color: BrandAccent },
  onAccent: { color: '#06281d' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  flex: { flex: 1 },
  // Hero
  hero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  heroWho: { flex: 1, gap: 4 },
  heroName: { fontSize: 22, fontWeight: '700', lineHeight: 26 },
  userInput: { paddingVertical: 6 },
  chip: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginTop: 2 },
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: BrandAccent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBadgeText: { color: '#000', fontSize: 14, fontWeight: '800' },
  // Strip
  strip: { flexDirection: 'row', gap: Spacing.three },
  // Amigos
  amigosHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  friendRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  // Inputs / botones
  input: { borderRadius: 10, paddingHorizontal: Spacing.three, paddingVertical: 10, fontSize: 15 },
  smallButton: {
    backgroundColor: BrandAccent,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
  },
  premiumButton: {
    backgroundColor: BrandAccent,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    marginTop: Spacing.one,
  },
  goalRow: { flexDirection: 'row', gap: Spacing.two },
  goalChip: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logout: {
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  version: { textAlign: 'center', opacity: 0.7 },
});
