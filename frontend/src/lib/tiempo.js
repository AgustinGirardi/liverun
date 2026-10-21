// ── Utilidades ────────────────────────────────────────────────────────────────

export function pad(n, l = 2) { return String(n).padStart(l, "0") }

// "2026-09-13" -> "13 sep 2026". Se parsea a mano: new Date("2026-09-13") toma
// UTC y en Argentina corre el día para atrás.
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]

export function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "")
  if (!m || +m[2] < 1 || +m[2] > 12) return iso || ""
  return `${+m[3]} ${MESES[+m[2] - 1]} ${m[1]}`
}

// Cronómetro de carrera hh:mm:ss.cc a partir de milisegundos transcurridos.
// Negativos (el reloj de la PC atrasa respecto de la largada) se muestran en cero.
export function formatCronometro(ms) {
  const d = Math.max(0, ms)
  return `${pad(Math.floor(d / 3600000))}:${pad(Math.floor(d % 3600000 / 60000))}:${pad(Math.floor(d % 60000 / 1000))}.${pad(Math.floor(d % 1000 / 10))}`
}

export function formatNs(ns) {
  if (!ns && ns !== 0) return "--:--:--.---"
  const ms = Number(BigInt(ns) / 1000000n)
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const f = ms % 1000
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(f, 3)}`
}

// Hora del día (hh:mm:ss.cc) de un instante epoch en ns. Para capturas sin
// largada: formatNs(epoch) daría una "duración" absurda (497000:13:45).
export function horaDeCaptura(ns) {
  if (!ns) return "—"
  const d = new Date(Math.floor(Number(ns) / 1_000_000))
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(Math.floor(d.getMilliseconds() / 10))}`
}

// Tiempo neto si hay largada; si no, la hora de llegada; si no, "—".
export function formatTiempo(netNs, capturedNs) {
  if (netNs != null) return formatNs(netNs)
  return horaDeCaptura(capturedNs)
}

// Ritmo en min/km ("4:52 /km"); vacío si falta tiempo neto o distancia.
export function formatPace(netNs, km) {
  if (!netNs || !km) return ""
  const secPerKm = Math.round(netNs / 1e9 / km)
  return `${Math.floor(secPerKm / 60)}:${String(secPerKm % 60).padStart(2, "0")} /km`
}

// Hora hh:mm:ss.cc escrita por el operador → epoch ns, en el mismo día que `baseNs`.
export function horaANs(texto, baseNs) {
  const m = /^\s*(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,3}))?)?\s*$/.exec(texto || "")
  if (!m) return null
  const [h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3] || 0)]
  if (h > 23 || mi > 59 || s > 59) return null
  const frac = m[4] ? Number(m[4].padEnd(3, "0")) : 0
  const d = baseNs ? new Date(Math.floor(baseNs / 1_000_000)) : new Date()
  d.setHours(h, mi, s, frac)
  return d.getTime() * 1_000_000
}
