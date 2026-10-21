import { useState, useEffect, useCallback } from "react"
import { Icon } from "../components/Icon.jsx"
import { API } from "../lib/api.js"
import { autoCategory, calcAge } from "../lib/categorias.js"
import { ask, notify } from "../lib/ui-store.js"
import { BTN_DANGER, BTN_GHOST, BTN_PRIMARY, C, CARD, FONT_DISPLAY, INPUT } from "../theme.js"

// ═══════════════════════════════════════════════════════════════════════════════
// PÁGINA: ATLETAS — base global de corredores (sin dorsal)
// ═══════════════════════════════════════════════════════════════════════════════

export function AthletesPage() {
  const [runners, setRunners]   = useState([])
  const [search, setSearch]     = useState("")
  const [showForm, setShowForm] = useState(false)
  const [editRunner, setEditRunner] = useState(null)
  const [form, setForm] = useState({ first_name: "", last_name: "", email: "", dni: "", birth_date: "", category: "", club: "", gender: "M" })
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState("")
  const [selected, setSelected] = useState(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const load = useCallback((q) => {
    const url = q ? API + "/runners?search=" + encodeURIComponent(q) : API + "/runners"
    fetch(url).then(r => r.json()).then(data => { setRunners(data); setSelected(new Set()) }).catch(() => {})
  }, [])

  useEffect(() => { load("") }, [load])

  useEffect(() => {
    const t = setTimeout(() => load(search), 280)
    return () => clearTimeout(t)
  }, [search, load])

  const resetForm = () => {
    setForm({ first_name: "", last_name: "", email: "", dni: "", birth_date: "", category: "", club: "", gender: "M" })
    setEditRunner(null); setError("")
  }

  const startEdit = (r) => {
    setEditRunner(r)
    setForm({ first_name: r.first_name, last_name: r.last_name, email: r.email || "", dni: r.dni || "", birth_date: r.birth_date || "", category: r.category || "", club: r.club || "", gender: r.gender || "M" })
    setShowForm(true)
  }

  const save = async () => {
    if (!form.first_name || !form.last_name) { setError("Nombre y apellido son obligatorios"); return }
    setSaving(true); setError("")
    const url    = editRunner ? API + "/runners/" + editRunner.id : API + "/runners"
    const method = editRunner ? "PATCH" : "POST"
    const r = await fetch(url, {
      method, headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    })
    if (r.ok) { load(search); setShowForm(false); resetForm() }
    else { const e = await r.json(); setError(e.detail || "Error") }
    setSaving(false)
  }

  const deleteRunner = async (runner) => {
    if (!(await ask({ title: "Eliminar atleta", message: `¿Eliminar a ${runner.full_name}? Si está inscripto en carreras no se podrá eliminar.`, confirmLabel: "Eliminar", danger: true }))) return
    const r = await fetch(API + "/runners/" + runner.id, { method: "DELETE" })
    if (!r.ok) notify("No se puede eliminar: el atleta tiene inscripciones en alguna carrera.", { kind: "error" })
    else load(search)
  }

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === runners.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(runners.map(r => r.id)))
    }
  }

  const bulkDelete = async () => {
    if (selected.size === 0) return
    if (!(await ask({ title: "Eliminar atletas", message: `¿Eliminar ${selected.size} atleta${selected.size > 1 ? "s" : ""} de la base de datos?\n\nSolo se eliminarán los que no tengan inscripciones en carreras.`, confirmLabel: "Eliminar", danger: true }))) return
    setBulkDeleting(true)
    let deleted = 0, skipped = 0
    // Eliminar de a uno para manejar errores por FK individualmente
    await Promise.all([...selected].map(async (id) => {
      const r = await fetch(API + "/runners/" + id, { method: "DELETE" })
      r.ok ? deleted++ : skipped++
    }))
    setBulkDeleting(false)
    load(search)
    if (skipped > 0) notify(`${deleted} eliminado${deleted !== 1 ? "s" : ""}. ${skipped} no se pudo${skipped !== 1 ? "n" : ""} eliminar porque tienen inscripciones en carreras.`, { kind: "error" })
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 17, letterSpacing: -0.3 }}>Atletas</span>
          <span style={{ marginLeft: 10, background: `${C.blue}15`, color: C.blue, border: `1px solid ${C.blue}30`, borderRadius: 20, padding: "2px 10px", fontSize: 12 }}>{runners.length}</span>
          <span style={{ marginLeft: 8, fontSize: 12, color: C.faint }}>— base global de corredores</span>
        </div>
        <button onClick={() => { setShowForm(!showForm); resetForm() }} style={BTN_PRIMARY}>+ Nuevo atleta</button>
      </div>

      {showForm && (
        <div style={{ ...CARD, border: `1px solid ${C.accent}40`, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.accent, marginBottom: 12 }}>
            {editRunner ? `Editar: ${editRunner.full_name}` : "Nuevo atleta"}
          </div>
          <div style={{ fontSize: 12, color: C.faint, marginBottom: 12 }}>
            El dorsal se asigna al inscribirlo en cada carrera — aquí solo se guarda la información personal.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Nombre *</div>
              <input value={form.first_name} onChange={e => setForm(p => ({ ...p, first_name: e.target.value }))} placeholder="Carlos" style={INPUT} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Apellido *</div>
              <input value={form.last_name} onChange={e => setForm(p => ({ ...p, last_name: e.target.value }))} placeholder="Méndez" style={INPUT} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>DNI</div>
              <input value={form.dni} onChange={e => setForm(p => ({ ...p, dni: e.target.value }))} placeholder="12345678" style={INPUT} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Género</div>
              <select value={form.gender} onChange={e => {
                const gender = e.target.value
                setForm(p => ({ ...p, gender, category: autoCategory(p.birth_date, gender) || p.category }))
              }} style={{ ...INPUT }}>
                <option value="M">Masculino</option>
                <option value="F">Femenino</option>
                <option value="X">Otro</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Club</div>
              <input value={form.club} onChange={e => setForm(p => ({ ...p, club: e.target.value }))} placeholder="RC Runners" style={INPUT} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Email <span style={{ color: C.faint }}>(para enviar resultados)</span></div>
              <input value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="corredor@email.com" style={INPUT} type="email" />
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Fecha de nacimiento</div>
              <input value={form.birth_date} onChange={e => {
                const birth_date = e.target.value
                setForm(p => ({ ...p, birth_date, category: autoCategory(birth_date, p.gender) || p.category }))
              }} style={INPUT} type="date" />
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>
                Categoría {form.birth_date && <span style={{ color: C.muted }}>(auto)</span>}
              </div>
              <input
                value={form.category}
                onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                placeholder={form.birth_date ? autoCategory(form.birth_date, form.gender) || "—" : "ej. M30-34"}
                style={{ ...INPUT, color: form.birth_date && autoCategory(form.birth_date, form.gender) ? C.accent : C.fg }}
              />
            </div>
            {form.birth_date && calcAge(form.birth_date) !== null && (
              <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 2 }}>
                <div style={{ background: C.surface2, border: `1px solid ${C.lineStrong}`, borderRadius: 6, padding: "7px 10px", color: C.muted, fontSize: 13, width: "100%", textAlign: "center" }}>
                  <span style={{ color: C.fg, fontWeight: 700 }}>{calcAge(form.birth_date)}</span> años
                </div>
              </div>
            )}
          </div>
          {error && <div style={{ color: C.danger, fontSize: 12, marginBottom: 10, padding: "6px 10px", background: `${C.danger}15`, borderRadius: 4 }}>{error}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button onClick={() => { setShowForm(false); resetForm() }} style={BTN_GHOST}>Cancelar</button>
            <button onClick={save} disabled={saving} style={{ ...BTN_PRIMARY, opacity: saving ? 0.6 : 1 }}>{saving ? "Guardando..." : editRunner ? "Actualizar" : "Crear"}</button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre o DNI…" style={{ ...INPUT, maxWidth: 280 }} />
        {selected.size > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 14px", background: `${C.danger}15`, border: `1px solid ${C.danger}30`, borderRadius: 8, marginLeft: "auto" }}>
            <span style={{ fontSize: 13, color: C.danger, fontWeight: 600 }}>
              {selected.size} seleccionado{selected.size > 1 ? "s" : ""}
            </span>
            <button
              onClick={bulkDelete}
              disabled={bulkDeleting}
              style={{ padding: "4px 14px", background: C.danger, border: "none", borderRadius: 5, cursor: "pointer", color: "#fff", fontWeight: 700, fontSize: 12, opacity: bulkDeleting ? 0.6 : 1 }}>
              {bulkDeleting ? "Eliminando..." : "Eliminar seleccionados"}
            </button>
            <button onClick={() => setSelected(new Set())} style={{ ...BTN_GHOST, padding: "4px 10px", fontSize: 12 }}>Cancelar</button>
          </div>
        )}
      </div>

      <div style={{ ...CARD, overflow: "hidden", padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.line}` }}>
              <th style={{ padding: "8px 14px", width: 36 }}>
                <input
                  type="checkbox"
                  checked={runners.length > 0 && selected.size === runners.length}
                  ref={el => { if (el) el.indeterminate = selected.size > 0 && selected.size < runners.length }}
                  onChange={toggleAll}
                  style={{ cursor: "pointer", accentColor: C.accent }}
                />
              </th>
              {["Nombre", "DNI", "Edad", "Género", "Categoría", "Club", ""].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "8px 14px", fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: C.faint }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runners.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: "center", padding: 32, color: C.faint }}>{search ? "Sin resultados" : "No hay atletas registrados"}</td></tr>
            ) : runners.map(r => {
              const isSelected = selected.has(r.id)
              const age = calcAge(r.birth_date)
              return (
                <tr key={r.id} style={{ borderBottom: `1px solid ${C.surface2}`, background: isSelected ? `${C.danger}08` : "transparent" }}>
                  <td style={{ padding: "9px 14px" }}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(r.id)}
                      style={{ cursor: "pointer", accentColor: C.accent }}
                    />
                  </td>
                  <td style={{ padding: "9px 14px", fontSize: 13, fontWeight: 500 }}>{r.full_name}</td>
                  <td style={{ padding: "9px 14px", fontSize: 12, color: C.muted, fontFamily: "monospace" }}>{r.dni || "--"}</td>
                  <td style={{ padding: "9px 14px", fontSize: 12, color: C.muted }}>{age !== null ? `${age} a` : "--"}</td>
                  <td style={{ padding: "9px 14px", color: r.gender === "F" ? C.blue : C.faint, fontSize: 12 }}>{r.gender || "--"}</td>
                  <td style={{ padding: "9px 14px" }}>
                    <span style={{ background: r.category?.startsWith("F") ? `${C.blue}15` : `${C.accent}15`, color: r.category?.startsWith("F") ? C.blue : C.accent, border: "1px solid " + (r.category?.startsWith("F") ? `${C.blue}30` : `${C.accent}30`), borderRadius: 20, padding: "2px 8px", fontSize: 11 }}>
                      {r.category || "--"}
                    </span>
                  </td>
                  <td style={{ padding: "9px 14px", fontSize: 13, color: C.muted }}>{r.club || "--"}</td>
                  <td style={{ padding: "9px 14px", textAlign: "right" }}>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <button onClick={() => startEdit(r)} style={{ ...BTN_GHOST, fontSize: 11, padding: "3px 10px" }}>Editar</button>
                      <button onClick={() => deleteRunner(r)} style={BTN_DANGER} aria-label="Eliminar"><Icon name="x" size={12} /></button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
