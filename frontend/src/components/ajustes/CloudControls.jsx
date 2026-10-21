import { useState, useEffect, useCallback } from "react"
import { useEscape } from "../../hooks/useEscape.js"
import { API } from "../../lib/api.js"
import { notify } from "../../lib/ui-store.js"
import { C } from "../../theme.js"

export function CloudControls() {
  const [open, setOpen] = useState(false)
  useEscape(open, () => setOpen(false))
  const [cfg, setCfg]   = useState(null)
  const [url, setUrl]   = useState("")
  const [key, setKey]   = useState("")
  const [busy, setBusy] = useState(false)

  const loadCfg = useCallback(() => {
    fetch(API + "/cloud/config").then(r => r.json()).then(d => {
      setCfg(d); setUrl(d.url || "")
    }).catch(() => {})
  }, [])

  useEffect(() => { loadCfg() }, [loadCfg])

  const openModal = () => { loadCfg(); setKey(""); setOpen(true) }

  const save = async () => {
    setBusy(true)
    try {
      const body = { url }
      if (key.trim()) body.api_key = key.trim()  // sólo enviar si se escribió una nueva
      const r = await fetch(API + "/cloud/config", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.detail || "No se pudo guardar")
      setCfg(d); setKey(""); setOpen(false)
    } catch (e) {
      notify("Error: " + e.message, { kind: "error" })
    } finally {
      setBusy(false)
    }
  }

  const btn = {
    width: "100%", padding: "7px 8px", marginBottom: 6, fontSize: 11, fontWeight: 600,
    borderRadius: 6, cursor: "pointer", border: `1px solid ${C.line}`,
    background: C.surface2, color: C.muted, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
  }
  const inp = {
    width: "100%", padding: "8px 10px", marginTop: 4, marginBottom: 12, fontSize: 13,
    borderRadius: 6, border: `1px solid ${C.line}`, background: C.bg, color: C.fg, boxSizing: "border-box",
  }
  const lbl = { fontSize: 11, color: C.muted, fontWeight: 600 }

  return (
    <>
      <button onClick={openModal} style={btn} title="Configurar la conexión al portal público">
        ☁ Portal en la nube {cfg?.configured ? "✓" : ""}
      </button>

      {open && (
        <div onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, background: "#000a", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div role="dialog" aria-modal="true" aria-label="Portal en la nube" onClick={e => e.stopPropagation()}
            style={{ width: 440, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 24, color: C.fg }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Portal en la nube</div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 18 }}>
              Configurá dónde se publican los resultados. La API key se guarda sólo en este equipo.
            </div>

            <div style={lbl}>URL del portal</div>
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://mi-portal.com" style={inp} />

            <div style={lbl}>API key de publicación</div>
            <input value={key} onChange={e => setKey(e.target.value)} type="password"
              placeholder={cfg?.configured ? `Guardada (${cfg.api_key_masked}) — dejá vacío para mantener` : "Pegá la API key (lr_pub_…)"}
              style={inp} />
            {cfg?.key_from_env && (
              <div role="alert" style={{ fontSize: 12, color: C.gold, marginTop: -6, marginBottom: 12 }}>
                La variable de entorno CT_PUBLISH_KEY de este equipo tiene prioridad: la clave que guardes acá no se va a usar hasta que la quites.
              </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <button onClick={() => setOpen(false)} style={{ ...btn, width: "auto", padding: "8px 16px", margin: 0 }}>Cancelar</button>
              <button onClick={save} disabled={busy}
                style={{ ...btn, width: "auto", padding: "8px 16px", margin: 0, background: `${C.accent}20`, color: C.accent, border: `1px solid ${C.accent}40` }}>
                {busy ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
