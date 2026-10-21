import { useState, useEffect, useRef, useCallback } from "react"
import { Icon } from "../components/Icon.jsx"
import { RaceClock } from "../components/Relojes.jsx"
import { Standings } from "../components/Standings.jsx"
import { useTimingEngine } from "../hooks/useTimingEngine.js"
import { API } from "../lib/api.js"
import { formatNs, horaANs, horaDeCaptura } from "../lib/tiempo.js"
import { ask, notify } from "../lib/ui-store.js"
import { BTN_GHOST, C, CARD, FONT_DISPLAY, FONT_NUM, RADIUS, WITH_ICON } from "../theme.js"

export function TimingPage({ race, onRaceChange, onFinish }) {
  const raceId = race?.id
  const finalizada = race?.status === "FINISHED"
  // La cola viene de la más vieja a la más nueva: arriba está la próxima que
  // hay que asignar, en el orden en que cruzaron.
  const {
    queue, finishers, connected, capture, assignBib, undoAssign, discard, bibLookup,
    errores, limpiarError, aviso, cerrarAviso, sinGuardar, version,
  } = useTimingEngine(raceId, {
    // Si el servidor rechaza el dorsal, el foco vuelve a esa captura.
    onError: (data) => {
      const inp = document.getElementById("bib-" + data.capture_id)
      if (inp) { inp.focus(); inp.select() }
    },
  })
  const [hints, setHints] = useState({})
  const [carrera, setCarrera] = useState(null)       // race fresca (largadas)
  const [distancias, setDistancias] = useState([])   // distancias de los inscriptos

  useEffect(() => {
    if (!raceId) return
    fetch(API + "/races/" + raceId)
      .then(r => r.json())
      .then(setCarrera)
      .catch(() => {})
  }, [raceId, version])

  useEffect(() => {
    if (!raceId) return
    fetch(API + "/races/" + raceId + "/registrations")
      .then(r => r.json())
      .then(regs => setDistancias(
        [...new Set((regs || []).map(r => r.distance_km).filter(d => d != null))].sort((a, b) => a - b)
      ))
      .catch(() => {})
  }, [raceId])

  const raceStartNs = carrera ? carrera.race_start_ns : (race?.race_start_ns || null)
  const largadas = carrera?.starts || race?.starts || []
  const largadaDe = (d) => largadas.find(s => Math.abs(s.distance_km - d) < 0.0005)?.start_ns || null

  // ESPACIO captura siempre, también mientras se tipea un dorsal: los dorsales
  // no llevan espacios y el operador no puede soltar el teclado cuando llega
  // otro corredor. Sólo se respeta en campos de texto que no son de dorsal.
  useEffect(() => {
    if (finalizada) return
    const h = (e) => {
      if (e.code !== "Space") return
      const el = document.activeElement
      const isBib = el?.classList?.contains("bib-input")
      if (!isBib && ["INPUT", "TEXTAREA", "SELECT"].includes(el?.tagName)) return
      e.preventDefault()
      if (e.repeat) return // mantener apretado no genera ráfagas de capturas
      if (el?.tagName === "BUTTON") el.blur()
      capture()
    }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [capture, finalizada])

  // Descartar no pide confirmación: un confirm() nativo congela la página (ESPACIO
  // deja de capturar) y ESPACIO/ENTER lo aceptan por reflejo. La fila se oculta
  // y el descarte se envía recién a los 8 s, salvo que se deshaga antes.
  const [discarding, setDiscarding] = useState(null) // { id, seq }
  const discardTimer = useRef(null)
  const commitDiscard = useCallback((d) => {
    clearTimeout(discardTimer.current)
    setDiscarding(null)
    if (d) discard(d.id)
  }, [discard])
  const askDiscard = (item) => {
    commitDiscard(discarding)
    const d = { id: item.id, seq: item.sequence_order }
    setDiscarding(d)
    discardTimer.current = setTimeout(() => commitDiscard(d), 8000)
  }
  const pendingRef = useRef(null)
  useEffect(() => { pendingRef.current = discarding }, [discarding])
  useEffect(() => () => { // al salir de la pantalla, lo pendiente se confirma
    clearTimeout(discardTimer.current)
    if (pendingRef.current) discard(pendingRef.current.id)
  }, [discard])
  const visibleQueue = discarding ? queue.filter(i => i.id !== discarding.id) : queue

  // Si el foco no está en un dorsal, llevarlo a la captura pendiente más vieja
  // para poder tipear el número apenas se captura.
  const queueKey = visibleQueue.map(i => i.id).join(",")
  useEffect(() => {
    if (document.activeElement?.tagName === "INPUT") return
    document.querySelector(".bib-input")?.focus()
  }, [queueKey])

  // El aviso de conexión espera 2 s: al abrir la pantalla el socket tarda un
  // instante y no tiene sentido alarmar por eso.
  // Cada corte arranca su propio timer; el cleanup (al volver la conexión) rearma graceOver en false.
  const [graceOver, setGraceOver] = useState(false)
  useEffect(() => {
    if (connected) return
    const t = setTimeout(() => setGraceOver(true), 2000)
    return () => { clearTimeout(t); setGraceOver(false) }
  }, [connected])
  const offline = !connected && graceOver

  const handleInput = async (id, val) => {
    setHints(p => ({ ...p, [id]: null }))
    limpiarError(id)
    if (!val) return
    const r = await bibLookup(val)
    setHints(p => ({ ...p, [id]: r }))
  }

  // No se limpia el campo: si el servidor acepta, la fila desaparece sola; si
  // rechaza el dorsal, queda escrito para corregirlo.
  const handleAssign = (id) => {
    const inp = document.getElementById("bib-" + id)
    const bib = inp?.value.trim()
    if (bib) assignBib(id, bib)
  }

  // distance_km null = largada general (todas las distancias sin largada propia).
  const startRace = async (distance_km = null) => {
    // El instante es el del click: la confirmación viene después y su demora se descuenta.
    const t0 = performance.now()
    const que = distance_km != null ? ` de ${distance_km} km` : (distancias.length > 1 ? " general" : "")
    const alcance = distance_km == null && distancias.length > 1 ? "Vale para todas las distancias sin largada propia. " : ""
    if (!(await ask({ title: `Registrar largada${que}`, message: `${alcance}Los tiempos netos se miden desde el momento del click, no desde esta confirmación.`, confirmLabel: "Registrar largada" }))) return
    const r = await fetch(API + "/races/" + raceId + "/start", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ distance_km, click_delay_ms: Math.max(0, Math.round(performance.now() - t0)) }),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) { notify(data.detail || "No se pudo registrar la largada", { kind: "error" }); return }
    fetch(API + "/races/" + raceId).then(r => r.json()).then(setCarrera).catch(() => {})
    onRaceChange?.()
  }

  const corregirLargada = async (distance_km = null) => {
    const actual = distance_km != null ? (largadaDe(distance_km) || raceStartNs) : raceStartNs
    const que = distance_km != null ? `de ${distance_km} km` : "general"
    // Sin largada previa (se olvidó el botón) se carga la hora a mano.
    const titulo = actual ? `Corregir largada ${que}` : "Cargar hora de largada"
    const texto = await ask({
      title: titulo,
      message: "Hora real de la largada (hh:mm:ss o hh:mm:ss.cc).",
      input: actual ? horaDeCaptura(actual) : "", confirmLabel: "Continuar",
    })
    if (texto === false) return
    const nuevo = horaANs(texto, actual)
    if (!nuevo) { notify("Hora no válida. Usá el formato hh:mm:ss o hh:mm:ss.cc", { kind: "error" }); return }
    if (!(await ask({
      title: titulo,
      message: `${actual ? `De ${horaDeCaptura(actual)} a` : "Largada a las"} ${horaDeCaptura(nuevo)}.\n\nSe recalculan los tiempos de todos los corredores ya asignados${distance_km != null ? ` en ${distance_km} km` : ""}.`,
      confirmLabel: actual ? "Corregir largada" : "Cargar largada", danger: !!actual,
    }))) return
    const r = await fetch(API + "/races/" + raceId + "/start/adjust", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ distance_km, start_ns: nuevo }),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) { notify(data.detail || "No se pudo corregir la largada", { kind: "error" }); return }
    setCarrera(data)
    onRaceChange?.()
  }

  if (!race) return (
    <div style={{ textAlign: "center", padding: 60, color: C.faint }}>Seleccioná una carrera</div>
  )

  // ── Carrera finalizada: solo mostrar clasificación final ──
  if (finalizada) {
    return (
      <div>
        <div style={{ background: "#0f0f0f", border: `1px solid ${C.gold}40`, borderRadius: RADIUS.hero, padding: "20px 24px", marginBottom: 20, display: "flex", alignItems: "center", gap: 16 }}>
          <Icon name="trophy" size={32} style={{ color: C.gold }} />
          <div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 17, color: C.gold, marginBottom: 4 }}>Carrera finalizada</div>
            <div style={{ fontSize: 13, color: C.faint }}>El cronómetro está cerrado. Consultá los resultados en la pestaña <strong style={{ color: C.muted }}>Resultados</strong>.</div>
          </div>
        </div>
        <div style={{ ...CARD }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: C.muted, marginBottom: 12, display: "flex", alignItems: "center" }}>
            Clasificación <span style={{ marginLeft: 4 }}>final</span>
            <span style={{ marginLeft: "auto", background: `${C.blue}15`, color: C.blue, border: `1px solid ${C.blue}30`, borderRadius: 20, padding: "2px 8px", fontSize: 11 }}>{finishers.length} finishers</span>
          </div>
          {finishers.length === 0
            ? <div style={{ textAlign: "center", padding: 32, color: C.faint }}>Sin tiempos registrados</div>
            : <Standings finishers={finishers} />
          }
        </div>
      </div>
    )
  }

  const BTN_LARGADA = { padding: "6px 14px", background: C.gold, border: "none", borderRadius: RADIUS.pill, cursor: "pointer", color: "#000", fontWeight: 800, fontSize: 12 }
  const BTN_CORREGIR = { padding: "4px 10px", background: "transparent", border: `1px solid ${C.lineStrong}`, borderRadius: RADIUS.pill, cursor: "pointer", color: C.muted, fontSize: 11 }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      {/* ── Avisos que no se pueden perder de vista ── */}
      {sinGuardar > 0 && (
        <div role="alert" style={{ background: `${C.danger}15`, border: `2px solid ${C.danger}`, borderRadius: RADIUS.sm, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, color: C.fg, fontSize: 14 }}>
          <Icon name="alert" size={18} style={{ color: C.danger, flexShrink: 0 }} />
          <span><strong>{sinGuardar} captura{sinGuardar > 1 ? "s" : ""} sin guardar en el servidor.</strong> Se reintenta cada 2 s con la hora real del cruce. No cierres esta ventana.</span>
        </div>
      )}

      {/* ── Banner de estado de largada ── */}
      {!raceStartNs ? (
        <div style={{ background: "#1a1200", border: `2px solid ${C.gold}`, borderRadius: RADIUS.hero, padding: "14px 20px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <Icon name="pause" size={26} style={{ color: C.gold }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 15, color: C.gold, marginBottom: 2 }}>Carrera sin largada oficial</div>
            <div style={{ fontSize: 12, color: "#b8a878" }}>Sin largada, las llegadas se muestran con la hora de captura. Registrá la largada para medir tiempos netos reales.</div>
          </div>
          <button onClick={() => corregirLargada(null)} title="Si la largada ya se dio y no se registró, cargá la hora real"
            style={{ ...BTN_CORREGIR, padding: "8px 14px", fontSize: 12, borderColor: `${C.gold}60`, color: C.gold, flexShrink: 0 }}>Cargar hora</button>
          <button onClick={() => startRace(null)}
            style={{ padding: "10px 24px", background: C.gold, border: "none", borderRadius: RADIUS.pill, cursor: "pointer", color: "#000", fontWeight: 800, fontFamily: FONT_DISPLAY, fontSize: 14, letterSpacing: 0.5, flexShrink: 0 }}>
            <span style={WITH_ICON}><Icon name="flag" size={16} />{distancias.length > 1 ? "Largada general" : "Registrar largada"}</span>
          </button>
        </div>
      ) : (
        <div style={{ background: C.surface, border: `1px solid ${C.lineStrong}`, borderRadius: RADIUS.hero, padding: "14px 20px", display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 15, color: C.fg, marginBottom: 2 }}>Carrera en curso</div>
            <div style={{ fontSize: 12, color: C.muted, display: "flex", alignItems: "center", gap: 8 }}>
              <span>Largada{distancias.length > 1 ? " general" : ""} <span style={FONT_NUM}>{horaDeCaptura(raceStartNs)}</span></span>
              <button onClick={() => corregirLargada(null)} style={BTN_CORREGIR}>Corregir</button>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <RaceClock startNs={raceStartNs} style={{ display: "block", fontFamily: FONT_DISPLAY, ...FONT_NUM, fontSize: 44, fontWeight: 800, color: C.accent, lineHeight: 1, letterSpacing: -0.5 }} />
            <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Tiempo de carrera</div>
          </div>
          {/* Cerrar la carrera vive donde está el operador el día de la
              carrera, no escondido en la cabecera. */}
          <button onClick={onFinish}
            title="Cerrar el cronómetro y pasar la carrera a Finalizadas"
            style={{ padding: "10px 18px", background: "transparent", border: `1px solid ${C.gold}`, borderRadius: RADIUS.pill, cursor: "pointer", color: C.gold, fontWeight: 800, fontFamily: FONT_DISPLAY, fontSize: 13, flexShrink: 0 }}>
            <span style={WITH_ICON}><Icon name="stop" size={14} />Finalizar carrera</span>
          </button>
        </div>
      )}

      {offline && (
        <div role="status" style={{ background: `${C.danger}15`, border: `1px solid ${C.danger}60`, borderRadius: RADIUS.sm, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, color: C.fg, fontSize: 14 }}>
          <Icon name="alert" size={18} style={{ color: C.danger, flexShrink: 0 }} />
          <span><strong>Sin conexión en vivo, reconectando.</strong> ESPACIO sigue capturando llegadas; mientras tanto todo se envía por HTTP.</span>
        </div>
      )}

      {/* El error queda hasta que el operador lo cierra: si se iba solo, una
          acción fallida durante un pelotón pasaba sin que nadie la viera. */}
      {aviso && (
        <div role="alert" style={{ background: `${C.danger}15`, border: `1px solid ${C.danger}60`, borderRadius: RADIUS.sm, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, color: C.danger, fontSize: 14 }}>
          <span style={{ flex: 1 }}>{aviso}</span>
          <button onClick={cerrarAviso} aria-label="Cerrar aviso"
            style={{ background: "transparent", border: "none", color: C.danger, cursor: "pointer", padding: 4, display: "flex" }}><Icon name="x" size={16} /></button>
        </div>
      )}

      {discarding && (
        <div role="status" style={{ background: C.surface2, border: `1px solid ${C.lineStrong}`, borderRadius: RADIUS.sm, padding: "8px 8px 8px 14px", display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
          <span style={{ flex: 1 }}>Llegada #{discarding.seq} descartada.</span>
          <button onClick={() => { clearTimeout(discardTimer.current); setDiscarding(null) }}
            style={{ ...BTN_GHOST, color: C.fg, padding: "6px 14px" }}>Deshacer</button>
        </div>
      )}

      {/* ── Largada por distancia (sólo si hay varias) ── */}
      {distancias.length > 1 && (
        <div style={{ ...CARD, padding: "10px 16px", display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: C.muted }}>Largada por distancia</span>
          {distancias.map(d => {
            const propia = largadaDe(d)
            return (
              <div key={d} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                <strong>{d} km</strong>
                <span style={{ ...FONT_NUM, fontFamily: "monospace", color: propia ? C.accent : C.faint }}>
                  {propia ? horaDeCaptura(propia) : raceStartNs ? `general (${horaDeCaptura(raceStartNs)})` : "sin largada"}
                </span>
                {propia
                  ? <button onClick={() => corregirLargada(d)} style={BTN_CORREGIR}>Corregir</button>
                  : <button onClick={() => startRace(d)} style={BTN_LARGADA}><span style={{ ...WITH_ICON, gap: 4 }}><Icon name="flag" size={12} />Largar</span></button>}
              </div>
            )
          })}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16 }}>

      {/* Columna izquierda */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <button onClick={e => { e.currentTarget.blur(); capture() }}
          style={{ width: "100%", padding: 20, fontSize: 18, fontWeight: 800, fontFamily: FONT_DISPLAY, background: C.accent, border: "none", borderRadius: RADIUS.pill, cursor: "pointer", color: C.onAccent, letterSpacing: 1 }}>
          <span style={{ ...WITH_ICON, gap: 10 }}><Icon name="timer" size={22} />Capturar llegada</span>
        </button>

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ fontSize: 12, color: C.muted }}>
            <kbd style={{ background: C.surface2, border: `1px solid ${C.lineStrong}`, borderRadius: 3, padding: "1px 6px", fontFamily: "monospace", fontSize: 11 }}>ESPACIO</kbd> captura (también mientras escribís un dorsal) ·{" "}
            <kbd style={{ background: C.surface2, border: `1px solid ${C.lineStrong}`, borderRadius: 3, padding: "1px 6px", fontFamily: "monospace", fontSize: 11 }}>ENTER</kbd> asigna y pasa a la siguiente
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <div aria-hidden="true" style={{ width: 10, height: 10, borderRadius: "50%", background: connected ? C.accent : C.danger }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: connected ? C.muted : C.danger }}>{connected ? "Conectado" : "Reconectando…"}</span>
          </div>
        </div>

        <div style={{ ...CARD, flex: 1, overflow: "auto" }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: C.muted, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
            Cola de capturas
            {visibleQueue.length > 0 && (
              <span style={{ marginLeft: "auto", background: `${C.gold}15`, color: C.gold, border: `1px solid ${C.gold}30`, borderRadius: 20, padding: "2px 8px", fontSize: 11 }}>
                {visibleQueue.length} pendiente{visibleQueue.length > 1 ? "s" : ""}
              </span>
            )}
          </div>

          {visibleQueue.length === 0 && (
            <div style={{ textAlign: "center", padding: 32, color: C.faint }}>
              {connected ? "Presioná ESPACIO para capturar llegadas" : "Sin conexión — reconectando..."}
            </div>
          )}

          {visibleQueue.map(item => {
            const error = errores[item.id]
            const hint = hints[item.id]
            return (
            <div key={item.id} style={{ background: C.surface2, border: `1px solid ${error ? C.danger : C.line}`, borderRadius: 6, padding: "8px 12px", display: "flex", alignItems: "center", gap: 12, marginBottom: 6, maxWidth: 820 }}>
              <span style={{ ...FONT_NUM, fontSize: 12, color: C.faint, minWidth: 28 }}>#{item.sequence_order}</span>
              <span style={{ ...FONT_NUM, fontFamily: "monospace", fontSize: 15, color: C.fg, minWidth: 110 }} title={raceStartNs ? undefined : "Sin largada: hora de captura"}>
                {raceStartNs && item.captured_ns >= raceStartNs ? formatNs(item.captured_ns - raceStartNs) : horaDeCaptura(item.captured_ns)}
              </span>
              <input
                id={"bib-" + item.id}
                className="bib-input"
                placeholder="Dorsal"
                aria-label={`Dorsal de la llegada #${item.sequence_order}`}
                aria-invalid={error ? true : undefined}
                inputMode="numeric"
                onInput={e => handleInput(item.id, e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAssign(item.id)}
                style={{ width: 104, background: C.bg, border: `1px solid ${error ? C.danger : C.lineStrong}`, borderRadius: 4, padding: "6px 8px", fontFamily: "monospace", fontSize: 22, fontWeight: 700, color: C.fg, textAlign: "center", outline: "none" }}
                autoComplete="off"
              />
              <span style={{ flex: 1, fontSize: error ? 14 : 16, fontWeight: error ? 700 : 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                color: error ? C.danger : hint?.already_finished ? C.gold : hint?.found ? C.accent : hint ? C.danger : C.faint }}
                title={error || undefined}>
                {error
                  ? error
                  : hint?.already_finished
                    ? `Ya registrado — ${hint.runner?.full_name || ""}`
                    : hint?.found
                      ? hint.runner.full_name
                      : hint ? "No encontrado" : "--"}
              </span>
              <button onClick={() => handleAssign(item.id)}
                style={{ padding: "8px 14px", background: "transparent", color: C.fg, border: `1px solid ${C.lineStrong}`, borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>Asignar</button>
              {/* Separado de Asignar para que un clic apurado no caiga en el otro. */}
              <button onClick={() => askDiscard(item)}
                title="Descartar captura (fue un error)" aria-label={`Descartar llegada #${item.sequence_order}`}
                style={{ marginLeft: 20, padding: 8, background: "transparent", color: C.faint, border: "none", borderRadius: 6, cursor: "pointer", display: "flex" }}
                onMouseEnter={e => e.currentTarget.style.color = C.danger}
                onMouseLeave={e => e.currentTarget.style.color = C.faint}><Icon name="trash" size={16} /></button>
            </div>
            )
          })}

        </div>
      </div>

      {/* Columna derecha: Clasificación en vivo */}
      <div style={{ ...CARD, overflow: "auto" }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: C.muted, marginBottom: 12, display: "flex", alignItems: "center" }}>
          Clasificación <span style={{ marginLeft: 4 }}>en vivo</span>
          <span style={{ marginLeft: "auto", background: `${C.blue}15`, color: C.blue, border: `1px solid ${C.blue}30`, borderRadius: 20, padding: "2px 8px", fontSize: 11 }}>{finishers.length}</span>
        </div>
        {finishers.length === 0
          ? <div style={{ textAlign: "center", padding: 24, color: C.faint, fontSize: 13 }}>Sin finishers aún</div>
          : <Standings finishers={finishers} onCorrect={undoAssign} />
        }
      </div>
      </div>{/* end grid */}
    </div>
  )
}
