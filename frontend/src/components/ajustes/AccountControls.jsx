import { useState, useEffect, useRef, useCallback } from "react"
import { Icon } from "../Icon.jsx"
import { useEscape } from "../../hooks/useEscape.js"
import { API } from "../../lib/api.js"
import { C, WITH_ICON } from "../../theme.js"

export function AccountControls() {
  const [me, setMe]       = useState(null)
  const [open, setOpen]   = useState(false)
  const [mode, setMode]   = useState("login")   // login | register
  const [email, setEmail] = useState("")
  const [pw, setPw]       = useState("")
  const [fn, setFn]       = useState("")
  const [err, setErr]     = useState("")
  const [busy, setBusy]   = useState(false)
  const [waiting, setWaiting] = useState(false)  // esperando el login con Google
  useEscape(open && !waiting, () => setOpen(false))
  const pollRef = useRef(null)

  const loadMe = useCallback(() => {
    fetch(API + "/account/me").then(r => r.json()).then(setMe).catch(() => {})
  }, [])
  useEffect(() => { loadMe() }, [loadMe])
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const submit = async () => {
    if (!email.trim() || pw.length < (mode === "register" ? 8 : 1)) {
      setErr(mode === "register" ? "Completá email y una contraseña de 8+ caracteres." : "Completá email y contraseña.")
      return
    }
    setBusy(true); setErr("")
    try {
      const path = mode === "register" ? "/account/register" : "/account/login"
      const body = mode === "register" ? { email, password: pw, full_name: fn.trim() || null } : { email, password: pw }
      const r = await fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.detail || "No se pudo iniciar sesión")
      setMe(d); setOpen(false); setPw(""); setEmail(""); setFn("")
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const googleLogin = async () => {
    setErr(""); setWaiting(true)
    try {
      await fetch(API + "/account/google/start", { method: "POST" })
    } catch { /* el navegador igual puede haberse abierto */ }
    // Polling hasta que el callback loopback guarde la sesión (o el usuario cierre).
    let tries = 0
    pollRef.current = setInterval(async () => {
      tries++
      try {
        const d = await fetch(API + "/account/me").then(r => r.json())
        if (d && d.email) {
          clearInterval(pollRef.current); pollRef.current = null
          setMe(d); setWaiting(false); setOpen(false)
        }
      } catch { /* reintenta */ }
      if (tries > 90) { clearInterval(pollRef.current); pollRef.current = null; setWaiting(false) }  // ~3 min
    }, 2000)
  }

  const logout = async () => {
    await fetch(API + "/account/logout", { method: "POST" }).catch(() => {})
    setMe(null)
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

  if (me && me.email) {
    const name = (me.full_name || me.email).split(" ")[0]
    const initial = (me.full_name || me.email).trim().charAt(0).toUpperCase()
    return (
      <div style={{ ...btn, justifyContent: "space-between", cursor: "default", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, overflow: "hidden" }}>
          <div style={{ width: 22, height: 22, borderRadius: 11, background: C.accent, color: "#000", fontWeight: 800, fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{initial}</div>
          <span style={{ color: C.fg, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
        </div>
        <span onClick={logout} title="Cerrar sesión" style={{ cursor: "pointer", color: C.muted, display: "inline-flex" }}><Icon name="logout" size={14} /></span>
      </div>
    )
  }

  return (
    <>
      <button onClick={() => { setOpen(true); setErr("") }} style={{ ...btn, background: `${C.accent}20`, color: C.accent, border: `1px solid ${C.accent}40`, marginBottom: 8 }}>
        <span style={WITH_ICON}><Icon name="user" size={13} />Iniciar sesión</span>
      </button>

      {open && (
        <div onClick={() => !waiting && setOpen(false)}
          style={{ position: "fixed", inset: 0, background: "#000a", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div role="dialog" aria-modal="true" aria-label="Cuenta" onClick={e => e.stopPropagation()}
            style={{ width: 400, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 24, color: C.fg }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
              {mode === "register" ? "Crear cuenta" : "Iniciar sesión"}
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 18 }}>
              Tu cuenta LiveRun: la misma del portal y la app móvil.
            </div>

            {waiting ? (
              <div style={{ textAlign: "center", padding: "10px 0 4px" }}>
                <div style={{ fontSize: 13, color: C.fg, marginBottom: 8 }}>Abrimos el navegador para que entres con Google…</div>
                <div style={{ fontSize: 12, color: C.muted }}>Cuando termines, esta ventana se cierra sola.</div>
              </div>
            ) : (
              <>
                {err && <div style={{ background: "#e5484d20", color: "#ff8a8a", fontSize: 12, padding: "8px 10px", borderRadius: 6, marginBottom: 12 }}>{err}</div>}
                {mode === "register" && (
                  <input value={fn} onChange={e => setFn(e.target.value)} placeholder="Nombre y apellido" style={inp} />
                )}
                <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="Email" style={inp} />
                <input value={pw} onChange={e => setPw(e.target.value)} type="password"
                  placeholder={mode === "register" ? "Contraseña (mínimo 8)" : "Contraseña"}
                  onKeyDown={e => e.key === "Enter" && submit()} style={inp} />

                <button onClick={submit} disabled={busy}
                  style={{ ...btn, width: "100%", padding: "10px", margin: "0 0 10px", background: C.accent, color: "#000", border: "none", fontSize: 13 }}>
                  {busy ? "Entrando…" : (mode === "register" ? "Crear cuenta" : "Entrar")}
                </button>

                <div style={{ display: "flex", alignItems: "center", gap: 10, color: C.muted, fontSize: 12, margin: "6px 0" }}>
                  <div style={{ flex: 1, height: 1, background: C.line }} /> o <div style={{ flex: 1, height: 1, background: C.line }} />
                </div>

                <button onClick={googleLogin} style={{ ...btn, width: "100%", padding: "10px", margin: "0 0 10px", background: C.bg, color: C.fg, fontSize: 13 }}>
                  Continuar con Google
                </button>

                <div style={{ textAlign: "center", fontSize: 12, color: C.muted }}>
                  {mode === "register"
                    ? <>¿Ya tenés cuenta? <a onClick={() => { setMode("login"); setErr("") }} style={{ color: C.accent, cursor: "pointer" }}>Iniciá sesión</a></>
                    : <>¿Sos nuevo? <a onClick={() => { setMode("register"); setErr("") }} style={{ color: C.accent, cursor: "pointer" }}>Creá tu cuenta</a></>}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
