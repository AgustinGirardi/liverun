import { useState, useEffect, useCallback } from "react"
import { Icon } from "../components/Icon.jsx"
import { API } from "../lib/api.js"
import { RACE_STATUS } from "../lib/estados.js"
import { formatDate } from "../lib/tiempo.js"
import { ask, notify } from "../lib/ui-store.js"
import { BTN_GHOST, BTN_PRIMARY, C, CARD, FONT_DISPLAY, INPUT, WITH_ICON } from "../theme.js"
import { RaceDetailPage } from "./RaceDetailPage.jsx"

// ═══════════════════════════════════════════════════════════════════════════════
// PÁGINA: CARRERAS — lista + drill-in
// ═══════════════════════════════════════════════════════════════════════════════

// Orden por fecha con los sin fecha al final; `dir` = 1 próxima primero, -1 reciente primero.
const porFecha = (dir) => (a, b) => {
  if (!a.race_date) return 1
  if (!b.race_date) return -1
  return a.race_date < b.race_date ? -dir : a.race_date > b.race_date ? dir : 0
}

const GRUPOS_CARRERA = [
  { status: "ACTIVE",   titulo: "En curso",        orden: porFecha(-1), colapsable: false,
    ayuda: "Cronómetro corriendo. Entrá para capturar llegadas." },
  { status: "PLANNED",  titulo: "En preparación",  orden: porFecha(1),  colapsable: false,
    ayuda: "Todavía no se corrieron: cargá inscriptos, cupo y link, y publicalas al calendario del portal." },
  { status: "FINISHED", titulo: "Finalizadas",     orden: porFecha(-1), colapsable: true,
    ayuda: "Ya cronometradas. Entrá para ver resultados, publicarlos o exportarlos." },
]

const VISIBLES_FINALIZADAS = 6

export function RacesPage({ openRace, onOpenRace }) {
  const [races, setRaces]       = useState([])
  const [drillRace, setDrillRace] = useState(openRace || null)
  const [verTodas, setVerTodas] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: "", location: "", race_date: "", capacity: "", registration_url: "" })
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState("")

  const load = useCallback(() => {
    fetch(API + "/races").then(r => r.json()).then(setRaces).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  // Avisa al padre qué carrera está abierta (para la barra superior); al
  // volver a la lista o desmontarse, el cleanup lo deja en null.
  useEffect(() => {
    onOpenRace?.(drillRace)
    return () => onOpenRace?.(null)
  }, [drillRace, onOpenRace])

  // Si hay drill activo, mostrar detalle
  if (drillRace) {
    const fresh = races.find(r => r.id === drillRace.id) || drillRace
    return <RaceDetailPage race={fresh} onBack={() => { setDrillRace(null); load() }} />
  }

  const EMPTY_FORM = { name: "", location: "", race_date: "", capacity: "", registration_url: "" }

  const create = async () => {
    if (!form.name) { setError("El nombre es obligatorio"); return }
    const url = form.registration_url.trim()
    if (url && !/^https?:\/\//i.test(url)) { setError("El link de inscripción debe empezar con http:// o https://"); return }
    setSaving(true); setError("")
    const r = await fetch(API + "/races", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name, location: form.location || null, race_date: form.race_date || null,
        capacity: form.capacity ? parseInt(form.capacity, 10) : null,
        registration_url: url || null,
      }),
    })
    if (r.ok) { setShowForm(false); setForm(EMPTY_FORM); load() }
    else { const e = await r.json(); setError(typeof e.detail === "string" ? e.detail : "Error") }
    setSaving(false)
  }

  const deleteRace = async (race, e) => {
    e.stopPropagation()
    const msg = race.status === "FINISHED"
      ? `¿Eliminar "${race.name}"?\n\nSe eliminarán también todos los inscriptos, tiempos y resultados de esta carrera. Esta acción no se puede deshacer.`
      : `¿Eliminar "${race.name}"? Esta acción no se puede deshacer.`
    if (!(await ask({ title: "Eliminar carrera", message: msg, confirmLabel: "Eliminar", danger: true }))) return
    const r = await fetch(API + "/races/" + race.id, { method: "DELETE" })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      notify("Error al eliminar: " + (err.detail || "error desconocido"), { kind: "error" })
    } else load()
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 17, letterSpacing: -0.3 }}>Carreras</span>
          <span style={{ marginLeft: 10, background: `${C.blue}15`, color: C.blue, border: `1px solid ${C.blue}30`, borderRadius: 20, padding: "2px 10px", fontSize: 12 }}>{races.length}</span>
        </div>
        <button onClick={() => { setShowForm(!showForm); setError("") }} style={BTN_PRIMARY}>+ Nueva Carrera</button>
      </div>

      {showForm && (
        <div style={{ ...CARD, border: `1px solid ${C.accent}40`, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.accent, marginBottom: 12 }}>Nueva Carrera</div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Nombre *</div>
              <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="ej. Media Maratón Río Cuarto" style={INPUT} onKeyDown={e => e.key === "Enter" && create()} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Lugar</div>
              <input value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} placeholder="Río Cuarto" style={INPUT} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Fecha</div>
              <input value={form.race_date} onChange={e => setForm(p => ({ ...p, race_date: e.target.value }))} style={INPUT} type="date" />
            </div>
          </div>
          {/* Calendario del portal: mientras la carrera esté en PLANNED, "Subir a
              la web" la publica como evento con estos dos datos. */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Cupo</div>
              <input value={form.capacity} onChange={e => setForm(p => ({ ...p, capacity: e.target.value.replace(/\D/g, "") }))} placeholder="sin límite" style={INPUT} inputMode="numeric" />
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Link de inscripción</div>
              <input value={form.registration_url} onChange={e => setForm(p => ({ ...p, registration_url: e.target.value }))} placeholder="https://… (se muestra en el calendario del portal)" style={INPUT} />
            </div>
          </div>
          {error && <div style={{ color: C.danger, fontSize: 12, marginBottom: 10, padding: "6px 10px", background: `${C.danger}15`, borderRadius: 4 }}>{error}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button onClick={() => setShowForm(false)} style={BTN_GHOST}>Cancelar</button>
            <button onClick={create} disabled={saving} style={{ ...BTN_PRIMARY, opacity: saving ? 0.6 : 1 }}>{saving ? "Creando..." : "Crear"}</button>
          </div>
        </div>
      )}

      {races.length === 0 && !showForm && (
        <div style={{ textAlign: "center", padding: 60, color: C.faint }}>
          <Icon name="flag" size={30} style={{ marginBottom: 12, color: C.muted }} />
          <div style={{ fontSize: 14 }}>No hay carreras. Creá una para comenzar.</div>
        </div>
      )}

      {/* Agrupadas por estado: primero lo que necesita atención ahora (una
          carrera en curso), después lo que viene, y al final el archivo. */}
      {GRUPOS_CARRERA.map(g => {
        const delGrupo = races.filter(r => r.status === g.status).sort(g.orden)
        if (!delGrupo.length) return null
        const colapsado = g.colapsable && !verTodas && delGrupo.length > VISIBLES_FINALIZADAS
        const visibles = colapsado ? delGrupo.slice(0, VISIBLES_FINALIZADAS) : delGrupo
        const s = RACE_STATUS[g.status]
        return (
          <div key={g.status} style={{ marginBottom: 26 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span style={{ width: 8, height: 8, borderRadius: 8, background: s.color, flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: C.fg }}>{g.titulo}</span>
              <span style={{ fontSize: 12, color: C.faint }}>{delGrupo.length}</span>
              <div style={{ flex: 1, height: 1, background: C.line }} />
              {g.colapsable && delGrupo.length > VISIBLES_FINALIZADAS && (
                <button onClick={() => setVerTodas(v => !v)}
                  style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                  {colapsado ? `Ver todas (${delGrupo.length}) →` : "Ver menos ←"}
                </button>
              )}
            </div>
            <div style={{ fontSize: 12, color: C.faint, marginTop: -6, marginBottom: 12 }}>{g.ayuda}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
              {visibles.map(race => (
                <div key={race.id} style={{ position: "relative" }}>
                  {/* La tarjeta entera es un botón, así se entra con teclado; eliminar
                      queda afuera para que ENTER en la tarjeta nunca borre. */}
                  <button onClick={() => setDrillRace(race)}
                    style={{ ...CARD, display: "block", width: "100%", height: "100%", textAlign: "left", color: C.fg, cursor: "pointer", transition: "border-color 0.15s, transform 0.1s" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = C.lineStrong; e.currentTarget.style.transform = "translateY(-1px)" }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = C.line; e.currentTarget.style.transform = "translateY(0)" }}>

                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8, paddingRight: 28 }}>{race.name}</div>

                  {/* Sin píldora de estado: la sección ya lo dice, repetirlo en
                      cada tarjeta era ruido y tapaba fecha y lugar. */}
                  <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
                    {race.race_date && <span style={{ color: C.muted, fontSize: 12, ...WITH_ICON, gap: 5 }}><Icon name="calendar" size={13} />{formatDate(race.race_date)}</span>}
                    {race.location && <span style={{ color: C.muted, fontSize: 12, ...WITH_ICON, gap: 5 }}><Icon name="pin" size={13} />{race.location}</span>}
                  </div>

                  {race.race_start_ns && (
                    <div style={{ fontSize: 12, color: C.accent2, marginBottom: 8, ...WITH_ICON, gap: 4 }}><Icon name="check" size={12} />Largada registrada</div>
                  )}

                  <div style={{ marginTop: 8, fontSize: 12, color: C.muted, fontWeight: 600 }}>
                    Entrar →
                  </div>
                  </button>
                  <button onClick={(e) => deleteRace(race, e)}
                    style={{ position: "absolute", top: 10, right: 10, background: "transparent", border: "none", color: C.faint, cursor: "pointer", padding: 6, borderRadius: 6, display: "flex" }}
                    onMouseEnter={e => e.currentTarget.style.color = C.danger}
                    onMouseLeave={e => e.currentTarget.style.color = C.faint} aria-label={`Eliminar ${race.name}`} title="Eliminar carrera"><Icon name="x" size={14} /></button>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
