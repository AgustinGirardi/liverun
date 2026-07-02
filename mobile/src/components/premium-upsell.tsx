import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

/** Muro suave: informa que la función es premium. No bloquea nada ya guardado.
 * Sin botón ni link de compra: las tiendas (Apple 3.1.1 / Play Billing) no
 * permiten dirigir a pagos externos desde la app. */
export function PremiumUpsell({ emoji, title, detail }: { emoji: string; title: string; detail: string }) {
  return (
    <View style={styles.wrap}>
      <ThemedText style={styles.emoji}>{emoji}</ThemedText>
      <ThemedText type="subtitle" style={styles.title}>{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.detail}>{detail}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
        Lo que ya guardaste sigue intacto.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', padding: Spacing.four, gap: Spacing.two, flex: 1 },
  emoji: { fontSize: 48, lineHeight: 56 },
  title: { textAlign: 'center' },
  detail: { textAlign: 'center', paddingHorizontal: Spacing.three },
  note: { textAlign: 'center' },
});
