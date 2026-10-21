import { useState, useRef } from "react"
import { API } from "../../lib/api.js"
import { ask, notify } from "../../lib/ui-store.js"
import { C } from "../../theme.js"

export function BackupControls() {
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)

  const doBackup = () => {
    window.open(API + "/backup", "_blank")
  }

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ""  // permitir re-seleccionar el mismo archivo
    if (!file) return
    if (!(await ask({ title: "Restaurar respaldo", confirmLabel: "Restaurar", danger: true, message: `¿Restaurar desde "${file.name}"?\n\nEsto reemplaza TODOS los datos actuales. Se guardará una copia de seguridad del estado actual antes de reemplazar.` }))) return
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch(API + "/restore", { method: "POST", body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || "No se pudo restaurar")
      notify((data.message || "Respaldo restaurado.") + "\n\nLa aplicación se recargará.", { kind: "success" })
      // Un respiro para que se lea el aviso antes de que la recarga lo borre
      setTimeout(() => window.location.reload(), 2500)
    } catch (err) {
      notify("Error al restaurar: " + err.message, { kind: "error" })
    } finally {
      setBusy(false)
    }
  }

  const btn = {
    width: "100%", padding: "7px 8px", marginBottom: 6, fontSize: 11, fontWeight: 600,
    borderRadius: 6, cursor: busy ? "wait" : "pointer", border: `1px solid ${C.line}`,
    background: C.surface2, color: C.muted, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <button onClick={doBackup} disabled={busy} style={btn} title="Descargar copia de seguridad de todos los datos">
        💾 Crear respaldo
      </button>
      <button onClick={() => fileRef.current?.click()} disabled={busy} style={btn} title="Restaurar datos desde un archivo .ctbackup">
        {busy ? "Restaurando…" : "↩ Restaurar respaldo"}
      </button>
      <input ref={fileRef} type="file" accept=".ctbackup,.db" onChange={onFile} style={{ display: "none" }} />
    </div>
  )
}
