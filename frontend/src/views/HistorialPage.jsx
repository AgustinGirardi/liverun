import { useState, useEffect, useCallback } from "react"
import { Icon } from "../components/Icon.jsx"
import { RaceResultCard } from "../components/RaceResultCard.jsx"
import { API } from "../lib/api.js"
import { BTN_GHOST, C, FONT_DISPLAY, WITH_ICON } from "../theme.js"
import { ResultsDetail } from "./ResultsDetail.jsx"

// ═══════════════════════════════════════════════════════════════════════════════
// HISTORIAL — todas las carreras con sus resultados
// ═══════════════════════════════════════════════════════════════════════════════

export function HistorialPage() {
  const [races, setRaces]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [drillRace, setDrillRace] = useState(null)

  const loadRaces = useCallback(() => {
    fetch(API + "/races")
      .then(r => r.json())
      .then(data => { setRaces(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { loadRaces() }, [loadRaces])

  if (drillRace) {
    const fresh = races.find(r => r.id === drillRace.id) || drillRace
    return <ResultsDetail race={fresh} onBack={() => setDrillRace(null)} />
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 17, letterSpacing: -0.3 }}>Historial de Carreras</span>
          <span style={{ marginLeft: 10, background: `${C.blue}15`, color: C.blue, border: `1px solid ${C.blue}30`, borderRadius: 20, padding: "2px 10px", fontSize: 12 }}>
            {races.length} carrera{races.length !== 1 ? "s" : ""}
          </span>
        </div>
        <button onClick={loadRaces} style={{ ...BTN_GHOST, ...WITH_ICON }}><Icon name="refresh" size={13} />Actualizar</button>
      </div>

      {loading && <div style={{ textAlign: "center", padding: 48, color: C.faint }}>Cargando…</div>}

      {!loading && races.length === 0 && (
        <div style={{ textAlign: "center", padding: 60, color: C.faint }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 14 }}>No hay carreras. Creá una en la sección Carreras.</div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
        {races.map(race => (
          <RaceResultCard key={race.id} race={race} onOpen={() => setDrillRace(race)} />
        ))}
      </div>
    </div>
  )
}
