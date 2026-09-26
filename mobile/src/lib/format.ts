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
  // Redondear el total primero: con 299,6 s daba "4:60" (segundos → 60).
  const total = Math.round(sPerKm);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')} /km`;
}

/**
 * Fecha del servidor → Date. El backend guarda en UTC pero versiones viejas
 * devuelven el ISO sin zona ("2026-09-23T01:00:00"), y `new Date()` lo toma
 * como hora LOCAL (corría todo 3 h). Si no trae zona, se le agrega "Z".
 * Usar SIEMPRE esto para fechas que vienen de la API, nunca `new Date(iso)`.
 */
export function parseFechaServidor(iso: string): Date {
  // Python puede mandar microsegundos (6 decimales): se recortan a ms.
  const limpio = iso.trim().replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1');
  // Solo fecha ("2026-09-23"): el estándar ya la toma como UTC.
  if (!limpio.includes('T')) return new Date(limpio);
  const tieneZona = /(Z|[+-]\d{2}(:?\d{2})?)$/i.test(limpio);
  return new Date(tieneZona ? limpio : `${limpio}Z`);
}

/** ISO → "mar 10 jun, 18:30" (es-AR) */
export function formatWhen(iso: string): string {
  const d = parseFechaServidor(iso);
  return d.toLocaleDateString('es-AR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
