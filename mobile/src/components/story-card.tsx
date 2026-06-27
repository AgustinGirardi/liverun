/**
 * Tarjeta "historia" para compartir/guardar una salida. Formato 9:16 a tamaño
 * de pantalla y esquinas rectas → se ve bien como story o publicación. Funciona
 * con o sin foto: si el corredor saca/elige una foto va de fondo (con un velo
 * para que los números se lean siempre); si no, queda la tarjeta de marca.
 *
 * Unifica las dos tarjetas viejas (run-photo-card al terminar + share-card del
 * historial) en un solo componente reusable.
 */
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { useRef, useState } from 'react';
import {
  Alert, Image, Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { ThemedText } from '@/components/themed-text';
import { BrandAccent, Spacing } from '@/constants/theme';

const CARD_BG = '#0d0f10';

export type StoryStats = {
  km: string;
  time: string;
  pace: string;
  speed?: string;
  when?: string | null;
};

type Props = { stats: StoryStats; onClose: () => void };

export function StoryCard({ stats, onClose }: Props) {
  const cardRef = useRef<View>(null);
  const { width, height } = useWindowDimensions();
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Card 9:16 lo más grande que entre dejando lugar a los botones de abajo.
  const cardW = Math.min(width - Spacing.three * 2, ((height - 200) * 9) / 16);
  const cardH = (cardW * 16) / 9;

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Sin permiso de cámara', 'Permití el acceso a la cámara para capturar el momento.');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.9 });
    if (!res.canceled && res.assets?.[0]) setPhoto(res.assets[0].uri);
  }

  async function pickPhoto() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (!res.canceled && res.assets?.[0]) setPhoto(res.assets[0].uri);
  }

  async function capture(): Promise<string | null> {
    try {
      return await captureRef(cardRef, { format: 'jpg', quality: 0.95 });
    } catch {
      return null;
    }
  }

  async function share() {
    if (busy) return;
    setBusy(true);
    const uri = await capture();
    if (uri && (await Sharing.isAvailableAsync())) {
      await Sharing.shareAsync(Platform.OS === 'ios' ? uri : `file://${uri}`, {
        mimeType: 'image/jpeg',
        dialogTitle: 'Compartir salida',
      }).catch(() => {});
    }
    setBusy(false);
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    const uri = await capture();
    if (uri) {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (perm.granted) {
        await MediaLibrary.saveToLibraryAsync(uri).catch(() => {});
        Alert.alert('Guardado', 'La imagen quedó en tu galería.');
      } else {
        Alert.alert('Sin permiso', 'Permití el acceso a fotos para guardar la imagen.');
      }
    }
    setBusy(false);
  }

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <View ref={cardRef} collapsable={false} style={[styles.card, { width: cardW, height: cardH }]}>
          {photo && (
            <>
              <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              <LinearGradient
                colors={['transparent', 'rgba(8,10,11,0.55)', 'rgba(8,10,11,0.95)']}
                style={StyleSheet.absoluteFill}
                start={{ x: 0, y: 0.2 }}
                end={{ x: 0, y: 1 }}
              />
            </>
          )}

          <View style={styles.top}>
            <ThemedText style={styles.brand}>
              CHRONO<ThemedText style={[styles.brand, styles.brandAccent]}>TRACK</ThemedText> RUN
            </ThemedText>
            {stats.when ? <ThemedText style={styles.when}>{stats.when}</ThemedText> : null}
          </View>

          <View style={styles.bottom}>
            <ThemedText style={styles.km} numberOfLines={1} adjustsFontSizeToFit>{stats.km}</ThemedText>
            <View style={styles.statsRow}>
              <Stat v={stats.time} l="tiempo" />
              {stats.speed ? <Stat v={stats.speed} l="km/h prom." /> : null}
              <Stat v={stats.pace} l="min/km" />
            </View>
          </View>
        </View>

        <View style={[styles.actions, { width: cardW }]}>
          <View style={styles.row}>
            <Pressable style={[styles.btn, styles.btnPrimary, styles.flex]} onPress={share} disabled={busy}>
              <ThemedText style={styles.btnPrimaryText}>{busy ? '…' : '↗ Compartir'}</ThemedText>
            </Pressable>
            <Pressable style={[styles.btn, styles.btnGhost, styles.flex]} onPress={save} disabled={busy}>
              <ThemedText type="smallBold" style={styles.btnGhostText}>Guardar</ThemedText>
            </Pressable>
          </View>
          <View style={styles.row}>
            <Pressable style={[styles.btn, styles.btnGhost, styles.flex]} onPress={takePhoto} disabled={busy}>
              <ThemedText type="smallBold" style={styles.btnGhostText}>{photo ? '📷 Otra foto' : '📷 Sacar foto'}</ThemedText>
            </Pressable>
            <Pressable style={[styles.btn, styles.btnGhost, styles.flex]} onPress={pickPhoto} disabled={busy}>
              <ThemedText type="smallBold" style={styles.btnGhostText}>🖼 Galería</ThemedText>
            </Pressable>
          </View>
          <Pressable style={styles.close} onPress={onClose}>
            <ThemedText type="smallBold" style={styles.closeText}>Cerrar</ThemedText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Stat({ v, l }: { v: string; l: string }) {
  return (
    <View style={styles.stat}>
      <ThemedText style={styles.statV}>{v}</ThemedText>
      <ThemedText style={styles.statL}>{l}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center', padding: Spacing.three, gap: Spacing.three },
  // Esquinas rectas (square) + tamaño pantalla → lista para story/post.
  card: { backgroundColor: CARD_BG, overflow: 'hidden', justifyContent: 'space-between', padding: Spacing.four },
  top: { gap: 2 },
  brand: { color: '#f0f2f3', fontSize: 13, fontWeight: '900', letterSpacing: 3 },
  brandAccent: { color: BrandAccent },
  when: { color: '#aeb6ba', fontSize: 12, marginTop: 2 },
  bottom: { gap: Spacing.two },
  km: { color: '#ffffff', fontSize: 64, lineHeight: 70, fontWeight: '900', letterSpacing: -1 },
  statsRow: { flexDirection: 'row', gap: Spacing.four },
  stat: { gap: 1 },
  statV: { color: BrandAccent, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  statL: { color: '#cfd4d6', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  actions: { gap: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two },
  flex: { flex: 1 },
  btn: { paddingVertical: 13, paddingHorizontal: Spacing.three, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: BrandAccent },
  btnPrimaryText: { color: '#06281d', fontWeight: '800' },
  btnGhost: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  btnGhostText: { color: '#e8eaeb' },
  close: { alignItems: 'center', paddingVertical: Spacing.two },
  closeText: { color: '#aeb6ba' },
});
