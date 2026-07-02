/** Tests del snapshot de sesión (recuperación tras un cierre de la app). */
import { buildSnapshot, isValidSnapshot, restoreFields } from '../session-snapshot';
import { newTracker, type TrackerState } from '../tracking';

function trackerWithData(): TrackerState {
  return {
    ...newTracker(),
    last: { lat: -31.4, lon: -64.18, t: 1_000_000 },
    distanceM: 5230,
    elapsedS: 1500,
    splits: [301.2, 295.8, 310.0, 299.5, 305.1],
    speedMps: 3.3,
    path: [{ lat: -31.4, lon: -64.18 }, { lat: -31.41, lon: -64.18 }],
  };
}

describe('buildSnapshot / restoreFields', () => {
  it('el tiempo neto y los datos sobreviven al cierre; el tiempo muerto no cuenta', () => {
    const t0 = 1_750_000_000_000;
    const snap = buildSnapshot({
      phase: 'running',
      startedAt: new Date('2026-07-01T10:00:00Z'),
      netElapsedMs: 1_500_000, // 25 min corriendo
      tracker: trackerWithData(),
      now: t0,
    });

    // La app estuvo muerta 2 horas; el usuario la reabre.
    const now = t0 + 2 * 3600_000;
    const f = restoreFields(snap, now);

    expect(f.phase).toBe('paused'); // vuelve pausada, decide el usuario
    expect(now - f.startMs).toBe(1_500_000); // el neto sigue siendo 25 min
    expect(f.pausedAccumMs).toBe(0);
    expect(f.pauseStartedMs).toBe(now);
    expect(f.startedAt.toISOString()).toBe('2026-07-01T10:00:00.000Z');
    // Datos intactos, pero re-anclado (el GPS viejo no sirve de referencia).
    expect(f.tracker.distanceM).toBe(5230);
    expect(f.tracker.splits).toHaveLength(5);
    expect(f.tracker.path).toHaveLength(2);
    expect(f.tracker.last).toBeNull();
  });
});

describe('isValidSnapshot', () => {
  it('acepta un snapshot bien formado', () => {
    const snap = buildSnapshot({
      phase: 'paused',
      startedAt: new Date(),
      netElapsedMs: 60_000,
      tracker: trackerWithData(),
      now: Date.now(),
    });
    expect(isValidSnapshot(JSON.parse(JSON.stringify(snap)))).toBe(true);
  });

  it('rechaza basura y versiones desconocidas', () => {
    expect(isValidSnapshot(null)).toBe(false);
    expect(isValidSnapshot({})).toBe(false);
    expect(isValidSnapshot({ v: 2, phase: 'running' })).toBe(false);
    expect(isValidSnapshot({ v: 1, phase: 'idle' })).toBe(false);
  });
});
