import { useState, useEffect } from "react"
import { API } from "../lib/api.js"
import { BTN_PRIMARY, C, CARD, INPUT } from "../theme.js"

// ═══════════════════════════════════════════════════════════════════════════════
// PANEL DE INSCRIPCIÓN — cupo y link que se publican en el calendario del portal
// ═══════════════════════════════════════════════════════════════════════════════

export function InscripcionPanel({ race, onSaved }) {
  const [cupo, setCupo] = useState(race.capacity != null ? String(race.capacity) : "")
  const [url, setUrl]   = useState(race.registration_url || "")
  const [saving, setSaving] = useState(false)
  const [msg, setMsg]   = useState("")
  const [inscriptos, setInscriptos] = useState(null)

  // El portal informa los inscriptos reales al publicar; acá lo mostramos para
  // que el organizador vea el mismo número antes de mandar el anuncio.
  useEffect(() => {
    fetch(API + "/races/" + race.id + "/registrations")
      .then(r => r.json())
      .then(d => setInscriptos(Array.isArray(d) ? d.length : null))
      .catch(() => {})
  }, [race.id])

  const sucio = cupo !== (race.capacity != null ? String(race.capacity) : "")
             || url !== (race.registration_url || "")

  const guardar = async () => {
    const u = url.trim()
    if (u && !/^https?:\/\//i.test(u)) { setMsg("El link tiene que empezar con http:// o https://"); return }
    setSaving(true); setMsg("")
    const r = await fetch(API + "/races/" + race.id, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capacity: cupo ? parseInt(cupo, 10) : null, registration_url: u || null }),
    })
    if (r.ok) { setMsg("Guardado ✓ — publicá para que se vea en el calendario"); onSaved() }
    else { const e = await r.json().catch(() => ({})); setMsg(typeof e.detail === "string" ? e.detail : "No se pudo guardar") }
    setSaving(false)
  }

  return (
    <div style={{ ...CARD, marginTop: 16, border: `1px solid ${C.blue}30` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.blue }}>📅 Inscripción · calendario del portal</span>
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
        Los corredores ven esto en el Calendario del portal. El link es adónde los mandás a inscribirse
        (tu formulario, tu pasarela de pago o la web de la carrera). La cantidad de inscriptos se toma sola
        de esta carrera: hoy son <b style={{ color: C.fg }}>{inscriptos ?? "…"}</b>.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "160px 1fr auto", gap: 10, alignItems: "end" }}>
        <div>
          <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Cupo</div>
          <input value={cupo} onChange={e => setCupo(e.target.value.replace(/\D/g, ""))}
                 placeholder="sin límite" inputMode="numeric" style={INPUT} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Link de inscripción</div>
          <input value={url} onChange={e => setUrl(e.target.value)}
                 placeholder="https://tu-formulario-de-inscripcion.com" style={INPUT}
                 onKeyDown={e => e.key === "Enter" && sucio && guardar()} />
        </div>
        <button onClick={guardar} disabled={saving || !sucio}
          style={{ ...BTN_PRIMARY, opacity: (saving || !sucio) ? 0.45 : 1, cursor: (saving || !sucio) ? "default" : "pointer" }}>
          {saving ? "Guardando…" : "Guardar"}
        </button>
      </div>
      {msg && <div style={{ fontSize: 12, marginTop: 10, color: msg.includes("✓") ? C.accent : C.danger }}>{msg}</div>}
      {!url && <div style={{ fontSize: 12, marginTop: 10, color: C.gold }}>
        Sin link, el evento se anuncia igual pero el portal muestra “Inscripción a cargo del organizador” en lugar del botón.
      </div>}
    </div>
  )
}
