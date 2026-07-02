/**
 * Croquis del recorrido: dibuja el polyline de la salida como trazo SVG
 * normalizado (sin tiles de mapa: funciona en Expo Go, sin API keys y sin red).
 * Punto verde = largada, punto claro = llegada.
 */
import { useMemo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';

import { BrandAccent } from '@/constants/theme';
import { decodePolyline } from '@/lib/tracking';

const W = 300;
const H = 150;
const PAD = 12;

export function RouteSketch({
  polyline,
  stroke = BrandAccent,
  height = H,
  style,
}: {
  polyline: string;
  stroke?: string;
  /** alto en px; el trazo escala uniforme (viewBox fijo) */
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { points, start, end } = useMemo(() => {
    const path = decodePolyline(polyline);
    if (path.length < 2) return { points: '', start: null, end: null };

    // Bounding box → proyección equirectangular simple (suficiente para
    // recorridos de pocos km) escalada al viewBox con aspecto conservado.
    const lats = path.map((p) => p.lat);
    const lons = path.map((p) => p.lon);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    // Corrección por latitud: 1° de lon mide cos(lat) veces lo que 1° de lat.
    const midLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
    const spanX = Math.max((maxLon - minLon) * Math.cos(midLat), 1e-6);
    const spanY = Math.max(maxLat - minLat, 1e-6);
    const scale = Math.min((W - PAD * 2) / spanX, (H - PAD * 2) / spanY);
    const offX = (W - spanX * scale) / 2;
    const offY = (H - spanY * scale) / 2;

    const xy = path.map((p) => ({
      x: offX + (p.lon - minLon) * Math.cos(midLat) * scale,
      y: offY + (maxLat - p.lat) * scale, // norte arriba
    }));
    return {
      points: xy.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
      start: xy[0],
      end: xy[xy.length - 1],
    };
  }, [polyline]);

  if (!points) return null;

  return (
    <View style={style}>
      <Svg width="100%" height={height} viewBox={`0 0 ${W} ${H}`}>
        <Polyline
          points={points}
          fill="none"
          stroke={stroke}
          strokeWidth={3}
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={0.9}
        />
        {start && <Circle cx={start.x} cy={start.y} r={5} fill={stroke} />}
        {end && (
          <Circle cx={end.x} cy={end.y} r={5} fill="#fff" stroke={stroke} strokeWidth={2} />
        )}
      </Svg>
    </View>
  );
}
