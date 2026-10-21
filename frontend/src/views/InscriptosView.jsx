import { useState, useEffect, useCallback } from "react"
import { Icon } from "../components/Icon.jsx"
import { API } from "../lib/api.js"
import { autoCategory, calcAge } from "../lib/categorias.js"
import { REG_STATUS } from "../lib/estados.js"
import { ask } from "../lib/ui-store.js"
import { BTN_DANGER, BTN_GHOST, BTN_PRIMARY, C, CARD, INPUT, WITH_ICON } from "../theme.js"

// ═══════════════════════════════════════════════════════════════════════════════
// INSCRIPTOS VIEW (inscripciones de una carrera específica)
// ═══════════════════════════════════════════════════════════════════════════════

export function InscriptosView({ race }) {
  const raceId = race?.id
  const [registrations, setRegistrations] = useState([])
  const [showAdd, setShowAdd]     = useState(false)
  const [addMode, setAddMode]     = useState("search")  // "search" | "new"
  const [showImport, setShowImport] = useState(false)
  const [search, setSearch]       = useState("")
  const [selected, setSelected]   = useState(new Set())   // IDs seleccionados
  const [bulkDeleting, setBulkDeleting] = useState(false)

  // Buscar corredor existente
  const [runnerQuery, setRunnerQuery]     = useState("")
  const [runnerResults, setRunnerResults] = useState([])
  const [selectedRunner, setSelectedRunner] = useState(null)
  const [bibForExisting, setBibForExisting] = useState("")
  const [distForExisting, setDistForExisting] = useState("")
  const [addError, setAddError]           = useState("")
  const [saving, setSaving]               = useState(false)

  // Formulario nuevo corredor
  const [newForm, setNewForm] = useState({ first_name: "", last_name: "", email: "", dni: "", birth_date: "", category: "", club: "", bib_number: "", gender: "M", distance_km: "" })

  // Import
  const [importFile, setImportFile]     = useState(null)
  const [importResult, setImportResult] = useState(null)
  const [importing, setImporting]       = useState(false)

  const load = useCallback(() => {
    if (!raceId) return
    fetch(API + "/races/" + raceId + "/registrations")
      .then(r => r.json()).then(data => { setRegistrations(data); setSelected(new Set()) }).catch(() => {})
  }, [raceId])

  useEffect(() => { load() }, [load])

  // Búsqueda debounced de corredores existentes
  useEffect(() => {
    // Con menos de 2 letras no se busca (y la lista no se muestra, ver abajo)
    if (!runnerQuery || runnerQuery.length < 2) return
    const t = setTimeout(() => {
      fetch(API + "/runners?search=" + encodeURIComponent(runnerQuery))
        .then(r => r.json()).then(setRunnerResults).catch(() => {})
    }, 280)
    return () => clearTimeout(t)
  }, [runnerQuery])

  const resetAdd = () => {
    setAddMode("search"); setRunnerQuery(""); setRunnerResults([])
    setSelectedRunner(null); setBibForExisting(""); setDistForExisting("")
    setNewForm({ first_name: "", last_name: "", email: "", dni: "", birth_date: "", category: "", club: "", bib_number: "", gender: "M", distance_km: "" })
    setAddError(""); setSaving(false)
  }

  const addExisting = async () => {
    if (!selectedRunner) { setAddError("Seleccioná un corredor"); return }
    if (!bibForExisting.trim()) { setAddError("Ingresá el dorsal"); return }
    setSaving(true); setAddError("")
    const dist = distForExisting ? parseFloat(distForExisting) : null
    const r = await fetch(API + "/races/" + raceId + "/registrations", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runner_id: selectedRunner.id, race_id: raceId, bib_number: bibForExisting.trim(), distance_km: dist }),
    })
    if (r.ok) { load(); setShowAdd(false); resetAdd() }
    else { const e = await r.json(); setAddError(e.detail || "Error") }
    setSaving(false)
  }

  const addNew = async () => {
    if (!newForm.first_name || !newForm.last_name || !newForm.bib_number) {
      setAddError("Nombre, apellido y dorsal son obligatorios"); return
    }
    setSaving(true); setAddError("")
    try {
      const cat = newForm.category || autoCategory(newForm.birth_date, newForm.gender) || undefined
      const runnerRes = await fetch(API + "/runners", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: newForm.first_name, last_name: newForm.last_name,
          email: newForm.email || null,
          dni: newForm.dni || null, birth_date: newForm.birth_date || null,
          category: cat || null, club: newForm.club || null, gender: newForm.gender,
        }),
      })
      if (!runnerRes.ok) { setAddError("Error creando corredor"); setSaving(false); return }
      const runner = await runnerRes.json()
      const dist = newForm.distance_km ? parseFloat(newForm.distance_km) : null
      const regRes = await fetch(API + "/races/" + raceId + "/registrations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runner_id: runner.id, race_id: raceId, bib_number: newForm.bib_number, distance_km: dist }),
      })
      if (!regRes.ok) { const e = await regRes.json(); setAddError(e.detail || "Dorsal ya existe"); setSaving(false); return }
      load(); setShowAdd(false); resetAdd()
    } catch { setAddError("Error conectando al servidor") }
    setSaving(false)
  }

  const setStatus = async (reg, status) => {
    await fetch(API + "/races/" + raceId + "/registrations/" + reg.id + "/status", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    load()
  }

  const deleteReg = async (reg) => {
    if (!(await ask({ title: "Quitar inscripto", message: `¿Quitar a ${reg.runner.full_name} (dorsal ${reg.bib_number}) de esta carrera?`, confirmLabel: "Quitar", danger: true }))) return
    await fetch(API + "/races/" + raceId + "/registrations/" + reg.id, { method: "DELETE" })
    load()
  }

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map(r => r.id)))
    }
  }

  const bulkDelete = async () => {
    if (selected.size === 0) return
    if (!(await ask({ title: "Eliminar inscriptos", message: `¿Eliminar ${selected.size} inscripto${selected.size > 1 ? "s" : ""}? Esta acción no se puede deshacer.`, confirmLabel: "Eliminar", danger: true }))) return
    setBulkDeleting(true)
    await fetch(API + "/races/" + raceId + "/registrations/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selected] }),
    })
    setBulkDeleting(false)
    load()
  }

  const doImport = async () => {
    if (!importFile) return
    setImporting(true); setImportResult(null)
    const fd = new FormData()
    fd.append("file", importFile)
    try {
      const r = await fetch(API + "/races/" + raceId + "/import", { method: "POST", body: fd })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) setImportResult({ created: 0, skipped: 0, errors: [data.detail || "Error al importar"] })
      else { setImportResult(data); load() }
    } catch { setImportResult({ created: 0, skipped: 0, errors: ["Error al importar"] }) }
    setImporting(false)
  }

  const filtered = registrations.filter(r =>
    !search || r.runner.full_name.toLowerCase().includes(search.toLowerCase()) || r.bib_number.includes(search)
  )

  const statusCounts = { OK: 0, DNS: 0, DNF: 0, DQ: 0 }
  registrations.forEach(r => { statusCounts[r.status] = (statusCounts[r.status] || 0) + 1 })

  const locked = race?.status === "FINISHED"

  const TAB_BTN = (active) => ({
    padding: "5px 14px", fontSize: 12, borderRadius: 6, cursor: "pointer", border: "1px solid",
    background: active ? `${C.blue}20` : "transparent",
    color: active ? C.blue : C.muted,
    borderColor: active ? `${C.blue}40` : C.lineStrong,
    fontWeight: active ? 700 : 400,
  })

  return (
    <div>
      {/* Banner de carrera finalizada */}
      {locked && (
        <div style={{ background: "#0f0f0f", border: `1px solid ${C.gold}40`, borderRadius: 8, padding: "12px 18px", marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
          <Icon name="lock" size={20} style={{ color: C.muted }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: C.gold }}>Carrera finalizada — solo lectura</div>
            <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>No se pueden agregar, modificar ni eliminar inscripciones.</div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Inscriptos</span>
          <span style={{ background: `${C.blue}15`, color: C.blue, border: `1px solid ${C.blue}30`, borderRadius: 20, padding: "2px 10px", fontSize: 12 }}>{registrations.length}</span>
          {statusCounts.DNS > 0 && <span style={{ background: `${C.muted}15`, color: C.muted, border: `1px solid ${C.muted}30`, borderRadius: 20, padding: "2px 8px", fontSize: 11 }}>DNS: {statusCounts.DNS}</span>}
          {statusCounts.DNF > 0 && <span style={{ background: `${C.gold}15`, color: C.gold, border: `1px solid ${C.gold}30`, borderRadius: 20, padding: "2px 8px", fontSize: 11 }}>DNF: {statusCounts.DNF}</span>}
          {statusCounts.DQ  > 0 && <span style={{ background: `${C.danger}15`, color: C.danger, border: `1px solid ${C.danger}30`, borderRadius: 20, padding: "2px 8px", fontSize: 11 }}>DQ: {statusCounts.DQ}</span>}
        </div>
        {!locked && (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setShowImport(!showImport); setImportResult(null) }} style={{ ...BTN_GHOST, ...WITH_ICON }}><Icon name="upload" size={13} />Importar</button>
            <button onClick={() => { setShowAdd(!showAdd); resetAdd() }} style={BTN_PRIMARY}>+ Inscribir</button>
          </div>
        )}
      </div>

      {/* Panel importación */}
      {!locked && showImport && (
        <div style={{ ...CARD, border: `1px solid ${C.blue}30`, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.blue, marginBottom: 8 }}>Importar desde Excel / CSV</div>
          <div style={{ fontSize: 12, color: C.faint, marginBottom: 12 }}>
            Columnas requeridas: <code style={{ background: C.surface2, padding: "2px 6px", borderRadius: 3, color: C.fg }}>dorsal, nombre, apellido</code>
            {" "}· Opcionales: <code style={{ background: C.surface2, padding: "2px 6px", borderRadius: 3, color: C.fg }}>distancia, categoria, club, genero, dni, email</code>
            {" "}· Los atletas ya existentes se reutilizan automáticamente.
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input type="file" accept=".xlsx,.csv" onChange={e => { setImportFile(e.target.files[0]); setImportResult(null) }} style={{ flex: 1, ...INPUT }} />
            <button onClick={doImport} disabled={!importFile || importing} style={{ ...BTN_PRIMARY, opacity: (!importFile || importing) ? 0.6 : 1 }}>{importing ? "Importando..." : "Importar"}</button>
            <button onClick={() => setShowImport(false)} style={BTN_GHOST}>Cerrar</button>
          </div>
          {importResult && (
            <div style={{ marginTop: 12, padding: "10px 14px", background: C.surface2, borderRadius: 6 }}>
              <span style={{ color: C.accent, fontSize: 13, marginRight: 16 }}>✓ {importResult.created} inscriptos</span>
              <span style={{ color: C.faint, fontSize: 13, marginRight: 16 }}>⊘ {importResult.skipped} ya existían</span>
              {(importResult.errors || []).map((e, i) => <div key={i} style={{ color: C.danger, fontSize: 12, marginTop: 4 }}>{e}</div>)}
              {(importResult.warnings || []).map((e, i) => <div key={"w" + i} style={{ color: C.gold, fontSize: 12, marginTop: 4 }}>⚠ {e}</div>)}
            </div>
          )}
        </div>
      )}

      {/* Panel inscribir */}
      {!locked && showAdd && (
        <div style={{ ...CARD, border: `1px solid ${C.accent}40`, marginBottom: 16 }}>
          {/* Tabs: Buscar existente / Nuevo */}
          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            <button onClick={() => { setAddMode("search"); setAddError("") }} style={TAB_BTN(addMode === "search")}>Buscar atleta existente</button>
            <button onClick={() => { setAddMode("new"); setAddError("") }} style={TAB_BTN(addMode === "new")}>Nuevo atleta</button>
          </div>

          {addMode === "search" && (
            <div>
              <div style={{ fontSize: 12, color: C.faint, marginBottom: 12 }}>
                Buscá al atleta por nombre. Si ya corrió en otra carrera, sus datos personales estarán guardados.
              </div>

              {!selectedRunner ? (
                <div style={{ position: "relative" }}>
                  <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Buscar por nombre</div>
                  <input
                    value={runnerQuery}
                    onChange={e => setRunnerQuery(e.target.value)}
                    placeholder="ej. Carlos Mendez"
                    style={{ ...INPUT, maxWidth: 340 }}
                    autoFocus
                  />
                  {runnerQuery.length >= 2 && runnerResults.length > 0 && (
                    <div style={{ position: "absolute", top: "100%", left: 0, right: 0, maxWidth: 340, background: C.surface2, border: `1px solid ${C.lineStrong}`, borderRadius: 6, boxShadow: "0 4px 20px #00000060", zIndex: 10, maxHeight: 240, overflowY: "auto", marginTop: 4 }}>
                      {runnerResults.map(r => (
                        <button key={r.id} type="button"
                          onClick={() => { setSelectedRunner(r); setRunnerQuery(""); setRunnerResults([]) }}
                          style={{ width: "100%", textAlign: "left", color: C.fg, background: "transparent", border: "none", padding: "10px 14px", cursor: "pointer", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 10 }}
                          onMouseEnter={e => e.currentTarget.style.background = C.line}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{r.full_name}</div>
                            <div style={{ fontSize: 11, color: C.faint }}>
                              {[r.category, r.club, r.gender].filter(Boolean).join(" · ")}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {runnerQuery.length >= 2 && runnerResults.length === 0 && (
                    <div style={{ marginTop: 8, fontSize: 12, color: C.faint }}>
                      Sin resultados. Podés{" "}
                      <span onClick={() => setAddMode("new")} style={{ color: C.accent, cursor: "pointer", textDecoration: "underline" }}>crear un nuevo atleta</span>.
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div style={{ background: C.surface2, border: `1px solid ${C.accent}30`, borderRadius: 8, padding: "12px 16px", flex: 1, minWidth: 200 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{selectedRunner.full_name}</div>
                    <div style={{ fontSize: 12, color: C.muted }}>
                      {[selectedRunner.category, selectedRunner.club, selectedRunner.gender].filter(Boolean).join(" · ")}
                    </div>
                    <button onClick={() => setSelectedRunner(null)} style={{ ...BTN_GHOST, fontSize: 11, marginTop: 8, padding: "3px 10px" }}>Cambiar</button>
                  </div>
                  <div style={{ minWidth: 120 }}>
                    <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Dorsal *</div>
                    <input
                      value={bibForExisting}
                      onChange={e => setBibForExisting(e.target.value)}
                      placeholder="ej. 101"
                      style={{ ...INPUT, fontFamily: "monospace", fontWeight: 700, fontSize: 16, color: C.accent, textAlign: "center" }}
                      onKeyDown={e => e.key === "Enter" && addExisting()}
                      autoFocus
                    />
                  </div>
                  <div style={{ minWidth: 100 }}>
                    <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Distancia (km)</div>
                    <input
                      value={distForExisting}
                      onChange={e => setDistForExisting(e.target.value)}
                      placeholder="ej. 10"
                      style={{ ...INPUT, textAlign: "center" }}
                      type="number" step="0.5"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {addMode === "new" && (
            <div>
              <div style={{ fontSize: 12, color: C.faint, marginBottom: 12 }}>
                El atleta se guardará en la base de datos global. El dorsal solo aplica a esta carrera.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "80px 80px 1fr 1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Dorsal *</div>
                  <input value={newForm.bib_number} onChange={e => setNewForm(p => ({ ...p, bib_number: e.target.value }))}
                    placeholder="101" style={{ ...INPUT, fontFamily: "monospace", fontWeight: 700, color: C.accent, textAlign: "center" }} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Dist. km</div>
                  <input value={newForm.distance_km} onChange={e => setNewForm(p => ({ ...p, distance_km: e.target.value }))}
                    placeholder="10" style={{ ...INPUT, textAlign: "center" }} type="number" step="0.5" />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Nombre *</div>
                  <input value={newForm.first_name} onChange={e => setNewForm(p => ({ ...p, first_name: e.target.value }))} placeholder="Carlos" style={INPUT} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Apellido *</div>
                  <input value={newForm.last_name} onChange={e => setNewForm(p => ({ ...p, last_name: e.target.value }))} placeholder="Méndez" style={INPUT} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>DNI</div>
                  <input value={newForm.dni} onChange={e => setNewForm(p => ({ ...p, dni: e.target.value }))} placeholder="12345678" style={INPUT} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Género</div>
                  <select value={newForm.gender} onChange={e => {
                    const gender = e.target.value
                    setNewForm(p => ({ ...p, gender, category: autoCategory(p.birth_date, gender) }))
                  }} style={{ ...INPUT }}>
                    <option value="M">Masculino</option>
                    <option value="F">Femenino</option>
                    <option value="X">Otro</option>
                  </select>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Fecha de nacimiento</div>
                  <input value={newForm.birth_date} onChange={e => {
                    const birth_date = e.target.value
                    setNewForm(p => ({ ...p, birth_date, category: autoCategory(birth_date, p.gender) }))
                  }} style={INPUT} type="date" />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>
                    Categoría {newForm.birth_date && <span style={{ color: C.muted }}>(auto)</span>}
                  </div>
                  <input
                    value={newForm.category}
                    onChange={e => setNewForm(p => ({ ...p, category: e.target.value }))}
                    placeholder={newForm.birth_date ? autoCategory(newForm.birth_date, newForm.gender) || "—" : "ej. M30-34"}
                    style={{ ...INPUT, color: newForm.birth_date && autoCategory(newForm.birth_date, newForm.gender) ? C.accent : C.fg }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Club</div>
                  <input value={newForm.club} onChange={e => setNewForm(p => ({ ...p, club: e.target.value }))} placeholder="RC Runners" style={INPUT} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Email</div>
                  <input value={newForm.email} onChange={e => setNewForm(p => ({ ...p, email: e.target.value }))} placeholder="corredor@email.com" style={INPUT} type="email" />
                </div>
                {newForm.birth_date && calcAge(newForm.birth_date) !== null && (
                  <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 2 }}>
                    <div style={{ background: C.surface2, border: `1px solid ${C.lineStrong}`, borderRadius: 6, padding: "7px 10px", color: C.muted, fontSize: 13, width: "100%", textAlign: "center" }}>
                      <span style={{ color: C.fg, fontWeight: 700 }}>{calcAge(newForm.birth_date)}</span> años
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {addError && <div style={{ color: C.danger, fontSize: 12, marginBottom: 10, padding: "6px 10px", background: `${C.danger}15`, borderRadius: 4 }}>{addError}</div>}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
            <button onClick={() => { setShowAdd(false); resetAdd() }} style={BTN_GHOST}>Cancelar</button>
            <button
              onClick={addMode === "search" ? addExisting : addNew}
              disabled={saving}
              style={{ ...BTN_PRIMARY, opacity: saving ? 0.6 : 1 }}>
              {saving ? "Guardando..." : "Inscribir"}
            </button>
          </div>
        </div>
      )}

      {/* Búsqueda en tabla */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
        {registrations.length > 0 && (
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre o dorsal…" style={{ ...INPUT, maxWidth: 280 }} />
        )}
        {!locked && selected.size > 0 && (
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

      {/* Tabla */}
      <div style={{ ...CARD, overflow: "hidden", padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.line}` }}>
              {!locked && (
                <th style={{ padding: "8px 14px", width: 36 }}>
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selected.size === filtered.length}
                    ref={el => { if (el) el.indeterminate = selected.size > 0 && selected.size < filtered.length }}
                    onChange={toggleAll}
                    style={{ cursor: "pointer", accentColor: C.accent }}
                  />
                </th>
              )}
              {["Dorsal", "Dist.", "Nombre", "Categoría", "Club", "Estado"].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "8px 14px", fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: C.faint }}>{h}</th>
              ))}
              {!locked && <th />}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={locked ? 6 : 8} style={{ textAlign: "center", padding: 32, color: C.faint }}>{search ? "Sin resultados" : "No hay inscriptos aún"}</td></tr>
            ) : filtered.map(r => {
              const isSelected = selected.has(r.id)
              const dist = r.distance_km
              const statusInfo = REG_STATUS[r.status] || REG_STATUS.OK
              return (
                <tr key={r.id} style={{ borderBottom: `1px solid ${C.surface2}`, opacity: r.status !== "OK" ? 0.65 : 1, background: isSelected ? `${C.danger}08` : "transparent" }}>
                  {!locked && (
                    <td style={{ padding: "9px 14px" }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(r.id)}
                        style={{ cursor: "pointer", accentColor: C.accent }}
                      />
                    </td>
                  )}
                  <td style={{ padding: "9px 14px" }}>
                    <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, background: C.surface2, padding: "2px 10px", borderRadius: 4, color: C.accent }}>{r.bib_number}</span>
                  </td>
                  <td style={{ padding: "9px 14px" }}>
                    {dist ? <span style={{ background: `${C.blue}15`, color: C.blue, border: `1px solid ${C.blue}30`, borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>{dist} km</span> : <span style={{ color: C.faint, fontSize: 12 }}>--</span>}
                  </td>
                  <td style={{ padding: "9px 14px", fontSize: 13, fontWeight: 500 }}>{r.runner.full_name}</td>
                  <td style={{ padding: "9px 14px" }}>
                    <span style={{ background: r.runner.category?.startsWith("F") ? `${C.blue}15` : `${C.accent}15`, color: r.runner.category?.startsWith("F") ? C.blue : C.accent, border: "1px solid " + (r.runner.category?.startsWith("F") ? `${C.blue}30` : `${C.accent}30`), borderRadius: 20, padding: "2px 8px", fontSize: 11 }}>
                      {r.runner.category || "--"}
                    </span>
                  </td>
                  <td style={{ padding: "9px 14px", fontSize: 13, color: C.muted }}>{r.runner.club || "--"}</td>
                  <td style={{ padding: "9px 14px" }}>
                    {locked
                      ? <span style={{ background: statusInfo.color + "20", color: statusInfo.color, border: `1px solid ${statusInfo.color}40`, borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>{statusInfo.label}</span>
                      : <select value={r.status} onChange={e => setStatus(r, e.target.value)}
                          style={{ background: C.surface2, border: `1px solid ${C.lineStrong}`, borderRadius: 4, padding: "3px 6px", color: REG_STATUS[r.status]?.color || C.fg, fontSize: 12, outline: "none", cursor: "pointer" }}>
                          <option value="OK">OK</option>
                          <option value="DNS">DNS — No largó</option>
                          <option value="DNF">DNF — No terminó</option>
                          <option value="DQ">DQ — Descalificado</option>
                        </select>
                    }
                  </td>
                  {!locked && (
                    <td style={{ padding: "9px 14px", textAlign: "right" }}>
                      <button onClick={() => deleteReg(r)} style={BTN_DANGER} aria-label="Eliminar"><Icon name="x" size={12} /></button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
