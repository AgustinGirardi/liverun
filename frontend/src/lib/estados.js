import { C } from "../theme.js"

// ── StatusBadge ───────────────────────────────────────────────────────────────

export const RACE_STATUS = {
  PLANNED:  { bg: `${C.blue}15`, color: C.blue, border: `${C.blue}30`, label: "En preparación" },
  ACTIVE:   { bg: `${C.accent}15`, color: C.accent, border: `${C.accent}30`, label: "En curso" },
  FINISHED: { bg: `${C.gold}15`, color: C.gold, border: `${C.gold}30`, label: "Finalizada" },
}

export const REG_STATUS = {
  OK:  { color: C.faint,  label: "OK" },
  DNS: { color: C.muted,  label: "DNS" },
  DNF: { color: C.gold,  label: "DNF" },
  DQ:  { color: C.danger,  label: "DQ" },
}

// "hace 3 min" en rioplatense. El backend guarda UTC sin zona: se le agrega la Z
// para que el navegador no lo lea como hora local.
export function timeAgo(iso) {
  if (!iso) return ""
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z")
  const min = Math.floor((Date.now() - d.getTime()) / 60000)
  if (min < 1) return "recién"
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const dias = Math.floor(h / 24)
  if (dias === 1) return "ayer"
  if (dias <= 7) return `hace ${dias} días`
  const pad = n => String(n).padStart(2, "0")
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}
