/**
 * Variante web de RouteMap: react-native-maps es solo-nativo (rompe el bundle
 * web de Metro), así que acá el "mapa" es siempre el croquis SVG. Misma
 * interfaz que route-map.tsx — Metro elige este archivo al exportar web.
 */
import { useMemo } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';

import { RouteSketch } from '@/components/route-sketch';
import { decodePolyline, encodePolyline } from '@/lib/tracking';

type LatLon = { lat: number; lon: number };

export function RouteMap({
  polyline,
  path,
  live: _live = false,
  height = 180,
  style,
}: {
  polyline?: string | null;
  path?: LatLon[];
  live?: boolean;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const coords = useMemo(
    () => path ?? (polyline ? decodePolyline(polyline) : []),
    [path, polyline],
  );
  if (coords.length < 2) return null;
  return <RouteSketch polyline={polyline ?? encodePolyline(coords)} height={height} style={style} />;
}
