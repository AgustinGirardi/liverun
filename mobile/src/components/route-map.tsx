/**
 * Mapa real del recorrido (react-native-maps: Apple Maps en iOS, Google en
 * Android). En Expo Go de Android el módulo nativo no existe → cae al croquis
 * SVG (RouteSketch). Dos modos:
 *   - estático: encuadra el recorrido completo (detalle de una salida)
 *   - live: sigue al corredor mientras corre (pantalla Correr)
 */
import Constants from 'expo-constants';
import { useMemo } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { RouteSketch } from '@/components/route-sketch';
import { BrandAccent } from '@/constants/theme';
import { decodePolyline, encodePolyline } from '@/lib/tracking';

// react-native-maps está en Expo Go de iOS (Apple Maps, sin API key) pero NO
// en el de Android; en development/production builds está en ambos.
const NATIVE_MAPS = Platform.OS === 'ios' || Constants.appOwnership !== 'expo';

let MapView: any = null;
let MapPolyline: any = null;
if (NATIVE_MAPS) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const maps = require('react-native-maps');
    MapView = maps.default;
    MapPolyline = maps.Polyline;
  } catch {
    MapView = null;
  }
}

type LatLon = { lat: number; lon: number };

function regionFor(coords: LatLon[], live: boolean) {
  const lats = coords.map((p) => p.lat);
  const lons = coords.map((p) => p.lon);
  if (live) {
    // Seguir al corredor: centrado en el último punto, zoom de calle.
    const last = coords[coords.length - 1];
    return { latitude: last.lat, longitude: last.lon, latitudeDelta: 0.006, longitudeDelta: 0.006 };
  }
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.5, 0.008),
    longitudeDelta: Math.max((maxLon - minLon) * 1.5, 0.008),
  };
}

export function RouteMap({
  polyline,
  path,
  live = false,
  height = 180,
  style,
}: {
  /** encoded polyline (salidas guardadas)… */
  polyline?: string | null;
  /** …o el camino crudo (salida en curso) */
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

  if (!MapView) {
    // Sin módulo nativo (Expo Go Android / web): croquis SVG.
    const encoded = polyline ?? encodePolyline(coords);
    return <RouteSketch polyline={encoded} height={height} style={style} />;
  }

  return (
    <View style={[styles.wrap, { height }, style]}>
      <MapView
        style={StyleSheet.absoluteFill}
        initialRegion={regionFor(coords, live)}
        showsUserLocation={live}
        followsUserLocation={live} // iOS: la cámara sigue al corredor
        scrollEnabled={!live}
        zoomEnabled={!live}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        showsCompass={false}
        showsPointsOfInterest={false}
      >
        <MapPolyline
          coordinates={coords.map((p) => ({ latitude: p.lat, longitude: p.lon }))}
          strokeColor={BrandAccent}
          strokeWidth={4}
          lineJoin="round"
          lineCap="round"
        />
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 16, overflow: 'hidden' },
});
