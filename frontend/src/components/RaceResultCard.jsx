import { useState, useEffect } from "react"
import { RaceStatusBadge } from "./Badges.jsx"
import { Icon } from "./Icon.jsx"
import { API } from "../lib/api.js"
import { formatDate } from "../lib/tiempo.js"
import { BTN_PRIMARY, C, CARD, FONT_DISPLAY, FONT_NUM, RADIUS, WITH_ICON } from "../theme.js"

export function RaceResultCard({ race, onOpen }) {
  const [stats, setStats] = useState(null)

  useEffect(() => {
    fetch(API + "/races/" + race.id + "/results")
      .then(r => r.json())
      .then(d => setStats({ finishers: d.total_finishers, registered: d.total_registered, dnf: d.dnf_list.length }))
      .catch(() => {})
  }, [race.id])

  const pct = stats && stats.registered > 0
    ? Math.round((stats.finishers / stats.registered) * 100)
    : 0

  return (
    <div style={{ ...CARD, cursor: "pointer", transition: "border-color 0.15s" }}
      onClick={onOpen}
      onMouseEnter={e => e.currentTarget.style.borderColor = `${C.accent}60`}
      onMouseLeave={e => e.currentTarget.style.borderColor = C.line}>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 15, flex: 1, paddingRight: 8 }}>{race.name}</div>
        <RaceStatusBadge status={race.status} />
      </div>

      <div style={{ fontSize: 12, color: C.faint, marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
        {race.race_date && <span style={{ ...WITH_ICON, gap: 5 }}><Icon name="calendar" size={13} />{formatDate(race.race_date)}</span>}
        {race.location && <span style={{ ...WITH_ICON, gap: 5 }}><Icon name="pin" size={13} />{race.location}</span>}
      </div>

      {stats ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
            {[
              ["Finishers", stats.finishers, C.accent],
              ["Inscritos", stats.registered, null],
              ["DNS/DNF",   stats.dnf,        stats.dnf > 0 ? C.gold : null],
            ].map(([label, val, color]) => (
              <div key={label} style={{ background: C.surface2, borderRadius: RADIUS.sm, padding: "8px 10px", textAlign: "center" }}>
                <div style={{ fontFamily: FONT_DISPLAY, ...FONT_NUM, fontSize: 20, fontWeight: 800, color: color || C.fg }}>{val}</div>
                <div style={{ fontSize: 11, color: C.muted }}>{label}</div>
              </div>
            ))}
          </div>
          <div style={{ background: C.surface2, borderRadius: 4, height: 6, marginBottom: 12, overflow: "hidden" }}>
            <div style={{ height: "100%", width: "100%", background: C.accent, borderRadius: 4, transform: `scaleX(${pct / 100})`, transformOrigin: "left", transition: "transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)" }} />
          </div>
          <div style={{ fontSize: 11, color: C.faint, marginBottom: 12 }}>
            {pct}% completado {stats.finishers > 0 && `· ${stats.finishers} finisher${stats.finishers !== 1 ? "s" : ""}`}
          </div>
        </>
      ) : (
        <div style={{ height: 80, display: "flex", alignItems: "center", justifyContent: "center", color: C.faint, fontSize: 12 }}>
          Cargando estadísticas…
        </div>
      )}

      <button style={{ ...BTN_PRIMARY, width: "100%", padding: "8px 0", fontSize: 13 }}>
        Ver resultados →
      </button>
    </div>
  )
}
