import { useState, useEffect, useRef } from "react"
import { formatCronometro, pad } from "../lib/tiempo.js"

// Tiempo de carrera con centésimas. Escribe directo en su nodo en cada cuadro:
// un setState a 60 fps re-renderizaba toda la app y metía demora al tipear.
export function RaceClock({ startNs, style }) {
  const ref = useRef(null)
  useEffect(() => {
    let raf
    const startMs = Math.floor(startNs / 1_000_000)
    const tick = () => {
      if (ref.current) ref.current.textContent = formatCronometro(Date.now() - startMs)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [startNs])
  return <span ref={ref} style={style} />
}

// Hora del día: referencia secundaria, sin centésimas para no competir con el
// tiempo de carrera.
export function WallClock({ style }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return <span style={style}>{pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}</span>
}
