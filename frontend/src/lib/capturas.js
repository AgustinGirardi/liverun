import { API } from "./api.js"

// ── useTimingEngine ── WebSocket con reconexión + carga persistente ────────────
//
// Si el WebSocket está caído, las acciones van por HTTP. Una captura que
// tampoco se puede guardar por HTTP queda en una cola local que se reintenta
// sola (con la demora real, así el tiempo no cambia) y se avisa en pantalla:
// nunca se pierde una captura en silencio.

// Por hora de captura: una captura reintentada por HTTP recibe un
// sequence_order posterior, pero su hora es la del cruce real.
export const porSecuencia = (a, b) => (a.captured_ns - b.captured_ns) || (a.sequence_order - b.sequence_order)

// Capturas que todavía no llegaron al servidor. Viven fuera de React: si el
// operador cambia de pestaña, se siguen reintentando igual.
const capturasSinGuardar = []        // { raceId, t0 } — t0 = performance.now() del cruce
export const oyentesCapturas = new Set()    // pantallas montadas que muestran el estado
let reintentoCapturas = null
let guardandoCapturas = false

async function guardarCapturasPendientes() {
  if (guardandoCapturas) return
  guardandoCapturas = true
  try {
    while (capturasSinGuardar.length) {
      const p = capturasSinGuardar[0]
      let r
      try {
        r = await fetch(API + "/races/" + p.raceId + "/capture", {
          method: "POST", headers: { "Content-Type": "application/json" },
          // La demora desde el cruce: el servidor la descuenta de su hora.
          body: JSON.stringify({ delay_ms: Math.max(0, Math.round(performance.now() - p.t0)) }),
        })
      } catch { break }            // sin conexión: se reintenta en 2 s
      if (r.status >= 500) break
      const data = await r.json().catch(() => ({}))
      capturasSinGuardar.shift()
      // 4xx: el servidor la rechazó (ej. carrera finalizada); reintentar no sirve, se avisa.
      const res = r.ok ? { captura: data } : { rechazo: data.detail || "Error " + r.status }
      oyentesCapturas.forEach(fn => fn(p.raceId, res))
    }
  } finally {
    guardandoCapturas = false
    oyentesCapturas.forEach(fn => fn(null, {}))
    if (!capturasSinGuardar.length && reintentoCapturas) { clearInterval(reintentoCapturas); reintentoCapturas = null }
  }
}

export function encolarCaptura(raceId) {
  capturasSinGuardar.push({ raceId, t0: performance.now() })
  if (!reintentoCapturas) reintentoCapturas = setInterval(guardarCapturasPendientes, 2000)
  guardarCapturasPendientes()
}

export const contarSinGuardar = (raceId) => capturasSinGuardar.filter(p => p.raceId === raceId).length

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (capturasSinGuardar.length) { e.preventDefault(); e.returnValue = "" }
  })
}
