import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, BrandAccent, MaxContentWidth, Spacing } from '@/constants/theme';

type Props = {
  title: string;
  subtitle: string;
};

/** Pantalla provisoria mientras se construye cada pestaña (ver spec en docs/superpowers/specs/2026-06-09-mobile-run-app-design.md). */
export function PlaceholderScreen({ title, subtitle }: Props) {
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText style={styles.brand}>
          CHRONO<ThemedText style={[styles.brand, { color: BrandAccent }]}>TRACK</ThemedText> RUN
        </ThemedText>
        <ThemedText type="title" style={styles.title}>
          {title}
        </ThemedText>
        <ThemedText type="small" style={styles.subtitle}>
          {subtitle}
        </ThemedText>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    flexDirection: 'row',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
  },
  brand: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 3,
  },
  title: {
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
  },
});
