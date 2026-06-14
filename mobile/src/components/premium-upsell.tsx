import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BrandAccent, Spacing } from '@/constants/theme';
import { goPremium } from '@/lib/billing';

/** Muro suave: invita a hacerse premium para usar una función. No bloquea nada
 * ya guardado; solo reemplaza la función premium con esta tarjeta. */
export function PremiumUpsell({ emoji, title, detail }: { emoji: string; title: string; detail: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <View style={styles.wrap}>
      <ThemedText style={styles.emoji}>{emoji}</ThemedText>
      <ThemedText type="subtitle" style={styles.title}>{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.detail}>{detail}</ThemedText>
      <Pressable
        style={[styles.button, busy && { opacity: 0.6 }]}
        disabled={busy}
        onPress={async () => { setBusy(true); await goPremium(); setBusy(false); }}>
        <ThemedText style={styles.buttonText}>{busy ? 'Abriendo…' : '⭐ Hacerme premium'}</ThemedText>
      </Pressable>
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
  button: {
    backgroundColor: BrandAccent,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: Spacing.five,
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  buttonText: { color: '#000', fontWeight: '800' },
  note: { textAlign: 'center' },
});
