/** Abre el checkout de Mercado Pago (compartido por Perfil y los muros premium). */
import { Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { api, ApiError } from '@/lib/api';

export async function goPremium(): Promise<void> {
  try {
    const info = await api.billingInfo();
    if (!info.available) {
      Alert.alert('Muy pronto', 'El pago todavía no está habilitado. ¡Avisaremos cuando se pueda!');
      return;
    }
    const { init_point } = await api.subscribe();
    await WebBrowser.openBrowserAsync(init_point);
  } catch (e) {
    Alert.alert('Ups', e instanceof ApiError ? e.message : 'No se pudo abrir el pago.');
  }
}
