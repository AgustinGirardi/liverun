import { useState, useEffect, useCallback } from "react"
import { RaceStatusBadge } from "../components/Badges.jsx"
import { Icon } from "../components/Icon.jsx"
import { API } from "../lib/api.js"
import { formatDate } from "../lib/tiempo.js"
import { BTN_PRIMARY, C, CARD, FONT_DISPLAY, FONT_NUM, RADIUS, WITH_ICON } from "../theme.js"

// ═══════════════════════════════════════════════════════════════════════════════
// PÁGINA: INICIO — dashboard del operador
// ═══════════════════════════════════════════════════════════════════════════════

export function DashboardPage({ onNavigate }) {
  const [races, setRaces]     = useState([])
  const [runners, setRunners] = useState([])
  const [loading, setLoading] = useState(true)
  const [now, setNow]         = useState(new Date())

  // Sólo para la fecha del encabezado; la hora vive en el reloj maestro de la barra superior.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(t)
  }, [])

  const load = useCallback(() => {
    Promise.all([
      fetch(API + "/races").then(r => r.json()),
      fetch(API + "/runners").then(r => r.json()),
    ])
      .then(([r, rn]) => {
        setRaces(Array.isArray(r) ? r : [])
        setRunners(Array.isArray(rn) ? rn : [])
      })
      .catch(() => { /* sin conexión: el tablero queda vacío */ })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const active   = races.filter(r => r.status === "ACTIVE")
  const finished = races.filter(r => r.status === "FINISHED")
  // Las más cercanas primero; las que no tienen fecha, al final.
  const planned  = races.filter(r => r.status === "PLANNED")
    .sort((a, b) => (a.race_date || "9999").localeCompare(b.race_date || "9999"))
  const live     = active[0]

  const dateStr = now.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })

  const QUICK = [
    { label: "Nueva Carrera", icon: "flag", page: "races", desc: "Crear y gestionar carreras" },
    { label: "Atletas",       icon: "user", page: "athletes", desc: "Base de corredores" },
    { label: "Historial",     icon: "list", page: "history",  desc: "Resultados y estadísticas" },
  ]
  const SECTION = { fontSize: 11, fontWeight: 600, color: C.muted, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }

  return (
    <div>
      {/* ── Encabezado ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 24, fontWeight: 800, letterSpacing: -0.3, color: C.fg }}>
          Panel de control
        </div>
        <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>{dateStr.charAt(0).toUpperCase() + dateStr.slice(1)}</div>
      </div>

      {/* ── Carrera en curso: lo único urgente, arriba y a un clic del cronómetro ── */}
      {live && (
        <button onClick={() => onNavigate("races", live)}
          style={{ width: "100%", textAlign: "left", marginBottom: 20, padding: "18px 22px", borderRadius: RADIUS.hero, cursor: "pointer",
            background: `linear-gradient(135deg, #0d1a14 0%, ${C.surface} 70%)`, border: `1px solid ${C.accent}60`, color: C.fg,
            display: "flex", alignItems: "center", gap: 16 }}>
          <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 12, background: C.accent, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.accent }}>Carrera en curso</div>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 800, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{live.name}</div>
          </div>
          <span style={{ ...BTN_PRIMARY, ...WITH_ICON, padding: "10px 18px", fontSize: 13 }}>
            <Icon name="timer" size={15} />Ir al cronómetro
          </span>
        </button>
      )}

      {/* ── Resumen ── */}
      <div style={{ ...CARD, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", padding: 0, marginBottom: 20 }}>
        {[
          { label: "Carreras",    value: races.length,    color: C.fg },
          { label: "En curso",    value: active.length,   color: active.length > 0 ? C.accent : C.fg },
          { label: "Finalizadas", value: finished.length, color: C.gold },
          { label: "Atletas",     value: runners.length,  color: C.blue },
        ].map((s, i) => (
          <div key={s.label} style={{ padding: "14px 18px", borderLeft: i ? `1px solid ${C.line}` : "none" }}>
            <div style={{ fontFamily: FONT_DISPLAY, ...FONT_NUM, fontSize: 26, fontWeight: 800, color: s.color, lineHeight: 1 }}>{loading ? "—" : s.value}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

        {/* ── Próximas carreras ── */}
        <div>
          <div style={SECTION}>Próximas carreras</div>
          {loading ? (
            <div style={{ ...CARD, textAlign: "center", padding: 32, color: C.muted }}>Cargando…</div>
          ) : planned.length === 0 ? (
            <div style={{ ...CARD, textAlign: "center", padding: 32, color: C.muted }}>
              <Icon name="flag" size={24} style={{ marginBottom: 8 }} />
              <div>No hay carreras en preparación</div>
              <button onClick={() => onNavigate("races")} style={{ ...BTN_PRIMARY, marginTop: 12 }}>Crear carrera</button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {planned.slice(0, 4).map(race => (
                <button key={race.id} onClick={() => onNavigate("races", race)} className="row-link"
                  style={{ ...CARD, padding: 14, display: "flex", alignItems: "center", gap: 12, cursor: "pointer", textAlign: "left", color: C.fg, width: "100%" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{race.name}</div>
                    <div style={{ fontSize: 12, color: C.muted }}>{formatDate(race.race_date) || "Sin fecha"}</div>
                  </div>
                  <RaceStatusBadge status={race.status} />
                  <Icon name="chevronR" size={14} style={{ color: C.faint }} />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Accesos rápidos + últimas finalizadas ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          <div>
            <div style={SECTION}>Accesos rápidos</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {QUICK.map(q => (
                <button key={q.page} onClick={() => onNavigate(q.page)} className="row-link"
                  style={{ ...CARD, padding: "12px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, textAlign: "left", color: C.fg, width: "100%" }}>
                  <Icon name={q.icon} size={18} style={{ color: C.accent }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{q.label}</div>
                    <div style={{ fontSize: 12, color: C.muted }}>{q.desc}</div>
                  </div>
                  <Icon name="chevronR" size={14} style={{ marginLeft: "auto", color: C.faint }} />
                </button>
              ))}
            </div>
          </div>

          {finished.length > 0 && (
            <div>
              <div style={SECTION}>Últimas finalizadas</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {finished.slice(0, 3).map(race => (
                  <button key={race.id} onClick={() => onNavigate("races", race)} className="row-link"
                    style={{ ...CARD, padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, textAlign: "left", color: C.fg, width: "100%" }}>
                    <Icon name="trophy" size={15} style={{ color: C.gold }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{race.name}</div>
                      <div style={{ fontSize: 12, color: C.muted }}>{formatDate(race.race_date) || "Sin fecha"}</div>
                    </div>
                    <span style={{ color: C.gold, fontSize: 12, fontWeight: 600 }}>Ver resultados</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Nota del sistema ── */}
      <div style={{ marginTop: 20, padding: "12px 16px", background: C.surface2, borderRadius: RADIUS.card, border: `1px solid ${C.line}`, fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
        Cada carrera se abre en la pestaña de su momento: <strong style={{ color: C.fg }}>Inscriptos</strong> mientras se prepara, <strong style={{ color: C.fg }}>Cronómetro</strong> el día de la carrera y <strong style={{ color: C.fg }}>Resultados</strong> cuando termina. La categoría se calcula sola con la fecha de nacimiento, y desde Resultados podés imprimir el certificado de cada corredor.
      </div>
    </div>
  )
}
