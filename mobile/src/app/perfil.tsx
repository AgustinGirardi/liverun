import * as ImagePicker from 'expo-image-picker';
import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import { Avatar } from '@/components/avatar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, BrandAccent, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError, type FriendLists, type Profile, type SearchedUser } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/** Perfil: datos, username, meta semanal, búsqueda de amigos y solicitudes. */
export default function PerfilScreen() {
  const theme = useTheme();
  const { logout } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [friends, setFriends] = useState<FriendLists | null>(null);
  const [username, setUsername] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchedUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    Promise.all([api.profile(), api.friends()])
      .then(([p, f]) => {
        setProfile(p);
        setFriends(f);
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

  async function search(q: string) {
    setQuery(q);
    if (q.trim().length < 3) {
      setResults([]);
      return;
    }
    try {
      setResults(await api.searchFriends(q.trim()));
    } catch {
      // la búsqueda es best-effort; no rompemos la pantalla
    }
  }

  const card = [styles.card, { backgroundColor: theme.backgroundElement }];
  const inputStyle = [styles.input, { backgroundColor: theme.backgroundSelected, color: theme.text }];
  const goal = profile?.weekly_goal ?? 3;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
          }>
          <ThemedText type="subtitle">Perfil</ThemedText>
          {error && <ThemedText type="small" style={styles.error}>{error}</ThemedText>}
          {notice && <ThemedText type="small" style={styles.notice}>{notice}</ThemedText>}

          {/* Cuenta */}
          <View style={card}>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.cardTitle}>CUENTA</ThemedText>
            <View style={styles.accountRow}>
              <Pressable onPress={changeAvatar}>
                <Avatar url={profile?.avatar_url} name={profile?.full_name ?? profile?.username} size={72} />
                <View style={styles.avatarBadge}>
                  <ThemedText style={styles.avatarBadgeText}>✎</ThemedText>
                </View>
              </Pressable>
              <View style={styles.flex}>
                <ThemedText>{profile?.full_name ?? '—'}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{profile?.email ?? ''}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">Tocá la foto para cambiarla.</ThemedText>
              </View>
            </View>
            <View style={styles.inline}>
              <TextInput
                style={[inputStyle, styles.flex]}
                placeholder="username (para que te encuentren)"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="none"
                value={username}
                onChangeText={setUsername}
              />
              <Pressable
                style={styles.smallButton}
                onPress={() => run(() => api.updateProfile({ username: username.trim() }), 'Username guardado')}>
                <ThemedText type="smallBold" style={styles.buttonText}>Guardar</ThemedText>
              </Pressable>
            </View>
          </View>

          {/* Meta semanal */}
          <View style={card}>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.cardTitle}>
              META SEMANAL (DÍAS)
            </ThemedText>
            <View style={styles.goalRow}>
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <Pressable
                  key={n}
                  onPress={() => run(() => api.updateProfile({ weekly_goal: n }))}
                  style={[
                    styles.goalChip,
                    { backgroundColor: n === goal ? BrandAccent : theme.backgroundSelected },
                  ]}>
                  <ThemedText type="smallBold" style={n === goal ? styles.buttonText : undefined}>
                    {n}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              Tu racha cuenta las semanas en que corrés al menos {goal} {goal === 1 ? 'día' : 'días'}.
            </ThemedText>
          </View>

          {/* Solicitudes entrantes */}
          {friends && friends.incoming.length > 0 && (
            <View style={card}>
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.cardTitle}>
                SOLICITUDES
              </ThemedText>
              {friends.incoming.map((f) => (
                <View key={f.friendship_id} style={styles.inline}>
                  <ThemedText style={styles.flex}>{f.username ?? f.full_name}</ThemedText>
                  <Pressable
                    style={styles.smallButton}
                    onPress={() => run(() => api.acceptFriend(f.friendship_id), '¡Ahora son amigos!')}>
                    <ThemedText type="smallBold" style={styles.buttonText}>Aceptar</ThemedText>
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          {/* Amigos + búsqueda */}
          <View style={card}>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.cardTitle}>
              AMIGOS {friends ? `(${friends.friends.length})` : ''}
            </ThemedText>
            {friends?.friends.map((f, i) => (
              <ThemedText key={f.username ?? i}>{f.username ?? f.full_name}</ThemedText>
            ))}
            {friends && friends.friends.length === 0 && (
              <ThemedText type="small" themeColor="textSecondary">
                Buscá corredores por username para agregarlos.
              </ThemedText>
            )}
            {friends && friends.outgoing.length > 0 && (
              <ThemedText type="small" themeColor="textSecondary">
                Pendientes: {friends.outgoing.map((f) => f.username ?? f.full_name).join(', ')}
              </ThemedText>
            )}
            <TextInput
              style={inputStyle}
              placeholder="Buscar por username (mín. 3 letras)"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              value={query}
              onChangeText={search}
            />
            {results.map((u, i) => (
              <View key={u.username ?? i} style={styles.inline}>
                <View style={styles.flex}>
                  <ThemedText>{u.username}</ThemedText>
                  {u.full_name && (
                    <ThemedText type="small" themeColor="textSecondary">{u.full_name}</ThemedText>
                  )}
                </View>
                {u.relation === 'none' ? (
                  <Pressable
                    style={styles.smallButton}
                    onPress={() => run(() => api.requestFriend(u.username!), 'Solicitud enviada')}>
                    <ThemedText type="smallBold" style={styles.buttonText}>Agregar</ThemedText>
                  </Pressable>
                ) : (
                  <ThemedText type="small" themeColor="textSecondary">
                    {u.relation === 'friend' ? 'Amigos' : 'Pendiente'}
                  </ThemedText>
                )}
              </View>
            ))}
          </View>

          <Pressable style={[styles.logout, { borderColor: theme.backgroundSelected }]} onPress={logout}>
            <ThemedText type="smallBold" themeColor="textSecondary">Cerrar sesión</ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: { flex: 1, maxWidth: MaxContentWidth, width: '100%' },
  scroll: { padding: Spacing.three, paddingBottom: BottomTabInset + Spacing.three, gap: Spacing.three },
  error: { color: '#ff6b6b' },
  notice: { color: BrandAccent },
  card: { borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  cardTitle: { letterSpacing: 2 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
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
  flex: { flex: 1 },
  input: { borderRadius: 10, paddingHorizontal: Spacing.three, paddingVertical: 10, fontSize: 15 },
  smallButton: {
    backgroundColor: BrandAccent,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
  },
  buttonText: { color: '#000' },
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
});
