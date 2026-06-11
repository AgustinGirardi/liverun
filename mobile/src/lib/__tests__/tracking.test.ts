/** Tests de la lógica pura de tracking (sin GPS ni React). */
import {
  addPoint,
  autoPauseStep,
  avgPaceSPerKm,
  currentPaceSPerKm,
  encodePolyline,
  haversineM,
  newTracker,
  type GeoPoint,
} from '../tracking';

// ~111.32 m por 0.001° de latitud; útil para armar recorridos sintéticos.
const STEP_LAT = 0.001;
const STEP_M = 111.32;

function pt(i: number, tMs: number, accuracy = 5): GeoPoint {
  return { lat: -31.4 + i * STEP_LAT, lon: -64.18, t: tMs, accuracy };
}

describe('haversineM', () => {
  it('distancia conocida: 0.001° de latitud ≈ 111,3 m', () => {
    const d = haversineM({ lat: -31.4, lon: -64.18 }, { lat: -31.399, lon: -64.18 });
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112.5);
  });

  it('mismo punto = 0', () => {
    expect(haversineM({ lat: -31.4, lon: -64.18 }, { lat: -31.4, lon: -64.18 })).toBe(0);
  });
});

describe('addPoint', () => {
  it('acumula distancia entre puntos aceptados', () => {
    let st = newTracker();
    ({ state: st } = addPoint(st, pt(0, 0), 0));
    ({ state: st } = addPoint(st, pt(1, 30_000), 30));
    ({ state: st } = addPoint(st, pt(2, 60_000), 60));
    expect(st.distanceM).toBeCloseTo(2 * STEP_M, 0);
    expect(st.path).toHaveLength(3);
  });

  it('descarta lecturas con mala precisión', () => {
    let st = newTracker();
    ({ state: st } = addPoint(st, pt(0, 0), 0));
    const r = addPoint(st, pt(1, 30_000, 80), 30); // accuracy 80 m > umbral
    expect(r.accepted).toBe(false);
    expect(r.state.distanceM).toBe(0);
  });

  it('descarta saltos de GPS imposibles (velocidad absurda)', () => {
    let st = newTracker();
    ({ state: st } = addPoint(st, pt(0, 0), 0));
    // 111 m en 1 segundo = 111 m/s: rebote de GPS, no un corredor.
    const r = addPoint(st, pt(1, 1_000), 1);
    expect(r.accepted).toBe(false);
    expect(r.state.distanceM).toBe(0);
  });

  it('corta el split al completar cada km, interpolando el tiempo', () => {
    let st = newTracker();
    let completed: number[] = [];
    // 10 tramos de ~111 m cada 30 s → cruza el km en el tramo 9.
    for (let i = 0; i <= 10; i++) {
      const r = addPoint(st, pt(i, i * 30_000), i * 30);
      st = r.state;
      if (r.completedKm) completed.push(r.completedKm);
    }
    expect(completed).toEqual([1]);
    expect(st.splits).toHaveLength(1);
    // El km se completa a los ~1000/111.32*30 ≈ 269.5 s (interpolado, no 270).
    expect(st.splits[0]).toBeGreaterThan(265);
    expect(st.splits[0]).toBeLessThan(272);
  });
});

describe('ritmos', () => {
  it('ritmo promedio: 5 km en 25 min = 300 s/km', () => {
    expect(avgPaceSPerKm(5000, 1500)).toBeCloseTo(300);
  });

  it('sin distancia razonable no hay ritmo', () => {
    expect(avgPaceSPerKm(10, 60)).toBeNull();
  });

  it('ritmo actual desde velocidad: 3,33 m/s = 300 s/km', () => {
    expect(currentPaceSPerKm(10 / 3)).toBeCloseTo(300);
  });

  it('parado no hay ritmo actual', () => {
    expect(currentPaceSPerKm(0.1)).toBeNull();
  });
});

describe('autoPauseStep', () => {
  it('pausa tras estar quieto el tiempo umbral, no antes', () => {
    let ap = { paused: false, stillSince: null as number | null };
    ap = autoPauseStep(ap, 0.2, 0); // empieza quieto
    expect(ap.paused).toBe(false);
    ap = autoPauseStep(ap, 0.2, 3_000); // 3 s quieto: todavía no
    expect(ap.paused).toBe(false);
    ap = autoPauseStep(ap, 0.2, 6_000); // 6 s quieto: pausa
    expect(ap.paused).toBe(true);
  });

  it('moverse resetea el contador de quietud', () => {
    let ap = { paused: false, stillSince: null as number | null };
    ap = autoPauseStep(ap, 0.2, 0);
    ap = autoPauseStep(ap, 3.0, 3_000); // se movió
    ap = autoPauseStep(ap, 0.2, 4_000); // quieto de nuevo: cuenta desde acá
    ap = autoPauseStep(ap, 0.2, 8_000); // 4 s: aún no pausa
    expect(ap.paused).toBe(false);
  });

  it('retoma solo al superar el umbral de reanudación (histéresis)', () => {
    let ap = { paused: true, stillSince: null as number | null };
    ap = autoPauseStep(ap, 0.8, 0); // caminando lento: sigue en pausa
    expect(ap.paused).toBe(true);
    ap = autoPauseStep(ap, 2.0, 1_000); // corriendo: retoma
    expect(ap.paused).toBe(false);
  });
});

describe('encodePolyline', () => {
  it('codifica el ejemplo de referencia de Google', () => {
    const path = [
      { lat: 38.5, lon: -120.2 },
      { lat: 40.7, lon: -120.95 },
      { lat: 43.252, lon: -126.453 },
    ];
    expect(encodePolyline(path)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  });

  it('camino vacío = string vacío', () => {
    expect(encodePolyline([])).toBe('');
  });
});
