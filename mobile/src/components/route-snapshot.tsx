/**
 * Imagen estática del recorrido sobre un mapa real, para la tarjeta de
 * compartir. Renderiza un mapa (react-native-maps) con el trazo y le saca una
 * foto con takeSnapshot(): el resultado es un bitmap que react-native-view-shot
 * captura de forma fiable (capturar el mapa nativo EN VIVO suele salir en
 * blanco en la imagen compartida). Sin módulo nativo (Expo Go Android / web) o
 * si el snapshot falla, cae al croquis SVG — así la tarjeta nunca queda vacía.
 */
import Constants from 'expo-constants';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Image, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { RouteSketch } from '@/components/route-sketch';
import { BrandAccent } from '@/constants/theme';
import { decodePolyline } from '@/lib/tracking';

// react-native-maps está en Expo Go de iOS (Apple Maps) pero NO en el de
// Android; en development/production builds está en ambos.
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

function regionFor(coords: LatLon[]) {
  const lats = coords.map((p) => p.lat);
  const lons = coords.map((p) => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.4, 0.006),
    longitudeDelta: Math.max((maxLon - minLon) * 1.4, 0.006),
  };
}

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
  const coords = useMemo(() => decodePolyline(polyline), [polyline]);
  const mapRef = useRef<any>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // Al estar listo el mapa: encuadrar el recorrido y, tras un respiro para que
  // carguen los tiles, sacar la foto. El bitmap resultante es lo que se captura.
  const grab = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.fitToCoordinates(
      coords.map((c) => ({ latitude: c.lat, longitude: c.lon })),
      { edgePadding: { top: 24, right: 24, bottom: 24, left: 24 }, animated: false },
    );
    setTimeout(() => {
      map
        .takeSnapshot({ format: 'png', result: 'file' })
        .then((uri: string) => (uri ? setShot(uri) : setFailed(true)))
        .catch(() => setFailed(true));
    }, 900);
  }, [coords]);

  if (coords.length < 2) return null;
  if (!MapView || failed) {
    return <RouteSketch polyline={polyline} stroke={stroke} height={height} style={style} />;
  }

  return (
    <View style={[{ height }, styles.wrap, style]}>
      {shot ? (
        <Image source={{ uri: shot }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          scrollEnabled={false}
          zoomEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
          toolbarEnabled={false}
          showsCompass={false}
          showsPointsOfInterest={false}
          initialRegion={regionFor(coords)}
          onMapReady={grab}
        >
          <MapPolyline
            coordinates={coords.map((p) => ({ latitude: p.lat, longitude: p.lon }))}
            strokeColor={stroke}
            strokeWidth={4}
            lineJoin="round"
            lineCap="round"
          />
        </MapView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
});
