import { useState, useCallback } from "react"
import { PublishedChip, RaceStatusBadge } from "../components/Badges.jsx"
import { Icon } from "../components/Icon.jsx"
import { API } from "../lib/api.js"
import { formatDate } from "../lib/tiempo.js"
import { ask, notify } from "../lib/ui-store.js"
import { BTN_GHOST, BTN_PRIMARY, C, WITH_ICON } from "../theme.js"
import { InscripcionPanel } from "./InscripcionPanel.jsx"
import { InscriptosView } from "./InscriptosView.jsx"
import { ResultsDetail } from "./ResultsDetail.jsx"
import { TimingPage } from "./TimingPage.jsx"

// ═══════════════════════════════════════════════════════════════════════════════
// RACE DETAIL PAGE — drill-in con sub-tabs por carrera
// ═══════════════════════════════════════════════════════════════════════════════

export function RaceDetailPage({ race: initialRace, onBack }) {
  const [race, setRace]     = useState(initialRace)
  // Abrir en la pestaña que corresponde al momento de la carrera: el día de la
  // carrera se entra a cronometrar, después a ver resultados.
  const [subPage, setSubPage] = useState(
    initialRace.status === "ACTIVE" ? "cronometro" : initialRace.status === "FINISHED" ? "resultados" : "inscriptos"
  )
  const [publishing, setPublishing] = useState(false)
  const [sending, setSending] = useState(false)

  const refreshRace = useCallback(() => {
    fetch(API + "/races/" + initialRace.id)
      .then(r => r.json())
      .then(setRace)
      .catch(() => {})
  }, [initialRace.id])

  const changeStatus = async (status) => {
    const r = await fetch(API + "/races/" + race.id, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      notify(err.detail || "No se puede cambiar el estado", { kind: "error" })
      return false
    }
    refreshRace()
    return true
  }

  const finishRace = async () => {
    const pend = await fetch(API + "/races/" + race.id + "/captures?status=PENDING")
      .then(r => r.json()).catch(() => [])
    const n = Array.isArray(pend) ? pend.length : 0
    const aviso = n > 0
      ? `Quedan ${n} llegada${n > 1 ? "s" : ""} sin dorsal asignado en la cola.\n\nSi finalizás ahora, esos tiempos no entran en los resultados (podés reabrir la carrera para corregir).\n\n¿Finalizar "${race.name}" igual?`
      : `¿Finalizar "${race.name}"?\n\nSe cierra el cronómetro y la carrera pasa a Finalizadas. Después vas a poder publicar y enviar los resultados.`
    if (!(await ask({ title: "Finalizar carrera", message: aviso, confirmLabel: "Finalizar carrera", danger: true }))) return
    if (await changeStatus("FINISHED")) setSubPage("resultados")
  }

  const reopenForCorrection = async () => {
    if (!(await ask({ title: "Reabrir carrera", confirmLabel: "Reabrir", message: `¿Reabrir "${race.name}" para corregir?\n\nLa carrera vuelve al estado "En curso" para que puedas ajustar dorsales, tiempos o estados de los corredores. Cuando termines, finalizala de nuevo.\n\nNo puede haber otra carrera en curso al mismo tiempo.` }))) return
    if (await changeStatus("ACTIVE")) setSubPage("cronometro")
  }

  const duplicate = async () => {
    if (!(await ask({ title: "Duplicar carrera", confirmLabel: "Duplicar", message: `¿Duplicar "${race.name}" como nueva carrera?\n\nSe crea una copia en estado "En preparación" con los mismos inscriptos (sin tiempos ni resultados). Útil para ediciones recurrentes.` }))) return
    const r = await fetch(API + "/races/" + race.id + "/duplicate", { method: "POST" })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      notify("Error al duplicar: " + (err.detail || "error desconocido"), { kind: "error" })
      return
    }
    const created = await r.json()
    notify(`Carrera duplicada: "${created.name}".\nLa encontrás en la lista de carreras.`, { kind: "success" })
    onBack()
  }

  const publish = async () => {
    // Verificar que la nube esté configurada
    const cfg = await fetch(API + "/cloud/config").then(r => r.json()).catch(() => null)
    if (!cfg || !cfg.configured) {
      notify("Primero configurá la conexión al portal en Configuración → Nube (URL + API key).", { kind: "error" })
      return
    }
    // Una carrera todavía en preparación se anuncia en el calendario del portal;
    // una ya corrida publica su tabla de resultados. El backend decide según el
    // estado, así que el aviso tiene que decir lo mismo que va a pasar.
    const esEvento = race.status === "PLANNED"
    const aviso = esEvento
      ? `¿Anunciar "${race.name}" en el calendario del portal?\n\nSe enviará: nombre, fecha, lugar, distancias, cupo, cantidad de inscriptos y el link de inscripción.\nNO se envían datos de los corredores.\n\nLos corredores lo van a ver en: ${cfg.url}`
      : `¿Publicar los resultados de "${race.name}" en el portal público?\n\nSe enviará: nombre, categoría, club, dorsal, distancia y tiempos.\nNO se envía DNI ni fecha de nacimiento.\n\nLos corredores podrán reclamar su resultado en: ${cfg.url}`
    if (!(await ask({ title: esEvento ? "Anunciar en el portal" : "Publicar resultados", message: aviso, confirmLabel: esEvento ? "Anunciar" : "Publicar" }))) return
    setPublishing(true)
    try {
      const r = await fetch(API + "/races/" + race.id + "/publish", { method: "POST" })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        notify("No se pudo publicar: " + (data.detail || "error desconocido"), { kind: "error" })
        return
      }
      // el código queda visible en el chip del header; el aviso ya no necesita ser sticky
      notify(data.event
        ? `${data.message}\n\nInscriptos informados: ${data.registered_count}\nCódigo de la carrera: ${data.code}\n\nYa aparece en el Calendario del portal. Cuando publiques los resultados, pasa sola a Carreras con el mismo código.`
        : `${data.message}\n\nResultados publicados: ${data.published_results}\nCódigo de la carrera: ${data.code}\n\nLos corredores ya pueden buscarla en el portal con ese código.`, { kind: "success" })
      refreshRace()
    } catch (e) {
      notify("No se pudo publicar: " + e.message, { kind: "error" })
    } finally {
      setPublishing(false)
    }
  }

  const sendResults = async () => {
    const cfg = await fetch(API + "/email/config").then(r => r.json()).catch(() => null)
    if (!cfg || !cfg.configured) {
      notify("Primero configurá el envío de emails en Configuración → Email (API key + remitente).", { kind: "error" })
      return
    }
    if (!(await ask({ title: "Enviar resultados por email", confirmLabel: "Enviar", message: `¿Enviar por email el resultado a los finishers de "${race.name}"?\n\nSe enviará a cada corredor que tenga email cargado: su tiempo, posición y un link al portal.\n\nRemitente: ${cfg.from_name} <${cfg.from_email}>` }))) return
    setSending(true)
    try {
      const r = await fetch(API + "/races/" + race.id + "/send-results", { method: "POST" })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        notify("No se pudo enviar: " + (data.detail || "error desconocido"), { kind: "error" })
        return
      }
      let msg = `Emails enviados: ${data.sent}\n`
      if (data.no_email) msg += `Sin email (omitidos): ${data.no_email}\n`
      if (data.failed) msg += `\nFallidos: ${data.failed}\n` + (data.failed_detail || []).join("\n")
      notify(msg, { kind: data.failed ? "error" : "success" })
    } catch (e) {
      notify("No se pudo enviar: " + e.message, { kind: "error" })
    } finally {
      setSending(false)
    }
  }

  const SUB = [
    { id: "inscriptos", label: "Inscriptos" },
    { id: "cronometro", label: "Cronómetro" },
    { id: "resultados", label: "Resultados" },
  ]

  return (
    <div>
      {/* Header de carrera */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 0 }}>
        <button onClick={onBack} style={{ ...BTN_GHOST, marginTop: 4, flexShrink: 0 }}>← Carreras</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 20 }}>{race.name}</div>
          <div style={{ fontSize: 12, color: C.faint, marginTop: 3, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span>{[formatDate(race.race_date), race.location].filter(Boolean).join(" · ")}</span>
            {/* El chip va acá y no en la fila de acciones: ahí le sacaba ancho al nombre. */}
            {race.published_at && <PublishedChip race={race} />}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end", flexShrink: 0, marginTop: 2 }}>
          {/* Acciones ordenadas por etapa: secundarias a la izquierda, y a la
              derecha la única acción principal de este momento de la carrera. */}
          <RaceStatusBadge status={race.status} />
          <button onClick={duplicate}
            title="Crear una copia de esta carrera con los mismos inscriptos"
            style={BTN_GHOST}>
            <span style={WITH_ICON}><Icon name="copy" size={13} />Duplicar</span>
          </button>
          {race.status === "FINISHED" && (
            <button onClick={reopenForCorrection}
              title="Reabrir la carrera para corregir resultados"
              style={BTN_GHOST}>
              <span style={WITH_ICON}><Icon name="undo" size={13} />Reabrir para corregir</span>
            </button>
          )}
          {race.status === "FINISHED" && (
            <button onClick={sendResults} disabled={sending}
              title="Enviar a cada finisher su resultado por email"
              style={{ ...BTN_GHOST, cursor: sending ? "default" : "pointer", opacity: sending ? 0.6 : 1 }}>
              {sending ? "Enviando…" : <span style={WITH_ICON}><Icon name="mail" size={13} />Enviar resultados</span>}
            </button>
          )}
          {race.status === "ACTIVE" ? (
            <>
              {/* En la pestaña Cronómetro el botón ya está en el banner de carrera en curso. */}
              <button onClick={publish} disabled={publishing}
                title="Publicar los resultados parciales en el portal público (sin DNI ni fecha de nacimiento)"
                style={{ ...BTN_GHOST, cursor: publishing ? "default" : "pointer", opacity: publishing ? 0.6 : 1 }}>
                {publishing ? "Publicando…" : <span style={WITH_ICON}><Icon name="cloud" size={13} />{race.published_at ? "Volver a publicar parciales" : "Publicar parciales"}</span>}
              </button>
              {subPage !== "cronometro" && (
                <button onClick={finishRace}
                  title="Cerrar el cronómetro y pasar la carrera a Finalizadas"
                  style={{ ...BTN_PRIMARY, background: C.gold, color: "#000" }}>
                  <span style={WITH_ICON}><Icon name="stop" size={12} />Finalizar carrera</span>
                </button>
              )}
            </>
          ) : (
            <button onClick={publish} disabled={publishing}
              title={race.status === "PLANNED"
                ? "Anunciar la carrera en el calendario del portal"
                : "Publicar los resultados en el portal público (sin DNI ni fecha de nacimiento)"}
              style={{ ...BTN_PRIMARY, cursor: publishing ? "default" : "pointer", opacity: publishing ? 0.6 : 1 }}>
              {publishing ? "Publicando…" : <span style={WITH_ICON}><Icon name="cloud" size={13} />{race.status === "PLANNED"
                ? (race.published_at ? "Volver a anunciar" : "Publicar en calendario")
                : (race.published_at ? "Volver a publicar" : "Publicar resultados")}</span>}
            </button>
          )}
        </div>
      </div>

      {/* Inscripción: sólo mientras la carrera no se corrió — es lo que viaja al
          calendario del portal cuando se aprieta "Publicar". */}
      {race.status === "PLANNED" && <InscripcionPanel race={race} onSaved={refreshRace} />}

      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${C.line}`, marginTop: 16, marginBottom: 20 }}>
        {SUB.map(s => (
          <button key={s.id} onClick={() => setSubPage(s.id)}
            style={{ padding: "10px 20px", background: "transparent", border: "none", borderBottom: subPage === s.id ? `2px solid ${C.accent}` : "2px solid transparent", cursor: "pointer", color: subPage === s.id ? C.accent : C.muted, fontWeight: subPage === s.id ? 700 : 400, fontSize: 13, marginBottom: -1, transition: "color 0.15s" }}>
            {s.label}
            {s.id === "cronometro" && race.status === "ACTIVE" && (
              <span title="Carrera en curso" style={{ display: "inline-block", width: 7, height: 7, borderRadius: 7, background: C.accent, marginLeft: 6, verticalAlign: "middle" }} />
            )}
          </button>
        ))}
      </div>

      {/* Contenido del sub-tab */}
      {subPage === "inscriptos" && <InscriptosView race={race} />}
      {subPage === "cronometro" && <TimingPage race={race} onRaceChange={refreshRace} onFinish={finishRace} />}
      {subPage === "resultados" && <ResultsDetail race={race} hideBackButton />}
    </div>
  )
}
