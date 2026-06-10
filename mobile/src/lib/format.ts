/** Formateo de métricas de running (funciones puras, testeables). */

export function formatKm(distanceM: number): string {
  return `${(distanceM / 1000).toFixed(2).replace('.', ',')} km`;
}

/** 3725 s → "1:02:05"; 605 s → "10:05" */
export function formatDuration(totalS: number): string {
  const s = Math.max(0, Math.round(totalS));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

/** 300 s/km → "5:00 /km" */
export function formatPace(sPerKm: number | null | undefined): string {
  if (!sPerKm || !isFinite(sPerKm)) return '--:-- /km';
  const m = Math.floor(sPerKm / 60);
  const s = Math.round(sPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')} /km`;
}

/** ISO → "mar 10 jun, 18:30" (es-AR) */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
