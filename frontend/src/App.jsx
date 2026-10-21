import { useState, useCallback } from "react"
import { DialogHost, NoticeHost } from "./components/Dialogos.jsx"
import { Icon } from "./components/Icon.jsx"
import { WallClock } from "./components/Relojes.jsx"
import { AccountControls } from "./components/ajustes/AccountControls.jsx"
import { BackupControls } from "./components/ajustes/BackupControls.jsx"
import { CloudControls } from "./components/ajustes/CloudControls.jsx"
import { EmailControls } from "./components/ajustes/EmailControls.jsx"
import { APP_VERSION } from "./lib/version.js"
import { C, FONT_DISPLAY, FONT_NUM } from "./theme.js"
import { AthletesPage } from "./views/AthletesPage.jsx"
import { DashboardPage } from "./views/DashboardPage.jsx"
import { HistorialPage } from "./views/HistorialPage.jsx"
import { RacesPage } from "./views/RacesPage.jsx"

// ═══════════════════════════════════════════════════════════════════════════════
// APP PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

export default function App() {
  const [page, setPage]   = useState("home")
  const [showConfig, setShowConfig] = useState(false)

  // onNavigate: permite al Dashboard navegar a otras secciones; con `race`,
  // entra directo a esa carrera en vez de dejar al operador buscándola.
  const [openRace, setOpenRace] = useState(null)
  const navigate = useCallback((p, race = null) => { setOpenRace(race); setPage(p) }, [])
  // Nombre de la carrera abierta en Carreras, para la barra superior.
  const [openRaceName, setOpenRaceName] = useState(null)
  const onOpenRace = useCallback(r => setOpenRaceName(r?.name ?? null), [])

  const PAGES = [
    { id: "races",    label: "Carreras",  icon: "flag" },
    { id: "athletes", label: "Atletas",   icon: "user" },
    { id: "history",  label: "Historial", icon: "list" },
  ]

  const pageLabel = page === "home" ? "Inicio" : (PAGES.find(p => p.id === page)?.label || "")

  return (
    <div style={{ display: "flex", height: "100vh", background: C.bg, color: C.fg, fontFamily: "var(--font-body)", overflow: "hidden" }}>

      {/* Sidebar */}
      <div style={{ width: 190, background: C.surface, borderRight: `1px solid ${C.line}`, display: "flex", flexDirection: "column", flexShrink: 0 }}>

        {/* Logo — clickeable → Inicio */}
        <button
          onClick={() => navigate("home")} aria-label="LiveRun, ir al inicio"
          style={{ padding: "18px 16px 14px", background: "transparent", border: "none", borderBottom: `1px solid ${C.line}`, cursor: "pointer", userSelect: "none", textAlign: "left", color: C.fg, width: "100%" }}
          onMouseEnter={e => e.currentTarget.style.background = C.surface2}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <img src="/logo.svg" alt="" width={24} height={24} style={{ display: "block", flexShrink: 0 }} />
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 20, letterSpacing: -0.5, color: C.accent }}>LIVE<span style={{ color: C.muted, fontWeight: 500 }}>RUN</span></div>
          </div>
          <div style={{ fontSize: 11, color: C.faint, marginTop: 4 }}>Cronometraje de carreras</div>
        </button>

        <nav style={{ flex: 1, padding: "12px 8px" }}>
          {/* Inicio */}
          <button onClick={() => navigate("home")} aria-current={page === "home" ? "page" : undefined}
            style={{ width: "100%", textAlign: "left", padding: "9px 10px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600, marginBottom: 2, background: page === "home" ? C.surface2 : "transparent", color: page === "home" ? C.fg : C.muted, border: `1px solid ${page === "home" ? C.lineStrong : "transparent"}`, display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="home" /><span>Inicio</span>
          </button>

          <div style={{ height: 1, background: C.line, margin: "8px 4px" }} />

          {PAGES.map(p => (
            <button key={p.id} onClick={() => navigate(p.id)} aria-current={page === p.id ? "page" : undefined}
              style={{ width: "100%", textAlign: "left", padding: "9px 10px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600, marginBottom: 2, background: page === p.id ? C.surface2 : "transparent", color: page === p.id ? C.fg : C.muted, border: `1px solid ${page === p.id ? C.lineStrong : "transparent"}`, display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name={p.icon} />
              <span>{p.label}</span>
            </button>
          ))}
        </nav>

        <div style={{ padding: "12px 12px", borderTop: `1px solid ${C.line}` }}>
          <AccountControls />
          <button
            onClick={() => setShowConfig(v => !v)}
            style={{
              width: "100%", padding: "8px 10px", marginBottom: showConfig ? 8 : 0,
              fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: "pointer",
              border: `1px solid ${showConfig ? `${C.accent}40` : C.line}`,
              background: showConfig ? `${C.accent}20` : C.surface2,
              color: showConfig ? C.accent : C.muted,
              display: "flex", alignItems: "center", gap: 8,
            }}
            title="Nube, email y respaldos">
            <Icon name="settings" /><span>Configuración</span>
            <span style={{ marginLeft: "auto", fontSize: 10 }}><Icon name={showConfig ? "chevronD" : "chevronR"} size={12} /></span>
          </button>
          {showConfig && (
            <div>
              <CloudControls />
              <EmailControls />
              <BackupControls />
            </div>
          )}
          <div style={{ fontSize: 11, color: C.faint, textAlign: "center", marginTop: 8 }}>v{APP_VERSION}</div>
        </div>
      </div>

      {/* Contenido principal */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Top bar — la hora del día es referencia; el dato clave es el
            tiempo de carrera, que vive en el cronómetro. */}
        <div style={{ height: 52, borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", padding: "0 24px", background: C.surface, flexShrink: 0 }}>
          <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 17, letterSpacing: -0.3, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {page === "races" && openRaceName
              ? <><span style={{ color: C.muted }}>{pageLabel} › </span><span style={{ color: C.fg }}>{openRaceName}</span></>
              : pageLabel}
          </span>
          <WallClock style={{ marginLeft: "auto", paddingLeft: 16, flexShrink: 0, ...FONT_NUM, fontSize: 15, fontWeight: 600, color: C.muted }} />
        </div>
        {/* Página activa */}
        <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
          {page === "home"     && <DashboardPage onNavigate={navigate} />}
          {page === "races"    && <RacesPage key={openRace?.id ?? "lista"} openRace={openRace} onOpenRace={onOpenRace} />}
          {page === "athletes" && <AthletesPage />}
          {page === "history"  && <HistorialPage />}
        </div>
      </div>
      <DialogHost />
      <NoticeHost />
    </div>
  )
}
