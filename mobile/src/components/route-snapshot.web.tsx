/**
 * Variante web de RouteSnapshot: react-native-maps es solo-nativo (rompe el
 * bundle web de Metro), así que acá el recorrido es siempre el croquis SVG.
 * Misma interfaz que route-snapshot.tsx — Metro elige este archivo en web.
 */
import { type StyleProp, type ViewStyle } from 'react-native';

import { RouteSketch } from '@/components/route-sketch';
import { BrandAccent } from '@/constants/theme';

export function RouteSnapshot({
  polyline,
  height = 190,
  stroke = BrandAccent,
  style,
}: {
  polyline: string;
  height?: number;
  stroke?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return <RouteSketch polyline={polyline} stroke={stroke} height={height} style={style} />;
}
