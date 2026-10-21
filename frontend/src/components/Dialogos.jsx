import { useEffect, useRef, useCallback } from "react"
import { Icon } from "./Icon.jsx"
import { useEscape } from "../hooks/useEscape.js"
import { avisosActuales, cerrarDialogo, dialogoActual, dismissNotice, useUiStore } from "../lib/ui-store.js"
import { BTN_GHOST, BTN_PRIMARY, C, CARD, FONT_DISPLAY, FONT_NUM, INPUT } from "../theme.js"

export function DialogHost() {
  const current = useUiStore(dialogoActual)
  const cancelRef = useRef(null)
  const inputRef = useRef(null)
  const boxRef = useRef(null)
  const prevFocus = useRef(null)

  const close = useCallback((value) => {
    if (!current) return
    cerrarDialogo(current, value)
  }, [current])

  useEscape(!!current, () => close(false))

  // Foco inicial en el campo de texto o, si no hay, en Cancelar; al cerrar vuelve a quien lo tenía.
  useEffect(() => {
    if (!current) return
    prevFocus.current = document.activeElement
    if (inputRef.current) inputRef.current.select()
    else cancelRef.current?.focus()
    return () => {
      const el = prevFocus.current
      if (el && el.isConnected) el.focus()
    }
  }, [current])

  // Tab cicla dentro del diálogo. Va en window porque ESPACIO en el cronómetro
  // le hace blur al botón enfocado y el foco queda en body, fuera de la caja.
  useEffect(() => {
    if (!current) return
    const h = (e) => {
      if (e.key !== "Tab" || !boxRef.current) return
      const btns = boxRef.current.querySelectorAll("input, button")
      const first = btns[0], last = btns[btns.length - 1]
      const act = document.activeElement
      if (!boxRef.current.contains(act)) { e.preventDefault(); (e.shiftKey ? last : first).focus() }
      else if (e.shiftKey && act === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && act === last) { e.preventDefault(); first.focus() }
    }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [current])

  if (!current) return null

  return (
    <div onClick={() => close(false)}
      style={{ position: "fixed", inset: 0, background: "#000a", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 }}>
      <div ref={boxRef} role="dialog" aria-modal="true" aria-labelledby="dialog-title"
        onClick={e => e.stopPropagation()}
        style={{ ...CARD, width: 440, maxWidth: "90vw", maxHeight: "85vh", overflow: "auto", borderColor: C.lineStrong }}>
        <div id="dialog-title" style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 17, marginBottom: 10 }}>{current.title}</div>
        <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.5, whiteSpace: "pre-line", marginBottom: 20 }}>{current.message}</div>
        {current.input != null && (
          <input ref={inputRef} key={current.title} defaultValue={current.input} aria-label={current.title} autoComplete="off"
            // preventDefault: si no, el mismo Enter activa el botón que recibe el foco en el diálogo siguiente.
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); close(e.currentTarget.value) } }}
            style={{ ...INPUT, ...FONT_NUM, fontFamily: "monospace", fontSize: 18, marginBottom: 20 }} />
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button ref={cancelRef} onClick={() => close(false)} style={BTN_GHOST}>{current.cancelLabel}</button>
          <button onClick={() => close(current.input != null ? inputRef.current?.value ?? "" : true)}
            style={current.danger ? { ...BTN_PRIMARY, background: C.danger, color: C.bg } : BTN_PRIMARY}>
            {current.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function NoticeHost() {
  const list = useUiStore(avisosActuales)
  if (list.length === 0) return null
  return (
    <div style={{ position: "fixed", right: 20, bottom: 20, zIndex: 1900, display: "flex", flexDirection: "column", gap: 8, width: 360, maxWidth: "90vw" }}>
      {list.map(n => {
        const isError = n.kind === "error"
        const isOk = n.kind === "success"
        return (
          <div key={n.id} role={isError ? "alert" : "status"}
            style={{ ...CARD, padding: "12px 12px 12px 14px", display: "flex", alignItems: "flex-start", gap: 10, background: C.surface2, borderColor: isError ? C.danger : C.lineStrong }}>
            {(isError || isOk) && (
              <span style={{ color: isError ? C.danger : C.accent, marginTop: 1, flexShrink: 0, display: "inline-flex" }}>
                <Icon name={isError ? "alert" : "check"} size={16} />
              </span>
            )}
            <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-line", color: C.fg, minWidth: 0, overflowWrap: "anywhere", userSelect: "text" }}>{n.message}</div>
            <button onClick={() => dismissNotice(n.id)} aria-label="Cerrar aviso"
              style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", padding: 2, display: "inline-flex", flexShrink: 0 }}>
              <Icon name="x" size={16} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
