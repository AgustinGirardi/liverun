/**
 * Kit de UI compartido: primitivas que estaban duplicadas en varias pantallas
 * (tarjeta, título de sección, mini-stat y control segmentado). Mantienen los
 * mismos valores que antes — esto unifica, no cambia el aspecto.
 */
import { type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BrandAccent, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Estilo base de tarjeta (con el fondo del tema). Usalo cuando necesitás el
 *  estilo sobre un Pressable u otro elemento; para una View común usá <Card>. */
export function useCardStyle(): StyleProp<ViewStyle> {
  const theme = useTheme();
  return [styles.card, { backgroundColor: theme.backgroundElement }];
}

export function Card({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const card = useCardStyle();
  return <View style={[card, style]}>{children}</View>;
}

/** Título de sección: mayúsculas tenues y espaciadas. */
export function SectionTitle({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return (
    <ThemedText type="smallBold" themeColor="textSecondary" style={[styles.sectionTitle, style]}>
      {children}
    </ThemedText>
  );
}

/** Mini-stat para tiras (ícono opcional, valor grande, etiqueta). */
export function StatTile({ icon, value, label }: { icon?: string; value: string; label: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: theme.backgroundElement }]}>
      {icon ? <ThemedText style={styles.statIcon}>{icon}</ThemedText> : null}
      <ThemedText style={styles.statValue}>{value}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
    </View>
  );
}

/** Control segmentado (pestañas tipo píldora). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: theme.backgroundElement }, style]}>
      {options.map((o) => (
        <Pressable
          key={o.key}
          onPress={() => onChange(o.key)}
          style={[styles.segment, value === o.key && { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText type="small" style={value === o.key ? styles.segmentOn : undefined}>
            {o.label}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  sectionTitle: { letterSpacing: 2 },
  stat: { flex: 1, alignItems: 'center', borderRadius: 16, paddingVertical: 14, paddingHorizontal: Spacing.two },
  statIcon: { fontSize: 15, marginBottom: 2 },
  statValue: { fontSize: 26, fontWeight: '900', lineHeight: 30, fontVariant: ['tabular-nums'] },
  segmented: { flexDirection: 'row', borderRadius: 999, padding: 3 },
  segment: { paddingHorizontal: Spacing.three, paddingVertical: 6, borderRadius: 999 },
  segmentOn: { color: BrandAccent },
});
