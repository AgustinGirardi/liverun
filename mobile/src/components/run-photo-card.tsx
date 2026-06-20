/**
 * Tarjeta para "capturar el momento" al terminar una salida: el usuario saca
 * una foto con la cámara y la combinamos con sus métricas (km, tiempo y
 * velocidad promedio) en una imagen compartible / guardable en la galería.
 */
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { useRef, useState } from 'react';
import { Alert, Image, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { ThemedText } from '@/components/themed-text';
import { BrandAccent, Spacing } from '@/constants/theme';
import { formatDuration, formatKm, formatPace } from '@/lib/format';
import { type FinishData } from '@/lib/run-session';

type Props = { data: FinishData; onClose: () => void };

export function RunPhotoCard({ data, onClose }: Props) {
  const cardRef = useRef<View>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const km = formatKm(data.distanceM);
  const time = formatDuration(data.durationS);
  const pace = formatPace(data.avgPaceSPerKm).replace(' /km', '');
  const kmh = data.durationS > 0 ? (data.distanceM / data.durationS) * 3.6 : 0;
  const speed = `${kmh.toFixed(1).replace('.', ',')}`;

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Sin permiso de cámara', 'Permití el acceso a la cámara para capturar el momento.');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.9, allowsEditing: false });
    if (!res.canceled && res.assets?.[0]) setPhoto(res.assets[0].uri);
  }

  async function capture(): Promise<string | null> {
    try {
      return await captureRef(cardRef, { format: 'jpg', quality: 0.95 });
    } catch {
      return null;
    }
  }

  async function shareCard() {
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

  async function saveCard() {
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
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {photo ? (
          <View ref={cardRef} collapsable={false} style={styles.card}>
            <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            <LinearGradient
              colors={['transparent', 'rgba(8,10,11,0.92)']}
              style={styles.scrim}
              start={{ x: 0, y: 0.35 }}
              end={{ x: 0, y: 1 }}
            />
            <View style={styles.overlay}>
              <ThemedText style={styles.brand}>
                CHRONO<ThemedText style={[styles.brand, { color: BrandAccent }]}>TRACK</ThemedText> RUN
              </ThemedText>
              <ThemedText style={styles.km}>{km}</ThemedText>
              <View style={styles.statsRow}>
                <View style={styles.stat}>
                  <ThemedText style={styles.statV}>{time}</ThemedText>
                  <ThemedText style={styles.statL}>tiempo</ThemedText>
                </View>
                <View style={styles.stat}>
                  <ThemedText style={styles.statV}>{speed}</ThemedText>
                  <ThemedText style={styles.statL}>km/h prom.</ThemedText>
                </View>
                <View style={styles.stat}>
                  <ThemedText style={styles.statV}>{pace}</ThemedText>
                  <ThemedText style={styles.statL}>min/km</ThemedText>
                </View>
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.prompt}>
            <ThemedText style={styles.promptEmoji}>📸</ThemedText>
            <ThemedText type="subtitle" style={styles.center}>¿Capturás el momento?</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
              Sacá una foto y la combinamos con tus {km}, el tiempo y la velocidad promedio.
            </ThemedText>
          </View>
        )}

        <View style={styles.actions}>
          {!photo ? (
            <Pressable style={[styles.btn, styles.btnPrimary]} onPress={takePhoto}>
              <ThemedText style={styles.btnPrimaryText}>📷 Tomar foto</ThemedText>
            </Pressable>
          ) : (
            <View style={styles.row}>
              <Pressable style={[styles.btn, styles.btnPrimary, styles.flex]} onPress={shareCard} disabled={busy}>
                <ThemedText style={styles.btnPrimaryText}>{busy ? '…' : '↗ Compartir'}</ThemedText>
              </Pressable>
              <Pressable style={[styles.btn, styles.btnGhost]} onPress={saveCard} disabled={busy}>
                <ThemedText type="smallBold">Guardar</ThemedText>
              </Pressable>
              <Pressable style={[styles.btn, styles.btnGhost]} onPress={takePhoto} disabled={busy}>
                <ThemedText type="smallBold">Otra</ThemedText>
              </Pressable>
            </View>
          )}
          <Pressable style={styles.close} onPress={onClose}>
            <ThemedText type="smallBold" themeColor="textSecondary">Cerrar</ThemedText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const CARD_W = 320;
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center', padding: Spacing.three, gap: Spacing.three },
  card: { width: CARD_W, height: CARD_W * 1.25, borderRadius: 20, overflow: 'hidden', backgroundColor: '#0d0f10' },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '70%' },
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: Spacing.four, gap: 2 },
  brand: { color: '#fff', fontSize: 11, fontWeight: '900', letterSpacing: 3, marginBottom: 4 },
  km: { color: '#fff', fontSize: 46, fontWeight: '900', letterSpacing: -1 },
  statsRow: { flexDirection: 'row', gap: Spacing.four, marginTop: Spacing.two },
  stat: { gap: 1 },
  statV: { color: BrandAccent, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  statL: { color: '#cfd4d6', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  prompt: { width: CARD_W, alignItems: 'center', gap: Spacing.two, padding: Spacing.four },
  promptEmoji: { fontSize: 40 },
  center: { textAlign: 'center' },
  actions: { width: CARD_W, gap: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two },
  flex: { flex: 1 },
  btn: { paddingVertical: 13, paddingHorizontal: Spacing.three, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: BrandAccent },
  btnPrimaryText: { color: '#06281d', fontWeight: '800' },
  btnGhost: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  close: { alignItems: 'center', paddingVertical: Spacing.two },
});
