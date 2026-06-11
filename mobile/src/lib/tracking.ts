/**
 * Lógica pura del tracking de una salida (sin GPS ni React: testeable con Jest).
 *
 * El GPS entrega lecturas crudas; acá se filtran (precisión mala, saltos
 * imposibles), se acumula la distancia con haversine, se cortan los splits por
 * km y se decide la auto-pausa. La pantalla Correr solo orquesta.
 */

export type GeoPoint = {
  lat: number;
  lon: number;
  /** epoch ms */
  t: number;
  /** precisión reportada por el GPS, en metros (menor = mejor) */
  accuracy?: number | null;
};

/** Lecturas con peor precisión que esto se descartan (típico al arrancar). */
export const MAX_ACCURACY_M = 30;
/** Velocidad máxima creíble corriendo (m/s); por encima es un salto de GPS. */
export const MAX_SPEED_MPS = 12.5;
/** Por debajo de esta velocidad sostenida se considera quieto (auto-pausa). */
export const AUTO_PAUSE_BELOW_MPS = 0.55;
/** Por encima de esta velocidad se retoma de la auto-pausa. */
export const AUTO_RESUME_ABOVE_MPS = 1.2;
/** Segundos quieto antes de auto-pausar (evita pausas por semáforo de 2 s). */
export const AUTO_PAUSE_AFTER_S = 5;

const EARTH_R = 6371000;

/** Distancia haversine entre dos puntos, en metros. */
export function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

export type TrackerState = {
  /** último punto aceptado (base para distancia y velocidad) */
  last: GeoPoint | null;
  distanceM: number;
  /** tiempo neto corriendo (s) en el momento del último punto aceptado */
  elapsedS: number;
  /** segundos de cada km completado, ej [301.2, 295.8] */
  splits: number[];
  /** velocidad instantánea (m/s) entre los dos últimos puntos aceptados */
  speedMps: number;
  /** recorrido aceptado (para polyline / mapa) */
  path: { lat: number; lon: number }[];
};

export function newTracker(): TrackerState {
  return { last: null, distanceM: 0, elapsedS: 0, splits: [], speedMps: 0, path: [] };
}

export type AddResult = {
  state: TrackerState;
  accepted: boolean;
  /** número de km recién completado (1, 2, ...) o null */
  completedKm: number | null;
};

/**
 * Procesa una lectura del GPS. `elapsedS` es el tiempo neto de corrida
 * (sin pausas) en el momento de la lectura — lo lleva la pantalla.
 * Inmutable: devuelve un estado nuevo.
 */
export function addPoint(state: TrackerState, p: GeoPoint, elapsedS: number): AddResult {
  // Filtro de precisión: lecturas malas no suman ni mueven el cursor.
  if (p.accuracy != null && p.accuracy > MAX_ACCURACY_M) {
    return { state, accepted: false, completedKm: null };
  }
  if (!state.last) {
    const st = { ...state, last: p, elapsedS, path: [{ lat: p.lat, lon: p.lon }] };
    return { state: st, accepted: true, completedKm: null };
  }

  const dtS = (p.t - state.last.t) / 1000;
  if (dtS <= 0) return { state, accepted: false, completedKm: null };

  const dM = haversineM(state.last, p);
  const speed = dM / dtS;
  // Salto imposible (rebote de GPS): se ignora la lectura.
  if (speed > MAX_SPEED_MPS) {
    return { state, accepted: false, completedKm: null };
  }

  const prevKm = Math.floor(state.distanceM / 1000);
  const distanceM = state.distanceM + dM;
  const newKm = Math.floor(distanceM / 1000);

  let splits = state.splits;
  let completedKm: number | null = null;
  if (newKm > prevKm) {
    // Tiempo del km: interpolación lineal dentro del último tramo.
    const overM = distanceM - newKm * 1000;
    const ratio = dM > 0 ? (dM - overM) / dM : 1;
    const tAtKm = state.elapsedS + (elapsedS - state.elapsedS) * ratio;
    const prevTotal = state.splits.reduce((a, b) => a + b, 0);
    splits = [...state.splits, Math.max(0, tAtKm - prevTotal)];
    completedKm = newKm;
  }

  const st: TrackerState = {
    last: p,
    distanceM,
    elapsedS,
    splits,
    speedMps: speed,
    path: [...state.path, { lat: p.lat, lon: p.lon }],
  };
  return { state: st, accepted: true, completedKm };
}

/** Ritmo promedio en s/km (null si todavía no hay distancia razonable). */
export function avgPaceSPerKm(distanceM: number, elapsedS: number): number | null {
  if (distanceM < 50) return null;
  return elapsedS / (distanceM / 1000);
}

/** Ritmo actual en s/km a partir de la velocidad instantánea. */
export function currentPaceSPerKm(speedMps: number): number | null {
  if (speedMps < 0.4) return null;
  return 1000 / speedMps;
}

export type AutoPauseState = {
  paused: boolean;
  /** epoch ms desde que la velocidad está bajo el umbral (null = en movimiento) */
  stillSince: number | null;
};

/**
 * Decide la auto-pausa con histéresis: quieto sostenido AUTO_PAUSE_AFTER_S
 * segundos → pausa; superar AUTO_RESUME_ABOVE_MPS → retoma.
 */
export function autoPauseStep(ap: AutoPauseState, speedMps: number, nowMs: number): AutoPauseState {
  if (ap.paused) {
    return speedMps >= AUTO_RESUME_ABOVE_MPS ? { paused: false, stillSince: null } : ap;
  }
  if (speedMps < AUTO_PAUSE_BELOW_MPS) {
    const since = ap.stillSince ?? nowMs;
    if ((nowMs - since) / 1000 >= AUTO_PAUSE_AFTER_S) {
      return { paused: true, stillSince: null };
    }
    return { paused: false, stillSince: since };
  }
  return { paused: false, stillSince: null };
}

/**
 * Codifica el recorrido como encoded polyline (formato Google, precisión 1e-5):
 * compacto (~2 KB por salida) y estándar para dibujar mapas después.
 */
export function encodePolyline(path: { lat: number; lon: number }[]): string {
  let out = '';
  let prevLat = 0;
  let prevLon = 0;
  for (const p of path) {
    const lat = Math.round(p.lat * 1e5);
    const lon = Math.round(p.lon * 1e5);
    out += encodeVarint(lat - prevLat) + encodeVarint(lon - prevLon);
    prevLat = lat;
    prevLon = lon;
  }
  return out;
}

function encodeVarint(v: number): string {
  let n = v < 0 ? ~(v << 1) : v << 1;
  let s = '';
  while (n >= 0x20) {
    s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
    n >>= 5;
  }
  s += String.fromCharCode(n + 63);
  return s;
}
