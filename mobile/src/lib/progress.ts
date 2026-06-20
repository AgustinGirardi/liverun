/**
 * Lógica pura del dashboard de progreso (sin React): km por semana, récords y
 * logros derivados de las salidas. Testeable con Jest.
 */
import { type Activity, type Summary } from '@/lib/api';

export type WeekBucket = { start: Date; km: number; isCurrent: boolean };

/** Lunes 00:00 de la semana que contiene `d`. */
export function weekStart(d: Date): Date {
  const m = new Date(d);
  m.setHours(0, 0, 0, 0);
  const dow = (m.getDay() + 6) % 7; // 0 = lunes
  m.setDate(m.getDate() - dow);
  return m;
}

/** Km totales por semana, de la más vieja a la actual (incluida). */
export function kmByWeek(acts: Activity[], weeks = 8, now = new Date()): WeekBucket[] {
  const curStart = weekStart(now);
  const buckets: WeekBucket[] = Array.from({ length: weeks }, (_, i) => ({
    start: new Date(curStart.getTime() - (weeks - 1 - i) * 7 * 86400000),
    km: 0,
    isCurrent: i === weeks - 1,
  }));
  const first = buckets[0].start.getTime();
  for (const a of acts) {
    const t = new Date(a.started_at).getTime();
    if (t < first) continue;
    for (let i = weeks - 1; i >= 0; i--) {
      if (t >= buckets[i].start.getTime()) { buckets[i].km += a.distance_m / 1000; break; }
    }
  }
  return buckets;
}

export type Records = {
  totalKm: number;
  runs: number;
  longestKm: number;
  bestPaceSPerKm: number | null;
};

export function computeRecords(acts: Activity[]): Records {
  let totalKm = 0;
  let longestKm = 0;
  let bestPace: number | null = null;
  for (const a of acts) {
    const km = a.distance_m / 1000;
    totalKm += km;
    if (km > longestKm) longestKm = km;
    // El mejor ritmo solo cuenta salidas razonables (>= 2 km) para no premiar
    // tramos cortos con ritmo irreal.
    if (a.avg_pace_s_per_km && a.distance_m >= 2000) {
      if (bestPace == null || a.avg_pace_s_per_km < bestPace) bestPace = a.avg_pace_s_per_km;
    }
  }
  return { totalKm, runs: acts.length, longestKm, bestPaceSPerKm: bestPace };
}

export type Badge = { key: string; emoji: string; label: string; earned: boolean };

export function computeBadges(summary: Summary | null, rec: Records): Badge[] {
  const streak = summary?.streak_weeks ?? 0;
  const goalMet = summary ? summary.week.days_run >= summary.week.goal : false;
  return [
    { key: 'first', emoji: '👟', label: 'Primera salida', earned: rec.runs >= 1 },
    { key: 'streak', emoji: '🔥', label: streak >= 2 ? `Racha ${streak} sem` : 'Racha 2 sem', earned: streak >= 2 },
    { key: 'goal', emoji: '🎯', label: 'Meta semanal', earned: goalMet },
    { key: '10k', emoji: '🏔', label: '10K', earned: rec.longestKm >= 10 },
    { key: '21k', emoji: '🏅', label: 'Media maratón', earned: rec.longestKm >= 21 },
    { key: '100km', emoji: '💯', label: '100 km totales', earned: rec.totalKm >= 100 },
  ];
}
