import { useState, useEffect } from "react"

// ── Diálogos y avisos propios ─────────────────────────────────────────────────
// Reemplazan a confirm()/alert(): los nativos congelan JS (ESPACIO deja de capturar
// llegadas en el cronómetro) y se aceptan por reflejo con ESPACIO/ENTER. Store a
// nivel módulo para llamarlos desde cualquier handler sin prop drilling.
let dialogQueue = []   // ask() mientras hay otro abierto: se encola y se muestra después
let notices = []
let noticeSeq = 0
const uiListeners = new Set()
const emitUi = () => uiListeners.forEach(fn => fn())

// Lecturas y cierre del estado de arriba: otros módulos no pueden reasignar
// los `let`, así que pasan por acá.
export const dialogoActual = () => dialogQueue[0] || null
export const avisosActuales = () => notices
export function cerrarDialogo(dialogo, valor) {
  dialogQueue = dialogQueue.filter(d => d !== dialogo)
  emitUi()
  dialogo.resolve(valor)
}

export function useUiStore(read) {
  const [, force] = useState(0)
  useEffect(() => {
    const fn = () => force(n => n + 1)
    uiListeners.add(fn)
    return () => uiListeners.delete(fn)
  }, [])
  return read()
}

// Con `input` (valor inicial) el diálogo pide un texto: resuelve con lo escrito, o false si se cancela.
export function ask({ title, message, confirmLabel = "Aceptar", cancelLabel = "Cancelar", danger = false, input = null }) {
  return new Promise(resolve => {
    dialogQueue = [...dialogQueue, { title, message, confirmLabel, cancelLabel, danger, input, resolve }]
    emitUi()
  })
}

export function dismissNotice(id) {
  notices = notices.filter(n => n.id !== id)
  emitUi()
}

// sticky: el aviso no se va solo (ej. el código de publicación, que hay que copiar).
export function notify(message, { kind = "info", sticky = false } = {}) {
  const id = ++noticeSeq
  notices = [...notices, { id, message, kind }]
  emitUi()
  if (kind !== "error" && !sticky) setTimeout(() => dismissNotice(id), 5000)
}
