import { useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';

import { ThemedText } from '@/components/themed-text';
import { BrandAccent, Spacing } from '@/constants/theme';
import { type Activity } from '@/lib/api';
import { formatDuration, formatKm, formatPace, formatWhen } from '@/lib/format';

type Props = {
  activity: Activity;
  onClose: () => void;
};

/** Tarjeta compartible de una salida: imagen con marca + stats → share sheet. */
export function ShareCard({ activity, onClose }: Props) {
  const cardRef = useRef<View>(null);
  const [busy, setBusy] = useState(false);

  async function share() {
    if (busy) return;
    setBusy(true);
    try {
      const uri = await captureRef(cardRef, { format: 'png', quality: 1 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(Platform.OS === 'ios' ? uri : `file://${uri}`, {
          mimeType: 'image/png',
          dialogTitle: 'Compartir salida',
        });
      }
    } catch {
      // usuario canceló el share sheet o la captura falló: no es un error visible
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* La tarjeta: fondo oscuro fijo (marca), independiente del tema */}
        <View ref={cardRef} collapsable={false} style={styles.card}>
          <ThemedText style={styles.brand}>
            CHRONO<ThemedText style={[styles.brand, { color: BrandAccent }]}>TRACK</ThemedText> RUN
          </ThemedText>
          <ThemedText style={styles.when}>{formatWhen(activity.started_at)}</ThemedText>

          <ThemedText style={styles.km}>{formatKm(activity.distance_m)}</ThemedText>

          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <ThemedText style={styles.statValue}>{formatDuration(activity.duration_s)}</ThemedText>
              <ThemedText style={styles.statLabel}>tiempo</ThemedText>
            </View>
            <View style={styles.stat}>
              <ThemedText style={styles.statValue}>
                {formatPace(activity.avg_pace_s_per_km).replace(' /km', '')}
              </ThemedText>
              <ThemedText style={styles.statLabel}>min/km</ThemedText>
            </View>
          </View>

          <View style={styles.accentBar} />
        </View>

        <View style={styles.actions}>
          <Pressable style={styles.shareButton} onPress={share} disabled={busy}>
            <ThemedText style={styles.shareText}>{busy ? 'Generando…' : 'Compartir imagen'}</ThemedText>
          </Pressable>
          <Pressable style={styles.closeButton} onPress={onClose}>
            <ThemedText style={styles.closeText}>Cerrar</ThemedText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.four,
    padding: Spacing.four,
  },
  card: {
    width: 320,
    backgroundColor: '#0d0f10',
    borderRadius: 24,
    padding: Spacing.five,
    alignItems: 'center',
    gap: Spacing.two,
  },
  brand: { fontSize: 13, fontWeight: '900', letterSpacing: 3, color: '#e8eaeb' },
  when: { fontSize: 12, color: '#8a9299', marginBottom: Spacing.two },
  km: { fontSize: 54, lineHeight: 60, fontWeight: '900', color: BrandAccent },
  statsRow: { flexDirection: 'row', gap: Spacing.six, marginTop: Spacing.two },
  stat: { alignItems: 'center', gap: 2 },
  statValue: { fontSize: 24, fontWeight: '800', color: '#e8eaeb' },
  statLabel: { fontSize: 11, color: '#8a9299', letterSpacing: 1 },
  accentBar: {
    height: 5,
    alignSelf: 'stretch',
    borderRadius: 3,
    backgroundColor: BrandAccent,
    marginTop: Spacing.four,
  },
  actions: { flexDirection: 'row', gap: Spacing.three },
  shareButton: {
    backgroundColor: BrandAccent,
    borderRadius: 12,
    paddingHorizontal: Spacing.four,
    paddingVertical: 12,
  },
  shareText: { color: '#000', fontWeight: '800' },
  closeButton: {
    borderRadius: 12,
    paddingHorizontal: Spacing.four,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#8a9299',
  },
  closeText: { color: '#e8eaeb', fontWeight: '600' },
});
