import { type Activity, type Summary } from '@/lib/api';
import { computeBadges, computeRecords, kmByWeek, weekStart } from '@/lib/progress';

const act = (started_at: string, km: number, paceS?: number): Activity => ({
  id: Math.random(),
  client_uuid: String(Math.random()),
  started_at,
  duration_s: paceS ? Math.round(km * paceS) : km * 300,
  distance_m: km * 1000,
  avg_pace_s_per_km: paceS ?? null,
});

describe('weekStart', () => {
  it('devuelve el lunes 00:00 de la semana', () => {
    const ws = weekStart(new Date('2026-06-17T15:00:00')); // miércoles
    expect(ws.getDay()).toBe(1); // lunes
    expect(ws.getHours()).toBe(0);
  });
});

describe('kmByWeek', () => {
  const now = new Date('2026-06-17T12:00:00'); // miércoles
  it('agrupa km en la semana correcta y marca la actual', () => {
    const acts = [act('2026-06-16T08:00:00', 5), act('2026-06-15T08:00:00', 3)]; // esta semana
    const buckets = kmByWeek(acts, 8, now);
    expect(buckets).toHaveLength(8);
    expect(buckets[7].isCurrent).toBe(true);
    expect(buckets[7].km).toBeCloseTo(8);
  });
  it('ignora salidas anteriores a la ventana', () => {
    const buckets = kmByWeek([act('2025-01-01T08:00:00', 10)], 8, now);
    expect(buckets.reduce((a, b) => a + b.km, 0)).toBe(0);
  });
});

describe('computeRecords', () => {
  it('calcula total, más larga y mejor ritmo (>=2km)', () => {
    const rec = computeRecords([act('2026-06-16T08:00:00', 10, 300), act('2026-06-10T08:00:00', 5, 280), act('2026-06-09T08:00:00', 1, 200)]);
    expect(rec.runs).toBe(3);
    expect(rec.totalKm).toBeCloseTo(16);
    expect(rec.longestKm).toBe(10);
    expect(rec.bestPaceSPerKm).toBe(280); // el de 1 km (pace 200) no cuenta
  });
});

describe('computeBadges', () => {
  const summary: Summary = { streak_weeks: 3, week: { days_run: 4, goal: 4, km: 20 }, month: { km: 50, activities: 8, days_run: 6, run_dates: [] } };
  it('desbloquea según los datos', () => {
    const rec = computeRecords([act('2026-06-16T08:00:00', 12, 300)]);
    const badges = computeBadges(summary, rec);
    const by = Object.fromEntries(badges.map((b) => [b.key, b.earned]));
    expect(by.first).toBe(true);
    expect(by.streak).toBe(true);
    expect(by.goal).toBe(true);
    expect(by['10k']).toBe(true);
    expect(by['21k']).toBe(false);
    expect(by['100km']).toBe(false);
  });
});
