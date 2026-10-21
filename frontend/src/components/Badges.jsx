import { useState, useEffect } from "react"
import { Icon } from "./Icon.jsx"
import { RACE_STATUS, REG_STATUS, timeAgo } from "../lib/estados.js"
import { notify } from "../lib/ui-store.js"
import { C, FONT_NUM, RADIUS } from "../theme.js"

// Chip de publicación: guarda el "hace X" fresco con su propio timer, así el
// padre no re-renderiza entero cada minuto.
export function PublishedChip({ race }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 60000)
    return () => clearInterval(t)
  }, [])
  const copy = () => {
    navigator.clipboard.writeText(race.published_code || "")
      .then(() => notify("Código copiado", { kind: "success" }))
      .catch(() => notify("No se pudo copiar el código", { kind: "error" }))
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 6px 4px 10px", background: C.surface2, border: `1px solid ${C.lineStrong}`, borderRadius: RADIUS.pill, color: C.muted, fontSize: 12, whiteSpace: "nowrap" }}>
      <span>{race.status === "PLANNED" ? "Anunciado" : "Publicado"}</span>
      {race.published_code && (
        <>
          <span aria-hidden="true">·</span>
          <span>código</span>
          <span style={{ ...FONT_NUM, fontFamily: "ui-monospace, Consolas, monospace", color: C.fg, fontWeight: 700 }}>{race.published_code}</span>
          <button onClick={copy} title="Copiar código" aria-label="Copiar código"
            style={{ display: "inline-flex", alignItems: "center", padding: 3, background: "transparent", border: "none", color: C.muted, cursor: "pointer" }}>
            <Icon name="copy" size={13} />
          </button>
        </>
      )}
      <span aria-hidden="true">·</span>
      <span>{timeAgo(race.published_at)}</span>
    </span>
  )
}

export function RaceStatusBadge({ status }) {
  const s = RACE_STATUS[status] || RACE_STATUS.PLANNED
  return (
    <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 600 }}>
      {s.label}
    </span>
  )
}

export function RegStatusBadge({ status }) {
  const s = REG_STATUS[status] || REG_STATUS.OK
  if (status === "OK") return null
  return (
    <span style={{ background: s.color + "20", color: s.color, border: `1px solid ${s.color}40`, borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>
      {s.label}
    </span>
  )
}
