import { useState, useEffect, useRef, useCallback } from "react"
import { API, getWsBase } from "../lib/api.js"
import { contarSinGuardar, encolarCaptura, oyentesCapturas, porSecuencia } from "../lib/capturas.js"

export function useTimingEngine(raceId, { onAssigned, onError } = {}) {
  const [queue, setQueue]         = useState([])   // de la más vieja a la más nueva
  const [finishers, setFinishers] = useState([])
  const [connected, setConnected] = useState(false)
  const [errores, setErrores]     = useState({})   // capture_id → mensaje del servidor
  const [aviso, setAviso]         = useState(null) // error sin captura asociada
  const [sinGuardar, setSinGuardar] = useState(() => contarSinGuardar(raceId))  // capturas que todavía no llegaron al servidor
  const [version, setVersion]     = useState(0)    // sube con cada largada / corrección
  const wsRef      = useRef(null)
  const timerRef   = useRef(null)
  const activeRef  = useRef(true)
  const connectRef = useRef(null)
  const callbacksRef  = useRef({ onAssigned, onError })
  useEffect(() => { callbacksRef.current = { onAssigned, onError } })

  const cargarFinishers = useCallback(() => {
    if (!raceId) return
    fetch(API + "/races/" + raceId + "/results")
      .then(r => r.json())
      .then(data => setFinishers(
        (data.results || []).map(r => ({
          capture_id: r.capture_id ?? null,
          bib_number: r.bib_number,
          runner: r.runner,
          capture_ns: r.finish_time_ns,
          net_time_ns: r.net_time_ns,
          position: r.position,
          distance_km: r.distance_km ?? null,
        })).sort((a, b) => a.capture_ns - b.capture_ns)
      ))
      .catch(() => {})
  }, [raceId])

  // Estado persistido: al abrir y en cada reconexión, para no perder lo que
  // pasó mientras el socket estuvo caído.
  const reload = useCallback(() => {
    if (!raceId) return
    fetch(API + "/races/" + raceId + "/captures?status=PENDING")
      .then(r => r.json())
      .then(caps => setQueue(
        caps.map(c => ({ id: c.id, captured_ns: c.captured_ns, sequence_order: c.sequence_order })).sort(porSecuencia)
      ))
      .catch(() => {})
    cargarFinishers()
  }, [raceId, cargarFinishers])

  useEffect(() => { reload() }, [reload])

  // Mismo efecto para lo que llega por WebSocket y para las respuestas HTTP.
  const aplicar = useCallback((event, data) => {
    if (event === "CAPTURE" && data.type === "START") {
      setVersion(v => v + 1)
      cargarFinishers()
    } else if (event === "CAPTURE") {
      setQueue(prev => {
        if (prev.some(i => i.id === data.id)) return prev
        return [...prev, { id: data.id, captured_ns: data.captured_ns, sequence_order: data.sequence_order }].sort(porSecuencia)
      })
    } else if (event === "ASSIGNED") {
      setQueue(prev => prev.filter(i => i.id !== data.capture_id))
      setErrores(prev => { const n = { ...prev }; delete n[data.capture_id]; return n })
      setFinishers(prev => {
        const updated = prev.filter(f => f.capture_id !== data.capture_id)
        return [...updated, {
          capture_id: data.capture_id,
          bib_number: data.bib_number,
          runner: data.runner,
          capture_ns: data.capture_ns,
          net_time_ns: data.net_time_ns,
          position: data.position,
          distance_km: data.distance_km ?? null,
        }].sort((a, b) => a.capture_ns - b.capture_ns)
      })
      callbacksRef.current.onAssigned?.(data)
    } else if (event === "UNASSIGNED") {
      setFinishers(prev => prev.filter(f => f.capture_id !== data.capture_id))
      setQueue(prev => {
        if (prev.some(i => i.id === data.capture_id)) return prev
        return [...prev, { id: data.capture_id, captured_ns: data.captured_ns, sequence_order: data.sequence_order }].sort(porSecuencia)
      })
    } else if (event === "DISCARDED") {
      setQueue(prev => prev.filter(i => i.id !== data.capture_id))
    } else if (event === "RESULTS_UPDATE") {
      // Se corrigió una largada: los netos se recalculan en el servidor.
      setVersion(v => v + 1)
      cargarFinishers()
    } else if (event === "ERROR") {
      if (data.capture_id != null) {
        setErrores(prev => ({ ...prev, [data.capture_id]: data.message }))
        callbacksRef.current.onError?.(data)
      } else {
        setAviso(data.message || "Error del servidor")
      }
    }
  }, [cargarFinishers])

  const connect = useCallback(() => {
    if (!raceId || !activeRef.current) return
    const ws = new WebSocket(getWsBase() + "/ws/races/" + raceId + "/timing")
    wsRef.current = ws
    ws.onopen  = () => { if (activeRef.current) { setConnected(true); reload() } }
    ws.onerror = () => ws.close()
    ws.onclose = () => {
      if (!activeRef.current) return
      setConnected(false)
      timerRef.current = setTimeout(() => connectRef.current?.(), 3000)
    }
    ws.onmessage = (evt) => {
      const { event, data } = JSON.parse(evt.data)
      aplicar(event, data)
    }
  }, [raceId, aplicar, reload])

  useEffect(() => {
    connectRef.current = connect
    activeRef.current = true
    connect()
    return () => {
      activeRef.current = false
      clearTimeout(timerRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  // HTTP con el mensaje de error del servidor (detail) si falla.
  const http = useCallback(async (method, path, body) => {
    const r = await fetch(API + "/races/" + raceId + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = r.status === 204 ? {} : await r.json().catch(() => ({}))
    if (!r.ok) { const e = new Error(data.detail || "Error " + r.status); e.status = r.status; throw e }
    return data
  }, [raceId])

  // Estado de las capturas encoladas (ver guardarCapturasPendientes).
  useEffect(() => {
    const fn = (rid, res) => {
      setSinGuardar(contarSinGuardar(raceId))
      if (rid !== raceId) return
      if (res.captura) aplicar("CAPTURE", res.captura)
      if (res.rechazo) setAviso("Captura rechazada: " + res.rechazo)
    }
    oyentesCapturas.add(fn)
    return () => { oyentesCapturas.delete(fn) }
  }, [raceId, aplicar])

  const capture = useCallback(() => {
    if (wsRef.current?.readyState === 1) { wsRef.current.send(JSON.stringify({ action: "capture" })); return }
    // Sin WebSocket: por HTTP con la hora del cruce; si falla queda en cola y se reintenta.
    encolarCaptura(raceId)
    setSinGuardar(contarSinGuardar(raceId))
  }, [raceId])

  const assignBib = useCallback((id, bib) => {
    setErrores(prev => { const n = { ...prev }; delete n[id]; return n })
    if (wsRef.current?.readyState === 1) { wsRef.current.send(JSON.stringify({ action: "assign", capture_id: id, bib })); return }
    http("POST", "/captures/" + id + "/assign", { bib_number: bib })
      .then(data => aplicar("ASSIGNED", data))
      .catch(e => aplicar("ERROR", { capture_id: id, message: e.message }))
  }, [http, aplicar])

  const undoAssign = useCallback((captureId) => {
    if (wsRef.current?.readyState === 1) { wsRef.current.send(JSON.stringify({ action: "undo_assign", capture_id: captureId })); return }
    http("POST", "/captures/" + captureId + "/undo")
      .then(data => aplicar("UNASSIGNED", data))
      .catch(e => setAviso("No se pudo deshacer: " + e.message))
  }, [http, aplicar])

  const discard = useCallback((id) => {
    if (wsRef.current?.readyState === 1) { wsRef.current.send(JSON.stringify({ action: "discard", capture_id: id })); return }
    http("DELETE", "/captures/" + id)
      .then(() => aplicar("DISCARDED", { capture_id: id }))
      .catch(e => aplicar("ERROR", { capture_id: id, message: e.message }))
  }, [http, aplicar])

  const bibLookup  = useCallback(async (bib) => {
    if (!bib || !raceId) return null
    try {
      const r = await fetch(API + "/races/" + raceId + "/bib-lookup?bib=" + encodeURIComponent(bib))
      return await r.json()
    } catch { return null }
  }, [raceId])

  const limpiarError = useCallback((id) => {
    setErrores(prev => { if (!(id in prev)) return prev; const n = { ...prev }; delete n[id]; return n })
  }, [])

  return {
    queue, finishers, connected, capture, assignBib, undoAssign, discard, bibLookup,
    errores, limpiarError, aviso, cerrarAviso: () => setAviso(null), sinGuardar, version,
  }
}
