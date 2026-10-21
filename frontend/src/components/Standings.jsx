import { Icon } from "./Icon.jsx"
import { clasificarPorDistancia } from "../lib/standings.js"
import { formatPace, formatTiempo } from "../lib/tiempo.js"
import { BRONZE, C, FONT_DISPLAY, FONT_NUM, SILVER, WITH_ICON } from "../theme.js"

// Clasificación agrupada por distancia. La posición se calcula acá (por tiempo
// neto dentro de cada grupo) porque la del servidor queda vieja si después se
// asigna a alguien que cruzó antes.
export function Standings({ finishers, onCorrect }) {
  const grupos = clasificarPorDistancia(finishers)
  const showHeaders = grupos.length > 1
  const podium = [C.gold, SILVER, BRONZE]

  return grupos.map(({ distancia: k, filas: rows }, gi) => {
    return (
      <div key={k ?? "none"} style={{ marginTop: showHeaders && gi > 0 ? 20 : 0 }}>
        {showHeaders && (
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: C.muted, padding: "0 0 6px", borderBottom: `1px solid ${C.lineStrong}`, display: "flex", justifyContent: "space-between" }}>
            <span>{k === null ? "Sin distancia" : `${k} km`}</span>
            <span>{rows.length}</span>
          </div>
        )}
        {rows.map((f, i) => (
          <div key={f.capture_id ?? `b${f.bib_number}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: `1px solid ${C.surface2}` }}>
            <span style={{ ...FONT_NUM, fontFamily: "monospace", fontSize: 13, color: i < 3 ? podium[i] : C.faint, fontWeight: i < 3 ? 700 : 400, minWidth: 22 }}>{i + 1}</span>
            <span style={{ fontFamily: "monospace", fontSize: 11, background: C.surface2, padding: "1px 6px", borderRadius: 3, color: C.muted }}>{f.bib_number}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.runner?.full_name || "--"}</div>
              <div style={{ fontSize: 11, color: C.faint }}>{f.runner?.category || ""}</div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ ...FONT_NUM, fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 13, color: C.fg }}
                title={f.net_time_ns == null ? "Sin largada: hora de llegada" : undefined}>{formatTiempo(f.net_time_ns, f.capture_ns)}</div>
              {formatPace(f.net_time_ns, f.distance_km) && (
                <div style={{ ...FONT_NUM, fontSize: 11, color: C.muted }}>{formatPace(f.net_time_ns, f.distance_km)}</div>
              )}
              {onCorrect && f.capture_id && (
                <button onClick={() => onCorrect(f.capture_id)} title="Quitar el dorsal y devolver la llegada a la cola para reasignarla"
                  style={{ padding: "1px 0", background: "transparent", color: C.gold, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, ...WITH_ICON, gap: 4 }}><Icon name="pencil" size={11} />Corregir</button>
              )}
            </div>
          </div>
        ))}
      </div>
    )
  })
}
