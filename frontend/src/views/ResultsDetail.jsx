import { useState, useEffect, useCallback } from "react"
import { RegStatusBadge } from "../components/Badges.jsx"
import { Icon } from "../components/Icon.jsx"
import { API } from "../lib/api.js"
import { printCertificate, printResultsReport } from "../lib/impresion.js"
import { formatDate, formatTiempo } from "../lib/tiempo.js"
import { BTN_GHOST, C, CARD, FONT_NUM, INPUT, RADIUS, WITH_ICON } from "../theme.js"

// ═══════════════════════════════════════════════════════════════════════════════
// RESULTS DETAIL (resultados de una carrera con filtros)
// ═══════════════════════════════════════════════════════════════════════════════

export function ResultsDetail({ race, onBack, hideBackButton = false }) {
  const [results, setResults]       = useState(null)
  const [loading, setLoading]       = useState(true)
  const [view, setView]             = useState("general")
  const [search, setSearch]         = useState("")
  const [catFilter, setCatFilter]   = useState("")
  const [genderFilter, setGender]   = useState("")
  const [distFilter, setDistFilter] = useState(null)  // null = todas
  const [sortKey, setSortKey]       = useState("time")
  const [autoRefresh, setAutoRefresh] = useState(false)

  // loading arranca en true; las recargas (auto-refresh) no vuelven a mostrar "cargando".
  const load = useCallback(() => {
    fetch(API + "/races/" + race.id + "/results")
      .then(r => r.json())
      .then(d => { setResults(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [race.id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!autoRefresh) return
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [autoRefresh, load])

  // Al cambiar de carrera se limpian los filtros (ajuste durante el render, sin efecto).
  const [raceIdPrevia, setRaceIdPrevia] = useState(race.id)
  if (raceIdPrevia !== race.id) {
    setRaceIdPrevia(race.id)
    setSearch(""); setCatFilter(""); setGender(""); setDistFilter(null); setSortKey("time"); setView("general")
  }

  // Oro / plata / bronce: el puesto en color, con el mismo peso que el resto de la tabla.
  const MEDAL_COLOR = [C.gold, "#aabbcc", "#cd7c4a"]

  const categories = results
    ? [...new Set(results.results.map(r => r.category).filter(Boolean))].sort()
    : []

  const availDistances = results?.distances || []
  const hasMultiDist = availDistances.length > 1

  const filtered = (results?.results || [])
    .filter(r => {
      if (distFilter !== null && r.distance_km !== distFilter) return false
      if (catFilter && r.category !== catFilter) return false
      if (genderFilter && r.runner.gender !== genderFilter) return false
      if (search) {
        const q = search.toLowerCase()
        if (!r.runner.full_name.toLowerCase().includes(q) && !r.bib_number.includes(q)) return false
      }
      return true
    })
    .sort((a, b) => {
      if (sortKey === "time")      return (a.net_time_ns || a.finish_time_ns) - (b.net_time_ns || b.finish_time_ns)
      if (sortKey === "time_desc") return (b.net_time_ns || b.finish_time_ns) - (a.net_time_ns || a.finish_time_ns)
      if (sortKey === "name")      return a.runner.full_name.localeCompare(b.runner.full_name)
      if (sortKey === "bib")       return a.bib_number.localeCompare(b.bib_number, undefined, { numeric: true })
      return 0
    })

  const byCat = {}
  ;(results?.results || [])
    .filter(r => {
      if (distFilter !== null && r.distance_km !== distFilter) return false
      if (genderFilter && r.runner.gender !== genderFilter) return false
      if (search) {
        const q = search.toLowerCase()
        if (!r.runner.full_name.toLowerCase().includes(q) && !r.bib_number.includes(q)) return false
      }
      return true
    })
    .forEach(r => {
      const cat = r.category || "Sin categoría"
      if (!byCat[cat]) byCat[cat] = []
      byCat[cat].push(r)
    })
  Object.keys(byCat).forEach(cat => {
    byCat[cat].sort((a, b) => (a.net_time_ns || a.finish_time_ns) - (b.net_time_ns || b.finish_time_ns))
  })
  const sortedCats = Object.keys(byCat).sort()

  const SEL = (active) => ({
    padding: "5px 12px", fontSize: 12, borderRadius: 6, cursor: "pointer", border: "1px solid",
    background: active ? `${C.accent}20` : "transparent",
    color: active ? C.accent : C.muted,
    borderColor: active ? `${C.accent}40` : C.lineStrong,
    fontWeight: active ? 700 : 400,
  })

  return (
    <div>
      {/* Header */}
      {!hideBackButton && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
          <button onClick={onBack} style={{ ...BTN_GHOST, flexShrink: 0, marginTop: 2 }}>← Carreras</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{race.name}</div>
            <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>
              {[formatDate(race.race_date), race.location].filter(Boolean).join(" · ")}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginBottom: 12 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: C.faint, cursor: "pointer" }}>
          <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
          Auto-actualizar
        </label>
        <button onClick={load} style={{ ...BTN_GHOST, ...WITH_ICON }}><Icon name="refresh" size={13} />Actualizar</button>
        <button onClick={() => window.open(API + "/races/" + race.id + "/export/csv", "_blank")} style={{ ...BTN_GHOST, ...WITH_ICON }}><Icon name="download" size={13} />CSV</button>
        <button onClick={() => results && printResultsReport({ race, results })} disabled={!results} style={{ ...BTN_GHOST, ...WITH_ICON }}><Icon name="file" size={13} />Reporte PDF</button>
      </div>

      {/* Stats */}
      {results && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
          {[
            ["Finishers",  results.total_finishers,  C.accent],
            ["Inscritos",  results.total_registered, null],
            ["Pendientes", Math.max(0, results.total_registered - results.total_finishers - results.dnf_list.length), null],
            ["DNS/DNF/DQ", results.dnf_list.length,  results.dnf_list.length > 0 ? C.gold : null],
          ].map(([label, val, color]) => (
            <div key={label} style={{ ...CARD }}>
              <div style={{ fontSize: 26, fontWeight: 700, color: color || C.fg }}>{val}</div>
              <div style={{ fontSize: 11, color: C.faint, marginTop: 3, textTransform: "uppercase" }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Selector de distancia (solo si hay múltiples) ── */}
      {hasMultiDist && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: C.faint, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>Distancia</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button onClick={() => { setDistFilter(null); setCatFilter("") }}
              style={{ padding: "7px 18px", fontSize: 13, fontWeight: distFilter === null ? 800 : 500, borderRadius: RADIUS.pill, cursor: "pointer", border: "2px solid", background: distFilter === null ? `${C.accent}20` : "transparent", color: distFilter === null ? C.accent : C.muted, borderColor: distFilter === null ? C.accent : C.lineStrong }}>
              Todas
            </button>
            {availDistances.map(d => (
              <button key={d} onClick={() => { setDistFilter(d); setCatFilter("") }}
                style={{ padding: "7px 18px", fontSize: 13, fontWeight: distFilter === d ? 800 : 500, borderRadius: RADIUS.pill, cursor: "pointer", border: "2px solid", background: distFilter === d ? `${C.blue}20` : "transparent", color: distFilter === d ? C.blue : C.muted, borderColor: distFilter === d ? C.blue : C.lineStrong }}>
                {d} km
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar nombre o dorsal…"
          style={{ ...INPUT, width: 200, flex: "0 0 auto" }} />
        {categories.length > 0 && (
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
            style={{ background: C.surface2, border: `1px solid ${C.lineStrong}`, borderRadius: 6, padding: "7px 10px", color: catFilter ? C.fg : C.faint, fontSize: 12, outline: "none" }}>
            <option value="">Todas las categorías</option>
            {categories.map(c => <option key={c}>{c}</option>)}
          </select>
        )}
        <div style={{ display: "flex", gap: 4 }}>
          {[["", "Todos"], ["M", "Masculino"], ["F", "Femenino"]].map(([val, label]) => (
            <button key={val} onClick={() => setGender(val)} style={SEL(genderFilter === val)}>{label}</button>
          ))}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: C.faint, alignSelf: "center" }}>Ordenar:</span>
          {[["time", "Tiempo ↑"], ["time_desc", "Tiempo ↓"], ["name", "Nombre"], ["bib", "Dorsal"]].map(([val, label]) => (
            <button key={val} onClick={() => setSortKey(val)} style={SEL(sortKey === val)}>{label}</button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {[["general", "Clasificación General"], ["categories", "Por Categoría"]].map(([id, label]) => (
          <button key={id} onClick={() => setView(id)} style={SEL(view === id)}>{label}</button>
        ))}
        {(search || catFilter || genderFilter) && (
          <span style={{ alignSelf: "center", fontSize: 12, color: C.gold, marginLeft: 8 }}>
            {filtered.length} resultado{filtered.length !== 1 ? "s" : ""}
            {" "}
            <span onClick={() => { setSearch(""); setCatFilter(""); setGender("") }}
              style={{ color: C.faint, cursor: "pointer", textDecoration: "underline", fontSize: 11 }}>limpiar</span>
          </span>
        )}
      </div>

      {/* Vista General */}
      {view === "general" && (
        <>
          {loading
            ? <div style={{ textAlign: "center", padding: 48, color: C.faint }}>Cargando…</div>
            : (
              <div style={{ ...CARD, overflow: "hidden", padding: 0 }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.line}` }}>
                      {["Pos.", "Dorsal", hasMultiDist ? "Dist." : null, "Nombre", "Categoría", "Club", "Tiempo Neto", ""].filter(Boolean).map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "8px 14px", fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: C.faint }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0
                      ? <tr><td colSpan={8} style={{ textAlign: "center", padding: 48, color: C.faint }}>Sin resultados para los filtros aplicados</td></tr>
                      : filtered.map((r, i) => {
                          const isTop3 = sortKey === "time" && i < 3 && !catFilter && !genderFilter && !search
                          return (
                            <tr key={r.bib_number + (r.distance_km || "")} style={{ borderBottom: `1px solid ${C.surface2}` }}>
                              <td style={{ padding: "9px 14px", fontFamily: "monospace", color: isTop3 ? (i === 0 ? C.gold : i === 1 ? "#aabbcc" : "#cd7c4a") : C.faint, fontWeight: isTop3 ? 700 : 400 }}>
                                {r.position}
                              </td>
                              <td style={{ padding: "9px 14px" }}>
                                <span style={{ fontFamily: "monospace", fontSize: 12, background: C.surface2, padding: "2px 8px", borderRadius: 3, color: C.muted }}>{r.bib_number}</span>
                              </td>
                              {hasMultiDist && (
                                <td style={{ padding: "9px 14px" }}>
                                  {r.distance_km ? <span style={{ background: `${C.blue}15`, color: C.blue, border: `1px solid ${C.blue}30`, borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>{r.distance_km} km</span> : "--"}
                                </td>
                              )}
                              <td style={{ padding: "9px 14px", fontWeight: 500, fontSize: 13 }}>{r.runner.full_name}</td>
                              <td style={{ padding: "9px 14px" }}>
                                <span style={{ background: r.category?.startsWith("F") ? `${C.blue}15` : `${C.accent}15`, color: r.category?.startsWith("F") ? C.blue : C.accent, border: "1px solid " + (r.category?.startsWith("F") ? `${C.blue}30` : `${C.accent}30`), borderRadius: 20, padding: "2px 8px", fontSize: 11 }}>
                                  {r.category || "--"}
                                </span>
                              </td>
                              <td style={{ padding: "9px 14px", fontSize: 13, color: C.muted }}>{r.club || "--"}</td>
                              <td style={{ padding: "9px 14px", fontFamily: "monospace", ...FONT_NUM, color: C.fg, fontSize: 14, fontWeight: 600 }}>
                                {formatTiempo(r.net_time_ns, r.finish_time_ns)}
                              </td>
                              <td style={{ padding: "9px 10px", textAlign: "right" }}>
                                <button
                                  title="Imprimir certificado"
                                  onClick={() => printCertificate({ race, runner: r.runner, bib_number: r.bib_number, position: r.position, net_time_ns: r.net_time_ns, category: r.category, club: r.club, dni: r.runner.dni, distance_km: r.distance_km })}
                                  style={{ padding: "3px 8px", background: "transparent", border: `1px solid ${C.lineStrong}`, borderRadius: 4, cursor: "pointer", color: C.muted, fontSize: 12, ...WITH_ICON, gap: 5 }}>
                                  <Icon name="printer" size={13} />Certificado
                                </button>
                              </td>
                            </tr>
                          )
                        })
                    }
                  </tbody>
                </table>
              </div>
            )
          }

          {/* DNS / DNF / DQ */}
          {results?.dnf_list?.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.faint, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
                DNS / DNF / DQ — {results.dnf_list.length} corredor{results.dnf_list.length !== 1 ? "es" : ""}
              </div>
              <div style={{ ...CARD, overflow: "hidden", padding: 0, opacity: 0.65 }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <tbody>
                    {results.dnf_list
                      .filter(r => {
                        if (genderFilter && r.runner.gender !== genderFilter) return false
                        if (catFilter && r.category !== catFilter) return false
                        if (search) {
                          const q = search.toLowerCase()
                          if (!r.runner.full_name.toLowerCase().includes(q) && !r.bib_number.includes(q)) return false
                        }
                        return true
                      })
                      .map(r => (
                        <tr key={r.bib_number} style={{ borderBottom: `1px solid ${C.surface2}` }}>
                          <td style={{ padding: "8px 14px", width: 64 }}>
                            <span style={{ fontFamily: "monospace", fontSize: 12, background: C.surface2, padding: "2px 8px", borderRadius: 3, color: C.faint }}>{r.bib_number}</span>
                          </td>
                          <td style={{ padding: "8px 14px", fontSize: 13 }}>{r.runner.full_name}</td>
                          <td style={{ padding: "8px 14px", fontSize: 12, color: C.faint }}>{r.category || "--"}</td>
                          <td style={{ padding: "8px 14px" }}><RegStatusBadge status={r.status} /></td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Vista Por Categoría */}
      {view === "categories" && (
        <div>
          {sortedCats.length === 0
            ? <div style={{ textAlign: "center", padding: 48, color: C.faint }}>Sin resultados para los filtros aplicados</div>
            : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 12 }}>
                {sortedCats.map(cat => {
                  const runners = byCat[cat]
                  const isFem   = cat.startsWith("F")
                  const accent  = isFem ? C.blue : C.accent
                  return (
                    <div key={cat} style={{ ...CARD }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                        <span style={{ background: accent + "20", color: accent, border: `1px solid ${accent}40`, borderRadius: 20, padding: "3px 12px", fontSize: 13, fontWeight: 700 }}>{cat}</span>
                        <span style={{ color: C.faint, fontSize: 12 }}>{runners.length} finisher{runners.length !== 1 ? "s" : ""}</span>
                      </div>
                      {runners.map((r, i) => (
                        <div key={r.bib_number} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: i < runners.length - 1 ? `1px solid ${C.surface2}` : "none" }}>
                          <span style={{ fontSize: 13, minWidth: 24, fontFamily: "monospace", fontWeight: i < 3 ? 700 : 400, color: i < 3 ? MEDAL_COLOR[i] : C.faint }}>
                            {i + 1}
                          </span>
                          <span style={{ fontFamily: "monospace", fontSize: 11, background: C.surface2, padding: "1px 6px", borderRadius: 3, color: C.faint }}>{r.bib_number}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: i < 3 ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.runner.full_name}</div>
                          </div>
                          <span style={{ fontFamily: "monospace", fontSize: 12, color: accent, fontWeight: i < 3 ? 700 : 400 }}>
                            {formatTiempo(r.net_time_ns, r.finish_time_ns)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            )
          }
        </div>
      )}
    </div>
  )
}
