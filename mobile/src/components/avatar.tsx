import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BrandAccent } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  url?: string | null;
  /** Para la inicial cuando no hay foto. */
  name?: string | null;
  size?: number;
};

/** Foto de perfil circular; sin foto muestra la inicial sobre fondo de marca. */
export function Avatar({ url, name, size = 40 }: Props) {
  const theme = useTheme();
  const radius = size / 2;

  if (url) {
    return (
      <Image
        source={{ uri: url }}
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: theme.backgroundSelected }}
        contentFit="cover"
        transition={150}
      />
    );
  }
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <View
      style={[
        styles.fallback,
        { width: size, height: size, borderRadius: radius, backgroundColor: `${BrandAccent}26` },
      ]}>
      <ThemedText style={{ color: BrandAccent, fontWeight: '800', fontSize: size * 0.45 }}>
        {initial}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
});
