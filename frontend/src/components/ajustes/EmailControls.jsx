import { useState, useEffect, useCallback } from "react"
import { useEscape } from "../../hooks/useEscape.js"
import { API } from "../../lib/api.js"
import { notify } from "../../lib/ui-store.js"
import { C } from "../../theme.js"

export function EmailControls() {
  const [open, setOpen]   = useState(false)
  useEscape(open, () => setOpen(false))
  const [cfg, setCfg]     = useState(null)
  const [fromEmail, setFromEmail] = useState("")
  const [fromName, setFromName]   = useState("LiveRun")
  const [key, setKey]     = useState("")
  const [busy, setBusy]   = useState(false)
  const [testTo, setTestTo] = useState("")

  const loadCfg = useCallback(() => {
    fetch(API + "/email/config").then(r => r.json()).then(d => {
      setCfg(d); setFromEmail(d.from_email || ""); setFromName(d.from_name || "LiveRun")
    }).catch(() => {})
  }, [])
  useEffect(() => { loadCfg() }, [loadCfg])

  const openModal = () => { loadCfg(); setKey(""); setTestTo(""); setOpen(true) }

  const save = async () => {
    setBusy(true)
    try {
      const body = { provider: "brevo", from_email: fromEmail, from_name: fromName }
      if (key.trim()) body.api_key = key.trim()
      const r = await fetch(API + "/email/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.detail || "No se pudo guardar")
      setCfg(d); setKey("")
    } catch (e) { notify("Error: " + e.message, { kind: "error" }) } finally { setBusy(false) }
  }

  const sendTest = async () => {
    if (!testTo.trim()) { notify("Ingresá un email para la prueba.", { kind: "error" }); return }
    setBusy(true)
    try {
      const r = await fetch(API + "/email/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: testTo.trim() }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.detail || "Error")
      notify("Email de prueba enviado a " + testTo.trim(), { kind: "success" })
    } catch (e) { notify("No se pudo enviar la prueba: " + e.message, { kind: "error" }) } finally { setBusy(false) }
  }

  const btn = { width: "100%", padding: "7px 8px", marginBottom: 6, fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: "pointer", border: `1px solid ${C.line}`, background: C.surface2, color: C.muted, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }
  const inp = { width: "100%", padding: "8px 10px", marginTop: 4, marginBottom: 12, fontSize: 13, borderRadius: 6, border: `1px solid ${C.line}`, background: C.bg, color: C.fg, boxSizing: "border-box" }
  const lbl = { fontSize: 11, color: C.muted, fontWeight: 600 }

  return (
    <>
      <button onClick={openModal} style={btn} title="Configurar el envío de emails de resultados">
        📧 Emails {cfg?.configured ? "✓" : ""}
      </button>
      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "#000a", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div role="dialog" aria-modal="true" aria-label="Envío de emails" onClick={e => e.stopPropagation()} style={{ width: 460, maxHeight: "90vh", overflowY: "auto", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 24, color: C.fg }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Envío de emails (Brevo)</div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 16, lineHeight: 1.5 }}>
              Creá una cuenta gratis en <span style={{ color: C.blue }}>brevo.com</span>, verificá tu email remitente y pegá tu API key (Settings → SMTP &amp; API → API Keys). 300 emails/día gratis.
            </div>
            <div style={lbl}>Nombre del remitente</div>
            <input value={fromName} onChange={e => setFromName(e.target.value)} placeholder="Mi Club / Organización" style={inp} />
            <div style={lbl}>Email remitente (verificado en Brevo)</div>
            <input value={fromEmail} onChange={e => setFromEmail(e.target.value)} placeholder="resultados@miclub.com" style={inp} type="email" />
            <div style={lbl}>API key de Brevo</div>
            <input value={key} onChange={e => setKey(e.target.value)} type="password" placeholder={cfg?.configured ? `Guardada (${cfg.api_key_masked}) — dejá vacío para mantener` : "xkeysib-..."} style={inp} />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setOpen(false)} style={{ ...btn, width: "auto", padding: "8px 16px", margin: 0 }}>Cerrar</button>
              <button onClick={save} disabled={busy} style={{ ...btn, width: "auto", padding: "8px 16px", margin: 0, background: `${C.accent}20`, color: C.accent, border: `1px solid ${C.accent}40` }}>{busy ? "Guardando…" : "Guardar"}</button>
            </div>
            <div style={{ borderTop: `1px solid ${C.line}`, margin: "16px 0 12px" }} />
            <div style={lbl}>Probar envío</div>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <input value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="tu@email.com" style={{ ...inp, marginBottom: 0, flex: 1 }} type="email" />
              <button onClick={sendTest} disabled={busy} style={{ ...btn, width: "auto", padding: "8px 16px", margin: 0 }}>Enviar prueba</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
