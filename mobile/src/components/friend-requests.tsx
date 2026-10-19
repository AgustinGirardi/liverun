import { useState } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Avatar } from '@/components/avatar';
import { ChevronDownIcon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { type FriendRequest } from '@/lib/api';

const ON_ACCENT = '#06281d';

/**
 * Solicitudes de amistad entrantes agrupadas en un botón desplegable.
 * Mismo componente en Ranking y en Perfil (una sola fuente, sin duplicar).
 * Si no hay solicitudes no renderiza nada.
 */
export function FriendRequests({
  requests,
  onAccept,
  style,
}: {
  requests: FriendRequest[];
  onAccept: (friendshipId: number) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  if (requests.length === 0) return null;
  const n = requests.length;

  return (
    <View style={[styles.wrap, style]}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={[styles.pill, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="smallBold" themeColor="accent">
          {n} {n === 1 ? 'solicitud de amistad' : 'solicitudes de amistad'}
        </ThemedText>
        <View style={open ? styles.chevFlip : undefined}>
          <ChevronDownIcon size={16} color={theme.textSecondary} />
        </View>
      </Pressable>

      {open &&
        requests.map((f) => (
          <View key={f.friendship_id} style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
            <Avatar url={f.avatar_url} name={f.username ?? f.full_name} size={34} />
            <View style={styles.who}>
              <ThemedText type="smallBold" numberOfLines={1}>
                {f.username ?? f.full_name ?? 'corredor'}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">quiere ser tu amigo</ThemedText>
            </View>
            <Pressable onPress={() => onAccept(f.friendship_id)} style={[styles.accept, { backgroundColor: theme.accentSurface }]}>
              <ThemedText type="smallBold" themeColor="onAccent">Aceptar</ThemedText>
            </Pressable>
          </View>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  chevFlip: { transform: [{ rotate: '180deg' }] },
  wrap: { gap: Spacing.two },
  pill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 10,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderRadius: 16, padding: Spacing.three },
  who: { flex: 1, gap: 2 },
  accept: { borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 7 },
  onAccent: { color: ON_ACCENT },
});
