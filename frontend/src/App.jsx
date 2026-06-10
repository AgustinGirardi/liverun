import { useState, useEffect, useRef, useCallback } from "react"

const API = "/api/v1"

function getWsBase() {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${proto}//${window.location.host}/api/v1`
}

// ── Utilidades ────────────────────────────────────────────────────────────────

function pad(n, l = 2) { return String(n).padStart(l, "0") }

function formatNs(ns) {
  if (!ns && ns !== 0) return "--:--:--.---"
  const ms = Number(BigInt(ns) / 1000000n)
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const f = ms % 1000
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(f, 3)}`
}

// ── Certificado PDF ───────────────────────────────────────────────────────────

function printCertificate({ race, runner, bib_number, position, net_time_ns, category, club, dni, distance_km }) {
  const time = formatNs(net_time_ns)
  const genderLabel = { M: "Masculino", F: "Femenino", X: "Otro" }[runner.gender] || "--"
  const date = race.race_date
    ? new Date(race.race_date + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })
    : null
  const generated = new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Certificado — ${runner.full_name}</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 210mm; height: 297mm; background: #fff; font-family: Arial, Helvetica, sans-serif; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  .page { width: 210mm; min-height: 297mm; display: flex; flex-direction: column; }

  /* ── Header ── */
  .header { background: #0d0f10; padding: 22px 36px; display: flex; align-items: center; justify-content: space-between; }
  .logo-text { font-size: 28px; font-weight: 900; letter-spacing: -1px; color: #00e5a0; line-height: 1; }
  .logo-text span { color: #6b7280; font-weight: 300; }
  .logo-sub { font-size: 9px; letter-spacing: 3px; text-transform: uppercase; color: #4b5563; margin-top: 3px; }
  .header-right { text-align: right; }
  .header-badge { background: #00e5a015; border: 1px solid #00e5a030; border-radius: 20px; padding: 4px 14px; font-size: 11px; color: #00e5a0; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; }

  /* ── Green stripe ── */
  .stripe { height: 4px; background: linear-gradient(90deg, #00e5a0 0%, #00bfff 50%, #00e5a0 100%); }

  /* ── Body ── */
  .body { flex: 1; padding: 36px 44px 28px; display: flex; flex-direction: column; gap: 0; }

  /* ── Title section ── */
  .cert-label { font-size: 10px; letter-spacing: 4px; text-transform: uppercase; color: #9ca3af; margin-bottom: 6px; }
  .cert-title { font-size: 26px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; color: #111; line-height: 1.1; }
  .cert-sub { font-size: 12px; color: #6b7280; margin-top: 6px; }
  .divider { height: 1px; background: #e5e7eb; margin: 20px 0; }
  .divider-accent { height: 2px; background: linear-gradient(90deg, #00e5a0, transparent); margin: 0; }

  /* ── Race card ── */
  .race-card { background: #f9fafb; border: 1px solid #e5e7eb; border-left: 4px solid #00e5a0; border-radius: 6px; padding: 16px 20px; margin: 20px 0; }
  .race-name { font-size: 18px; font-weight: 800; color: #111; margin-bottom: 8px; }
  .race-meta { display: flex; gap: 20px; flex-wrap: wrap; }
  .race-meta-item { display: flex; align-items: center; gap: 5px; font-size: 12px; color: #6b7280; }
  .meta-icon { font-size: 13px; }

  /* ── Runner name ── */
  .runner-section { margin: 8px 0 20px; }
  .runner-label { font-size: 10px; letter-spacing: 3px; text-transform: uppercase; color: #9ca3af; margin-bottom: 6px; }
  .runner-name { font-size: 38px; font-weight: 900; color: #111; line-height: 1; letter-spacing: -1px; }
  .runner-tagline { font-size: 13px; color: #6b7280; margin-top: 6px; font-style: italic; }

  /* ── Key stats ── */
  .stats-row { display: grid; grid-template-columns: 1fr 1fr 2fr; gap: 10px; margin: 20px 0; }
  .stat-box { background: #0d0f10; border-radius: 8px; padding: 16px 20px; text-align: center; }
  .stat-box.accent { background: #00e5a0; }
  .stat-label { font-size: 9px; letter-spacing: 2px; text-transform: uppercase; color: #6b7280; margin-bottom: 6px; }
  .stat-box.accent .stat-label { color: #004d38; }
  .stat-value { font-size: 28px; font-weight: 900; color: #00e5a0; font-family: "Courier New", monospace; line-height: 1; }
  .stat-box.accent .stat-value { color: #002a20; font-size: 22px; }
  .stat-value.mono { font-size: 32px; letter-spacing: 1px; }

  /* ── Details grid ── */
  .details-section { margin-top: 20px; }
  .details-title { font-size: 9px; letter-spacing: 3px; text-transform: uppercase; color: #9ca3af; margin-bottom: 10px; }
  .details-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; }
  .detail-cell { padding: 12px 16px; border-right: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; }
  .detail-cell:nth-child(3n) { border-right: none; }
  .detail-cell:last-child, .detail-cell:nth-last-child(2), .detail-cell:nth-last-child(3) { border-bottom: none; }
  .detail-key { font-size: 9px; letter-spacing: 2px; text-transform: uppercase; color: #9ca3af; margin-bottom: 4px; }
  .detail-val { font-size: 14px; font-weight: 700; color: #111; }

  /* ── Footer ── */
  .footer { padding: 16px 44px; background: #f9fafb; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; }
  .footer-logo { font-size: 13px; font-weight: 800; color: #00e5a0; letter-spacing: -0.5px; }
  .footer-logo span { color: #9ca3af; font-weight: 400; }
  .footer-info { font-size: 10px; color: #9ca3af; text-align: right; line-height: 1.6; }

  @media print {
    html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div>
      <div class="logo-text">CHRONO<span>TRACK</span></div>
      <div class="logo-sub">Race Timing System</div>
    </div>
    <div class="header-right">
      <div class="header-badge">Certificado de Resultado</div>
    </div>
  </div>
  <div class="stripe"></div>

  <!-- Body -->
  <div class="body">

    <!-- Title -->
    <div class="cert-label">Resultado oficial</div>
    <div class="cert-title">Certificado de<br>Participación</div>
    <div class="cert-sub">Este documento certifica los tiempos y resultados oficiales registrados.</div>

    <!-- Race -->
    <div class="race-card">
      <div class="race-name">${escapeHtml(race.name)}</div>
      <div class="race-meta">
        ${distance_km ? `<div class="race-meta-item"><span class="meta-icon">📏</span><span>${distance_km} km</span></div>` : ""}
        ${date ? `<div class="race-meta-item"><span class="meta-icon">📅</span><span>${date}</span></div>` : ""}
        ${race.location ? `<div class="race-meta-item"><span class="meta-icon">📍</span><span>${escapeHtml(race.location)}</span></div>` : ""}
      </div>
    </div>

    <!-- Runner name -->
    <div class="runner-section">
      <div class="runner-label">Atleta</div>
      <div class="runner-name">${escapeHtml(runner.full_name)}</div>
      <div class="runner-tagline">ha completado satisfactoriamente la prueba</div>
    </div>

    <div class="divider-accent"></div>

    <!-- Key stats -->
    <div class="stats-row">
      <div class="stat-box">
        <div class="stat-label">Dorsal</div>
        <div class="stat-value">${escapeHtml(String(bib_number))}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Posición</div>
        <div class="stat-value">${position ? position + "°" : "—"}</div>
      </div>
      <div class="stat-box accent">
        <div class="stat-label">Tiempo neto</div>
        <div class="stat-value mono">${time}</div>
      </div>
    </div>

    <!-- Details -->
    <div class="details-section">
      <div class="details-title">Datos del atleta</div>
      <div class="details-grid">
        <div class="detail-cell">
          <div class="detail-key">Nombre</div>
          <div class="detail-val">${escapeHtml(runner.first_name)}</div>
        </div>
        <div class="detail-cell">
          <div class="detail-key">Apellido</div>
          <div class="detail-val">${escapeHtml(runner.last_name)}</div>
        </div>
        <div class="detail-cell">
          <div class="detail-key">Categoría</div>
          <div class="detail-val">${escapeHtml(category || "—")}</div>
        </div>
        <div class="detail-cell">
          <div class="detail-key">DNI</div>
          <div class="detail-val">${escapeHtml(dni || "—")}</div>
        </div>
        <div class="detail-cell">
          <div class="detail-key">Club / Equipo</div>
          <div class="detail-val">${escapeHtml(club || "—")}</div>
        </div>
        <div class="detail-cell">
          <div class="detail-key">Género</div>
          <div class="detail-val">${genderLabel}</div>
        </div>
        <div class="detail-cell">
          <div class="detail-key">Estado</div>
          <div class="detail-val" style="color:#00a070;">✓ Finisher</div>
        </div>
      </div>
    </div>

  </div>

  <!-- Footer -->
  <div class="footer">
    <div>
      <div class="footer-logo">CHRONO<span>TRACK</span></div>
      <div style="font-size:9px;color:#9ca3af;margin-top:2px;letter-spacing:1px">RACE TIMING SYSTEM · v2.0.0</div>
    </div>
    <div class="footer-info">
      Generado el ${generated}<br>
      Documento oficial de resultado
    </div>
  </div>

</div>

</body>
</html>`

  printHtml(html)
}

// Imprime HTML en un iframe oculto dentro de la misma ventana — sin popups
function printHtml(html) {
  const prev = document.getElementById("__ct_print_frame")
  if (prev) prev.remove()

  const frame = document.createElement("iframe")
  frame.id = "__ct_print_frame"
  frame.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:210mm;height:297mm;border:none;visibility:hidden"
  document.body.appendChild(frame)

  frame.contentDocument.open()
  frame.contentDocument.write(html)
  frame.contentDocument.close()

  // Esperamos a que el iframe cargue sus estilos antes de imprimir
  frame.onload = () => {
    frame.contentWindow.focus()
    frame.contentWindow.print()
    setTimeout(() => frame.remove(), 2000)
  }
}

// ── Reporte PDF de resultados ─────────────────────────────────────────────────

function printResultsReport({ race, results }) {
  const fmt = (ns) => (ns ? formatNs(ns) : "—")
  const date = race.race_date
    ? new Date(race.race_date + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })
    : null
  const generated = new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })

  // Agrupar por distancia (cada distancia tiene su propia clasificación)
  const rows = results.results || []
  const byDist = {}
  rows.forEach(r => {
    const key = r.distance_km != null ? String(r.distance_km) : "__none__"
    if (!byDist[key]) byDist[key] = []
    byDist[key].push(r)
  })
  const distKeys = Object.keys(byDist).sort((a, b) => {
    if (a === "__none__") return 1
    if (b === "__none__") return -1
    return parseFloat(a) - parseFloat(b)
  })

  const tableFor = (list) => `
    <table class="results">
      <thead>
        <tr>
          <th class="c-pos">Pos.</th>
          <th class="c-bib">Dorsal</th>
          <th>Nombre</th>
          <th>Categoría</th>
          <th>Club</th>
          <th class="c-time">Tiempo Neto</th>
        </tr>
      </thead>
      <tbody>
        ${list.map((r, i) => `
          <tr>
            <td class="c-pos ${i < 3 ? "medal m" + i : ""}">${i + 1}</td>
            <td class="c-bib">${escapeHtml(String(r.bib_number))}</td>
            <td class="c-name">${escapeHtml(r.runner.full_name)}</td>
            <td>${escapeHtml(r.category || "—")}</td>
            <td>${escapeHtml(r.club || "—")}</td>
            <td class="c-time">${fmt(r.net_time_ns || r.finish_time_ns)}</td>
          </tr>`).join("")}
      </tbody>
    </table>`

  const distSections = distKeys.map(key => {
    const list = [...byDist[key]].sort((a, b) =>
      (a.net_time_ns || a.finish_time_ns) - (b.net_time_ns || b.finish_time_ns))
    const label = key === "__none__" ? "Clasificación general" : `${key} km`
    return `<div class="dist-block">
      <div class="dist-title">${escapeHtml(label)} <span class="dist-count">${list.length} finishers</span></div>
      ${tableFor(list)}
    </div>`
  }).join("")

  const dnfSection = (results.dnf_list && results.dnf_list.length) ? `
    <div class="dist-block">
      <div class="dist-title dnf">No finalizaron <span class="dist-count">${results.dnf_list.length}</span></div>
      <table class="results">
        <thead><tr><th class="c-bib">Dorsal</th><th>Nombre</th><th>Categoría</th><th>Club</th><th>Estado</th></tr></thead>
        <tbody>
          ${results.dnf_list.map(d => `
            <tr>
              <td class="c-bib">${escapeHtml(String(d.bib_number))}</td>
              <td class="c-name">${escapeHtml(d.runner.full_name)}</td>
              <td>${escapeHtml(d.category || "—")}</td>
              <td>${escapeHtml(d.club || "—")}</td>
              <td class="status">${escapeHtml(d.status)}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>` : ""

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Resultados — ${escapeHtml(race.name)}</title>
<style>
  @page { size: A4 portrait; margin: 14mm 12mm; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  .header { display: flex; align-items: flex-end; justify-content: space-between; border-bottom: 3px solid #0d0f10; padding-bottom: 12px; margin-bottom: 4px; }
  .logo-text { font-size: 22px; font-weight: 900; letter-spacing: -1px; color: #0d0f10; }
  .logo-text span { color: #00b97f; }
  .head-right { text-align: right; font-size: 11px; color: #6b7280; }
  .stripe { height: 3px; background: linear-gradient(90deg, #00e5a0, #00bfff); margin-bottom: 18px; }

  .race-title { font-size: 20px; font-weight: 900; color: #111; margin-bottom: 4px; }
  .race-meta { font-size: 12px; color: #6b7280; margin-bottom: 16px; }

  .summary { display: flex; gap: 10px; margin-bottom: 20px; }
  .sum-box { flex: 1; background: #f4f6f7; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 14px; }
  .sum-val { font-size: 22px; font-weight: 900; color: #00a070; }
  .sum-lbl { font-size: 9px; letter-spacing: 1px; text-transform: uppercase; color: #9ca3af; }

  .dist-block { margin-bottom: 22px; page-break-inside: auto; }
  .dist-title { font-size: 14px; font-weight: 800; color: #0d0f10; padding: 6px 0; border-bottom: 2px solid #00e5a0; margin-bottom: 8px; }
  .dist-title.dnf { border-bottom-color: #f5a623; }
  .dist-count { font-size: 11px; font-weight: 600; color: #9ca3af; }

  table.results { width: 100%; border-collapse: collapse; font-size: 11px; }
  table.results th { text-align: left; padding: 6px 8px; font-size: 9px; letter-spacing: 1px; text-transform: uppercase; color: #6b7280; border-bottom: 1px solid #d1d5db; }
  table.results td { padding: 5px 8px; border-bottom: 1px solid #eef0f1; }
  tr { page-break-inside: avoid; }
  .c-pos { width: 36px; text-align: center; font-weight: 700; color: #6b7280; }
  .c-bib { width: 52px; font-family: "Courier New", monospace; color: #374151; }
  .c-name { font-weight: 600; }
  .c-time { text-align: right; font-family: "Courier New", monospace; font-weight: 700; color: #00805a; white-space: nowrap; }
  .medal { color: #fff !important; border-radius: 3px; }
  .medal.m0 { background: #d4af37; }
  .medal.m1 { background: #9ca3af; }
  .medal.m2 { background: #cd7c4a; }
  .status { font-weight: 700; color: #b45309; }

  .footer { margin-top: 18px; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 9px; color: #9ca3af; display: flex; justify-content: space-between; }
</style>
</head>
<body>
  <div class="header">
    <div class="logo-text">CHRONO<span>TRACK</span></div>
    <div class="head-right">Reporte de resultados<br>Generado el ${generated}</div>
  </div>
  <div class="stripe"></div>

  <div class="race-title">${escapeHtml(race.name)}</div>
  <div class="race-meta">${[date, race.location].filter(Boolean).map(escapeHtml).join(" · ") || "&nbsp;"}</div>

  <div class="summary">
    <div class="sum-box"><div class="sum-val">${results.total_finishers}</div><div class="sum-lbl">Finishers</div></div>
    <div class="sum-box"><div class="sum-val" style="color:#111">${results.total_registered}</div><div class="sum-lbl">Inscriptos</div></div>
    <div class="sum-box"><div class="sum-val" style="color:#b45309">${results.dnf_list ? results.dnf_list.length : 0}</div><div class="sum-lbl">DNS / DNF / DQ</div></div>
  </div>

  ${distSections}
  ${dnfSection}

  <div class="footer">
    <span>ChronoTrack · Race Timing System</span>
    <span>Resultados oficiales</span>
  </div>
</body>
</html>`

  printHtml(html)
}

function escapeHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")
}

function calcAge(birthDate) {
  if (!birthDate) return null
  const today = new Date()
  const birth = new Date(birthDate + "T12:00:00")
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age
}

function autoCategory(birthDate, gender) {
  if (!birthDate || !gender || gender === "X") return ""
  const age = calcAge(birthDate)
  if (age === null) return ""
  const p = gender === "F" ? "F" : "M"
  if (age < 18)  return `${p}-Sub18`
  if (age <= 24) return `${p}18-24`
  if (age <= 29) return `${p}25-29`
  if (age <= 34) return `${p}30-34`
  if (age <= 39) return `${p}35-39`
  if (age <= 44) return `${p}40-44`
  if (age <= 49) return `${p}45-49`
  if (age <= 54) return `${p}50-54`
  if (age <= 59) return `${p}55-59`
  return `${p}60+`
}

// ── Estilos compartidos ───────────────────────────────────────────────────────

// Degradado sobrio mint→teal — acento de marca del operador (títulos + acciones principales).
const OP_GRAD = "linear-gradient(110deg, #00bf85, #00e5a0)"
const INPUT = {
  background: "#1c1f21", border: "1px solid #363b3f", borderRadius: 6,
  padding: "7px 10px", color: "#e8eaeb", fontSize: 13, outline: "none", width: "100%",
}
const BTN_PRIMARY = {
  padding: "6px 16px", background: OP_GRAD, border: "none",
  borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 12, color: "#000",
}
const BTN_GHOST = {
  padding: "6px 12px", background: "transparent", border: "1px solid #363b3f",
  borderRadius: 6, cursor: "pointer", color: "#8a9299", fontSize: 12,
}
const BTN_DANGER = {
  padding: "4px 8px", background: "transparent", border: "1px solid #2a2e31",
  borderRadius: 4, cursor: "pointer", color: "#ff4d4d", fontSize: 11,
}
const CARD = {
  background: "#141618", border: "1px solid #2a2e31", borderRadius: 8, padding: 16,
}

// Acento de marca: degradado mint→teal clippeado a texto, para una palabra/frase de un título.
function OpGrad({ children }) {
  return <span style={{ background: OP_GRAD, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{children}</span>
}

// ── StatusBadge ───────────────────────────────────────────────────────────────

const RACE_STATUS = {
  PLANNED:  { bg: "#4d9fff15", color: "#4d9fff", border: "#4d9fff30", label: "En preparación" },
  ACTIVE:   { bg: "#00e5a015", color: "#00e5a0", border: "#00e5a030", label: "En curso" },
  FINISHED: { bg: "#f5a62315", color: "#f5a623", border: "#f5a62330", label: "Finalizada" },
}
const REG_STATUS = {
  OK:  { color: "#525a60",  label: "OK" },
  DNS: { color: "#8a9299",  label: "DNS" },
  DNF: { color: "#f5a623",  label: "DNF" },
  DQ:  { color: "#ff4d4d",  label: "DQ" },
}

function RaceStatusBadge({ status }) {
  const s = RACE_STATUS[status] || RACE_STATUS.PLANNED
  return (
    <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 600 }}>
      {s.label}
    </span>
  )
}

function RegStatusBadge({ status }) {
  const s = REG_STATUS[status] || REG_STATUS.OK
  if (status === "OK") return null
  return (
    <span style={{ background: s.color + "20", color: s.color, border: `1px solid ${s.color}40`, borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>
      {s.label}
    </span>
  )
}

// ── useTimingEngine ── WebSocket con reconexión + carga persistente ────────────

function useTimingEngine(raceId) {
  const [queue, setQueue]         = useState([])
  const [finishers, setFinishers] = useState([])
  const [connected, setConnected] = useState(false)
  const wsRef     = useRef(null)
  const timerRef  = useRef(null)
  const activeRef = useRef(true)

  useEffect(() => {
    if (!raceId) return
    fetch(API + "/races/" + raceId + "/captures?status=PENDING")
      .then(r => r.json())
      .then(caps => setQueue(
        caps.map(c => ({ id: c.id, captured_ns: c.captured_ns, sequence_order: c.sequence_order }))
      ))
      .catch(() => {})
    fetch(API + "/races/" + raceId + "/results")
      .then(r => r.json())
      .then(data => setFinishers(
        (data.results || []).map(r => ({
          capture_id: null,
          bib_number: r.bib_number,
          runner: r.runner,
          capture_ns: r.finish_time_ns,
          net_time_ns: r.net_time_ns,
          position: r.position,
        }))
      ))
      .catch(() => {})
  }, [raceId])

  const connect = useCallback(() => {
    if (!raceId || !activeRef.current) return
    const ws = new WebSocket(getWsBase() + "/ws/races/" + raceId + "/timing")
    wsRef.current = ws
    ws.onopen  = () => { if (activeRef.current) setConnected(true) }
    ws.onerror = () => ws.close()
    ws.onclose = () => {
      if (!activeRef.current) return
      setConnected(false)
      timerRef.current = setTimeout(connect, 3000)
    }
    ws.onmessage = (evt) => {
      const { event, data } = JSON.parse(evt.data)
      if (event === "CAPTURE" && data.type !== "START") {
        setQueue(prev => {
          if (prev.some(i => i.id === data.id)) return prev
          return [{ id: data.id, captured_ns: data.captured_ns, sequence_order: data.sequence_order }, ...prev]
        })
      } else if (event === "ASSIGNED") {
        setQueue(prev => prev.filter(i => i.id !== data.capture_id))
        setFinishers(prev => {
          const updated = prev.filter(f => f.capture_id !== data.capture_id)
          return [...updated, {
            capture_id: data.capture_id,
            bib_number: data.bib_number,
            runner: data.runner,
            capture_ns: data.capture_ns,
            net_time_ns: data.net_time_ns,
            position: data.position,
          }].sort((a, b) => a.capture_ns - b.capture_ns)
        })
      } else if (event === "UNASSIGNED") {
        setFinishers(prev => prev.filter(f => f.capture_id !== data.capture_id))
        setQueue(prev => {
          if (prev.some(i => i.id === data.capture_id)) return prev
          return [{ id: data.capture_id, captured_ns: data.captured_ns, sequence_order: data.sequence_order }, ...prev]
        })
      } else if (event === "DISCARDED") {
        setQueue(prev => prev.filter(i => i.id !== data.capture_id))
      }
    }
  }, [raceId])

  useEffect(() => {
    activeRef.current = true
    connect()
    return () => {
      activeRef.current = false
      clearTimeout(timerRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  const send = useCallback((msg) => {
    if (wsRef.current?.readyState === 1) wsRef.current.send(JSON.stringify(msg))
  }, [])

  const capture    = useCallback(() => send({ action: "capture" }), [send])
  const assignBib  = useCallback((id, bib) => send({ action: "assign", capture_id: id, bib }), [send])
  const undoAssign = useCallback((captureId) => send({ action: "undo_assign", capture_id: captureId }), [send])
  const discard    = useCallback((id) => send({ action: "discard", capture_id: id }), [send])
  const bibLookup  = useCallback(async (bib) => {
    if (!bib || !raceId) return null
    try {
      const r = await fetch(API + "/races/" + raceId + "/bib-lookup?bib=" + encodeURIComponent(bib))
      return await r.json()
    } catch { return null }
  }, [raceId])

  return { queue, finishers, connected, capture, assignBib, undoAssign, discard, bibLookup }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INSCRIPTOS VIEW (inscripciones de una carrera específica)
// ═══════════════════════════════════════════════════════════════════════════════

function InscriptosView({ race }) {
  const raceId = race?.id
  const [registrations, setRegistrations] = useState([])
  const [showAdd, setShowAdd]     = useState(false)
  const [addMode, setAddMode]     = useState("search")  // "search" | "new"
  const [showImport, setShowImport] = useState(false)
  const [search, setSearch]       = useState("")
  const [selected, setSelected]   = useState(new Set())   // IDs seleccionados
  const [bulkDeleting, setBulkDeleting] = useState(false)

  // Buscar corredor existente
  const [runnerQuery, setRunnerQuery]     = useState("")
  const [runnerResults, setRunnerResults] = useState([])
  const [selectedRunner, setSelectedRunner] = useState(null)
  const [bibForExisting, setBibForExisting] = useState("")
  const [distForExisting, setDistForExisting] = useState("")
  const [addError, setAddError]           = useState("")
  const [saving, setSaving]               = useState(false)

  // Formulario nuevo corredor
  const [newForm, setNewForm] = useState({ first_name: "", last_name: "", email: "", dni: "", birth_date: "", category: "", club: "", bib_number: "", gender: "M", distance_km: "" })

  // Import
  const [importFile, setImportFile]     = useState(null)
  const [importResult, setImportResult] = useState(null)
  const [importing, setImporting]       = useState(false)

  const load = useCallback(() => {
    if (!raceId) return
    fetch(API + "/races/" + raceId + "/registrations")
      .then(r => r.json()).then(data => { setRegistrations(data); setSelected(new Set()) }).catch(() => {})
  }, [raceId])

  useEffect(() => { load() }, [load])

  // Búsqueda debounced de corredores existentes
  useEffect(() => {
    if (!runnerQuery || runnerQuery.length < 2) { setRunnerResults([]); return }
    const t = setTimeout(() => {
      fetch(API + "/runners?search=" + encodeURIComponent(runnerQuery))
        .then(r => r.json()).then(setRunnerResults).catch(() => {})
    }, 280)
    return () => clearTimeout(t)
  }, [runnerQuery])

  const resetAdd = () => {
    setAddMode("search"); setRunnerQuery(""); setRunnerResults([])
    setSelectedRunner(null); setBibForExisting(""); setDistForExisting("")
    setNewForm({ first_name: "", last_name: "", email: "", dni: "", birth_date: "", category: "", club: "", bib_number: "", gender: "M", distance_km: "" })
    setAddError(""); setSaving(false)
  }

  const addExisting = async () => {
    if (!selectedRunner) { setAddError("Seleccioná un corredor"); return }
    if (!bibForExisting.trim()) { setAddError("Ingresá el dorsal"); return }
    setSaving(true); setAddError("")
    const dist = distForExisting ? parseFloat(distForExisting) : null
    const r = await fetch(API + "/races/" + raceId + "/registrations", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runner_id: selectedRunner.id, race_id: raceId, bib_number: bibForExisting.trim(), distance_km: dist }),
    })
    if (r.ok) { load(); setShowAdd(false); resetAdd() }
    else { const e = await r.json(); setAddError(e.detail || "Error") }
    setSaving(false)
  }

  const addNew = async () => {
    if (!newForm.first_name || !newForm.last_name || !newForm.bib_number) {
      setAddError("Nombre, apellido y dorsal son obligatorios"); return
    }
    setSaving(true); setAddError("")
    try {
      const cat = newForm.category || autoCategory(newForm.birth_date, newForm.gender) || undefined
      const runnerRes = await fetch(API + "/runners", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: newForm.first_name, last_name: newForm.last_name,
          email: newForm.email || null,
          dni: newForm.dni || null, birth_date: newForm.birth_date || null,
          category: cat || null, club: newForm.club || null, gender: newForm.gender,
        }),
      })
      if (!runnerRes.ok) { setAddError("Error creando corredor"); setSaving(false); return }
      const runner = await runnerRes.json()
      const dist = newForm.distance_km ? parseFloat(newForm.distance_km) : null
      const regRes = await fetch(API + "/races/" + raceId + "/registrations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runner_id: runner.id, race_id: raceId, bib_number: newForm.bib_number, distance_km: dist }),
      })
      if (!regRes.ok) { const e = await regRes.json(); setAddError(e.detail || "Dorsal ya existe"); setSaving(false); return }
      load(); setShowAdd(false); resetAdd()
    } catch { setAddError("Error conectando al servidor") }
    setSaving(false)
  }

  const setStatus = async (reg, status) => {
    await fetch(API + "/races/" + raceId + "/registrations/" + reg.id + "/status", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    load()
  }

  const deleteReg = async (reg) => {
    if (!confirm(`¿Quitar a ${reg.runner.full_name} (dorsal ${reg.bib_number}) de esta carrera?`)) return
    await fetch(API + "/races/" + raceId + "/registrations/" + reg.id, { method: "DELETE" })
    load()
  }

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map(r => r.id)))
    }
  }

  const bulkDelete = async () => {
    if (selected.size === 0) return
    if (!confirm(`¿Eliminar ${selected.size} inscripto${selected.size > 1 ? "s" : ""}? Esta acción no se puede deshacer.`)) return
    setBulkDeleting(true)
    await fetch(API + "/races/" + raceId + "/registrations/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selected] }),
    })
    setBulkDeleting(false)
    load()
  }

  const doImport = async () => {
    if (!importFile) return
    setImporting(true); setImportResult(null)
    const fd = new FormData()
    fd.append("file", importFile)
    try {
      const r = await fetch(API + "/races/" + raceId + "/import", { method: "POST", body: fd })
      const data = await r.json()
      setImportResult(data); load()
    } catch { setImportResult({ created: 0, skipped: 0, errors: ["Error al importar"] }) }
    setImporting(false)
  }

  const filtered = registrations.filter(r =>
    !search || r.runner.full_name.toLowerCase().includes(search.toLowerCase()) || r.bib_number.includes(search)
  )

  const statusCounts = { OK: 0, DNS: 0, DNF: 0, DQ: 0 }
  registrations.forEach(r => { statusCounts[r.status] = (statusCounts[r.status] || 0) + 1 })

  const locked = race?.status === "FINISHED"

  const TAB_BTN = (active) => ({
    padding: "5px 14px", fontSize: 12, borderRadius: 6, cursor: "pointer", border: "1px solid",
    background: active ? "#4d9fff20" : "transparent",
    color: active ? "#4d9fff" : "#8a9299",
    borderColor: active ? "#4d9fff40" : "#363b3f",
    fontWeight: active ? 700 : 400,
  })

  return (
    <div>
      {/* Banner de carrera finalizada */}
      {locked && (
        <div style={{ background: "#0f0f0f", border: "1px solid #f5a62340", borderRadius: 8, padding: "12px 18px", marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 20 }}>🔒</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#f5a623" }}>Carrera finalizada — solo lectura</div>
            <div style={{ fontSize: 12, color: "#525a60", marginTop: 2 }}>No se pueden agregar, modificar ni eliminar inscripciones.</div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Inscriptos</span>
          <span style={{ background: "#4d9fff15", color: "#4d9fff", border: "1px solid #4d9fff30", borderRadius: 20, padding: "2px 10px", fontSize: 12 }}>{registrations.length}</span>
          {statusCounts.DNS > 0 && <span style={{ background: "#8a929915", color: "#8a9299", border: "1px solid #8a929930", borderRadius: 20, padding: "2px 8px", fontSize: 11 }}>DNS: {statusCounts.DNS}</span>}
          {statusCounts.DNF > 0 && <span style={{ background: "#f5a62315", color: "#f5a623", border: "1px solid #f5a62330", borderRadius: 20, padding: "2px 8px", fontSize: 11 }}>DNF: {statusCounts.DNF}</span>}
          {statusCounts.DQ  > 0 && <span style={{ background: "#ff4d4d15", color: "#ff4d4d", border: "1px solid #ff4d4d30", borderRadius: 20, padding: "2px 8px", fontSize: 11 }}>DQ: {statusCounts.DQ}</span>}
        </div>
        {!locked && (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setShowImport(!showImport); setImportResult(null) }} style={BTN_GHOST}>↑ Importar</button>
            <button onClick={() => { setShowAdd(!showAdd); resetAdd() }} style={BTN_PRIMARY}>+ Inscribir</button>
          </div>
        )}
      </div>

      {/* Panel importación */}
      {!locked && showImport && (
        <div style={{ ...CARD, border: "1px solid #4d9fff30", marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#4d9fff", marginBottom: 8 }}>Importar desde Excel / CSV</div>
          <div style={{ fontSize: 12, color: "#525a60", marginBottom: 12 }}>
            Columnas requeridas: <code style={{ background: "#1c1f21", padding: "2px 6px", borderRadius: 3, color: "#e8eaeb" }}>dorsal, nombre, apellido</code>
            {" "}· Opcionales: <code style={{ background: "#1c1f21", padding: "2px 6px", borderRadius: 3, color: "#e8eaeb" }}>distancia, categoria, club, genero, dni, email</code>
            {" "}· Los atletas ya existentes se reutilizan automáticamente.
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={e => { setImportFile(e.target.files[0]); setImportResult(null) }} style={{ flex: 1, ...INPUT }} />
            <button onClick={doImport} disabled={!importFile || importing} style={{ ...BTN_PRIMARY, opacity: (!importFile || importing) ? 0.6 : 1 }}>{importing ? "Importando..." : "Importar"}</button>
            <button onClick={() => setShowImport(false)} style={BTN_GHOST}>Cerrar</button>
          </div>
          {importResult && (
            <div style={{ marginTop: 12, padding: "10px 14px", background: "#1c1f21", borderRadius: 6 }}>
              <span style={{ color: "#00e5a0", fontSize: 13, marginRight: 16 }}>✓ {importResult.created} inscriptos</span>
              <span style={{ color: "#525a60", fontSize: 13, marginRight: 16 }}>⊘ {importResult.skipped} ya existían</span>
              {importResult.errors.map((e, i) => <div key={i} style={{ color: "#ff4d4d", fontSize: 12, marginTop: 4 }}>{e}</div>)}
            </div>
          )}
        </div>
      )}

      {/* Panel inscribir */}
      {!locked && showAdd && (
        <div style={{ ...CARD, border: "1px solid #00e5a040", marginBottom: 16 }}>
          {/* Tabs: Buscar existente / Nuevo */}
          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            <button onClick={() => { setAddMode("search"); setAddError("") }} style={TAB_BTN(addMode === "search")}>Buscar atleta existente</button>
            <button onClick={() => { setAddMode("new"); setAddError("") }} style={TAB_BTN(addMode === "new")}>Nuevo atleta</button>
          </div>

          {addMode === "search" && (
            <div>
              <div style={{ fontSize: 12, color: "#525a60", marginBottom: 12 }}>
                Buscá al atleta por nombre. Si ya corrió en otra carrera, sus datos personales estarán guardados.
              </div>

              {!selectedRunner ? (
                <div style={{ position: "relative" }}>
                  <div style={{ fontSize: 11, color: "#525a60", marginBottom: 4, textTransform: "uppercase" }}>Buscar por nombre</div>
                  <input
                    value={runnerQuery}
                    onChange={e => setRunnerQuery(e.target.value)}
                    placeholder="ej. Carlos Mendez"
                    style={{ ...INPUT, maxWidth: 340 }}
                    autoFocus
                  />
                  {runnerResults.length > 0 && (
                    <div style={{ position: "absolute", top: "100%", left: 0, right: 0, maxWidth: 340, background: "#1c1f21", border: "1px solid #363b3f", borderRadius: 6, boxShadow: "0 4px 20px #00000060", zIndex: 10, maxHeight: 240, overflowY: "auto", marginTop: 4 }}>
                      {runnerResults.map(r => (
                        <div key={r.id}
                          onClick={() => { setSelectedRunner(r); setRunnerQuery(""); setRunnerResults([]) }}
                          style={{ padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid #2a2e31", display: "flex", alignItems: "center", gap: 10 }}
                          onMouseEnter={e => e.currentTarget.style.background = "#2a2e31"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{r.full_name}</div>
                            <div style={{ fontSize: 11, color: "#525a60" }}>
                              {[r.category, r.club, r.gender].filter(Boolean).join(" · ")}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {runnerQuery.length >= 2 && runnerResults.length === 0 && (
                    <div style={{ marginTop: 8, fontSize: 12, color: "#525a60" }}>
                      Sin resultados. Podés{" "}
                      <span onClick={() => setAddMode("new")} style={{ color: "#00e5a0", cursor: "pointer", textDecoration: "underline" }}>crear un nuevo atleta</span>.
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div style={{ background: "#1c1f21", border: "1px solid #00e5a030", borderRadius: 8, padding: "12px 16px", flex: 1, minWidth: 200 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{selectedRunner.full_name}</div>
                    <div style={{ fontSize: 12, color: "#8a9299" }}>
                      {[selectedRunner.category, selectedRunner.club, selectedRunner.gender].filter(Boolean).join(" · ")}
                    </div>
                    <button onClick={() => setSelectedRunner(null)} style={{ ...BTN_GHOST, fontSize: 11, marginTop: 8, padding: "3px 10px" }}>Cambiar</button>
                  </div>
                  <div style={{ minWidth: 120 }}>
                    <div style={{ fontSize: 11, color: "#525a60", marginBottom: 4, textTransform: "uppercase" }}>Dorsal *</div>
                    <input
                      value={bibForExisting}
                      onChange={e => setBibForExisting(e.target.value)}
                      placeholder="ej. 101"
                      style={{ ...INPUT, fontFamily: "monospace", fontWeight: 700, fontSize: 16, color: "#00e5a0", textAlign: "center" }}
                      onKeyDown={e => e.key === "Enter" && addExisting()}
                      autoFocus
                    />
                  </div>
                  <div style={{ minWidth: 100 }}>
                    <div style={{ fontSize: 11, color: "#525a60", marginBottom: 4, textTransform: "uppercase" }}>Distancia (km)</div>
                    <input
                      value={distForExisting}
                      onChange={e => setDistForExisting(e.target.value)}
                      placeholder="ej. 10"
                      style={{ ...INPUT, textAlign: "center" }}
                      type="number" step="0.5"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {addMode === "new" && (
            <div>
              <div style={{ fontSize: 12, color: "#525a60", marginBottom: 12 }}>
                El atleta se guardará en la base de datos global. El dorsal solo aplica a esta carrera.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "80px 80px 1fr 1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 11, color: "#525a60", marginBottom: 4, textTransform: "uppercase" }}>Dorsal *</div>
                  <input value={newForm.bib_number} onChange={e => setNewForm(p => ({ ...p, bib_number: e.target.value }))}
                    placeholder="101" style={{ ...INPUT, fontFamily: "monospace", fontWeight: 700, color: "#00e5a0", textAlign: "center" }} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#525a60", marginBottom: 4, textTransform: "uppercase" }}>Dist. km</div>
                  <input value={newForm.distance_km} onChange={e => setNewForm(p => ({ ...p, distance_km: e.target.value }))}
                    placeholder="10" style={{ ...INPUT, textAlign: "center" }} type="number" step="0.5" />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#525a60", marginBottom: 4, textTransform: "uppercase" }}>Nombre *</div>
                  <input value={newForm.first_name} onChange={e => setNewForm(p => ({ ...p, first_name: e.target.value }))} placeholder="Carlos" style={INPUT} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#525a60", marginBottom: 4, textTransform: "uppercase" }}>Apellido *</div>
                  <input value={newForm.last_name} onChange={e => setNewForm(p => ({ ...p, last_name: e.target.value }))} placeholder="Méndez" style={INPUT} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#525a60", marginBottom: 4, textTransform: "uppercase" }}>DNI</div>
                  <input value={newForm.dni} onChange={e => setNewForm(p => ({ ...p, dni: e.target.value }))} placeholder="12345678" style={INPUT} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#525a60", marginBottom: 4, textTransform: "uppercase" }}>Género</div>
                  <select value={newForm.gender} onChange={e => {
                    const gender = e.target.value
                    setNewForm(p => ({ ...p, gender, category: autoCategory(p.birth_date, gender) }))
                  }} style={{ ...INPUT }}>
                    <option value="M">Masculino</option>
                    <option value="F">Femenino</option>
                    <option value="X">Otro</option>
                  </select>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 11, color: "#525a60", marginBottom: 4, textTransform: "uppercase" }}>Fecha de nacimiento</div>
                  <input value={newForm.birth_date} onChange={e => {
                    const birth_date = e.target.value
                    setNewForm(p => ({ ...p, birth_date, category: autoCategory(birth_date, p.gender) }))
                  }} style={INPUT} type="date" />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#525a60", marginBottom: 4, textTransform: "uppercase" }}>
                    Categoría {newForm.birth_date && <span style={{ color: "#00e5a060" }}>(auto)</span>}
                  </div>
                  <input
                    value={newForm.category}
                    onChange={e => setNewForm(p => ({ ...p, category: e.target.value }))}
                    placeholder={newForm.birth_date ? autoCategory(newForm.birth_date, newForm.gender) || "—" : "ej. M30-34"}
                    style={{ ...INPUT, color: newForm.birth_date && autoCategory(newForm.birth_date, newForm.gender) ? "#00e5a0" : "#e8eaeb" }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#525a60", marginBottom: 4, textTransform: "uppercase" }}>Club</div>
                  <input value={newForm.club} onChange={e => setNewForm(p => ({ ...p, club: e.target.value }))} placeholder="RC Runners" style={INPUT} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#525a60", marginBottom: 4, textTransform: "uppercase" }}>Email</div>
                  <input value={newForm.email} onChange={e => setNewForm(p => ({ ...p, email: e.target.value }))} placeholder="corredor@email.com" style={INPUT} type="email" />
                </div>
                {newForm.birth_date && calcAge(newForm.birth_date) !== null && (
                  <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 2 }}>
                    <div style={{ background: "#1c1f21", border: "1px solid #363b3f", borderRadius: 6, padding: "7px 10px", color: "#8a9299", fontSize: 13, width: "100%", textAlign: "center" }}>
                      <span style={{ color: "#e8eaeb", fontWeight: 700 }}>{calcAge(newForm.birth_date)}</span> años
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {addError && <div style={{ color: "#ff4d4d", fontSize: 12, marginBottom: 10, padding: "6px 10px", background: "#ff4d4d15", borderRadius: 4 }}>{addError}</div>}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
            <button onClick={() => { setShowAdd(false); resetAdd() }} style={BTN_GHOST}>Cancelar</button>
            <button
              onClick={addMode === "search" ? addExisting : addNew}
              disabled={saving}
              style={{ ...BTN_PRIMARY, opacity: saving ? 0.6 : 1 }}>
              {saving ? "Guardando..." : "Inscribir"}
            </button>
          </div>
        </div>
      )}

      {/* Búsqueda en tabla */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
        {registrations.length > 0 && (
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre o dorsal…" style={{ ...INPUT, maxWidth: 280 }} />
        )}
        {!locked && selected.size > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 14px", background: "#ff4d4d15", border: "1px solid #ff4d4d30", borderRadius: 8, marginLeft: "auto" }}>
            <span style={{ fontSize: 13, color: "#ff4d4d", fontWeight: 600 }}>
              {selected.size} seleccionado{selected.size > 1 ? "s" : ""}
            </span>
            <button
              onClick={bulkDelete}
              disabled={bulkDeleting}
              style={{ padding: "4px 14px", background: "#ff4d4d", border: "none", borderRadius: 5, cursor: "pointer", color: "#fff", fontWeight: 700, fontSize: 12, opacity: bulkDeleting ? 0.6 : 1 }}>
              {bulkDeleting ? "Eliminando..." : "🗑 Eliminar seleccionados"}
            </button>
            <button onClick={() => setSelected(new Set())} style={{ ...BTN_GHOST, padding: "4px 10px", fontSize: 12 }}>Cancelar</button>
          </div>
        )}
      </div>

      {/* Tabla */}
      <div style={{ ...CARD, overflow: "hidden", padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #2a2e31" }}>
              {!locked && (
                <th style={{ padding: "8px 14px", width: 36 }}>
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selected.size === filtered.length}
                    ref={el => { if (el) el.indeterminate = selected.size > 0 && selected.size < filtered.length }}
                    onChange={toggleAll}
                    style={{ cursor: "pointer", accentColor: "#00e5a0" }}
                  />
                </th>
              )}
              {["Dorsal", "Dist.", "Nombre", "Categoría", "Club", "Estado"].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "8px 14px", fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: "#525a60" }}>{h}</th>
              ))}
              {!locked && <th />}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={locked ? 6 : 8} style={{ textAlign: "center", padding: 32, color: "#525a60" }}>{search ? "Sin resultados" : "No hay inscriptos aún"}</td></tr>
            ) : filtered.map(r => {
              const isSelected = selected.has(r.id)
              const dist = r.distance_km
              const statusInfo = REG_STATUS[r.status] || REG_STATUS.OK
              return (
                <tr key={r.id} style={{ borderBottom: "1px solid #1c1f21", opacity: r.status !== "OK" ? 0.65 : 1, background: isSelected ? "#ff4d4d08" : "transparent" }}>
                  {!locked && (
                    <td style={{ padding: "9px 14px" }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(r.id)}
                        style={{ cursor: "pointer", accentColor: "#00e5a0" }}
                      />
                    </td>
                  )}
                  <td style={{ padding: "9px 14px" }}>
                    <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, background: "#1c1f21", padding: "2px 10px", borderRadius: 4, color: "#00e5a0" }}>{r.bib_number}</span>
                  </td>
                  <td style={{ padding: "9px 14px" }}>
                    {dist ? <span style={{ background: "#4d9fff15", color: "#4d9fff", border: "1px solid #4d9fff30", borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>{dist} km</span> : <span style={{ color: "#363b3f", fontSize: 12 }}>--</span>}
                  </td>
                  <td style={{ padding: "9px 14px", fontSize: 13, fontWeight: 500 }}>{r.runner.full_name}</td>
                  <td style={{ padding: "9px 14px" }}>
                    <span style={{ background: r.runner.category?.startsWith("F") ? "#4d9fff15" : "#00e5a015", color: r.runner.category?.startsWith("F") ? "#4d9fff" : "#00e5a0", border: "1px solid " + (r.runner.category?.startsWith("F") ? "#4d9fff30" : "#00e5a030"), borderRadius: 20, padding: "2px 8px", fontSize: 11 }}>
                      {r.runner.category || "--"}
                    </span>
                  </td>
                  <td style={{ padding: "9px 14px", fontSize: 13, color: "#8a9299" }}>{r.runner.club || "--"}</td>
                  <td style={{ padding: "9px 14px" }}>
                    {locked
                      ? <span style={{ background: statusInfo.color + "20", color: statusInfo.color, border: `1px solid ${statusInfo.color}40`, borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>{statusInfo.label}</span>
                      : <select value={r.status} onChange={e => setStatus(r, e.target.value)}
                          style={{ background: "#1c1f21", border: "1px solid #363b3f", borderRadius: 4, padding: "3px 6px", color: REG_STATUS[r.status]?.color || "#e8eaeb", fontSize: 12, outline: "none", cursor: "pointer" }}>
                          <option value="OK">OK</option>
                          <option value="DNS">DNS — No largó</option>
                          <option value="DNF">DNF — No terminó</option>
                          <option value="DQ">DQ — Descalificado</option>
                        </select>
                    }
                  </td>
                  {!locked && (
                    <td style={{ padding: "9px 14px", textAlign: "right" }}>
                      <button onClick={() => deleteReg(r)} style={BTN_DANGER}>✕</button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// PÁGINA: MOTOR DE TIEMPOS
// ═══════════════════════════════════════════════════════════════════════════════

function TimingPage({ race }) {
  const raceId = race?.id
  const { queue, finishers, connected, capture, assignBib, undoAssign, discard, bibLookup } = useTimingEngine(raceId)
  const [hints, setHints] = useState({})
  const [raceStartNs, setRaceStartNs] = useState(race?.race_start_ns || null)
  const [elapsed, setElapsed] = useState("")

  useEffect(() => {
    if (!raceId) return
    fetch(API + "/races/" + raceId)
      .then(r => r.json())
      .then(d => setRaceStartNs(d.race_start_ns || null))
      .catch(() => {})
  }, [raceId])

  // Live elapsed timer
  useEffect(() => {
    if (!raceStartNs) { setElapsed(""); return }
    const tick = () => {
      const nowMs = Date.now()
      const startMs = Math.floor(raceStartNs / 1_000_000)
      const diffMs = nowMs - startMs
      const h = Math.floor(diffMs / 3600000)
      const m = Math.floor((diffMs % 3600000) / 60000)
      const s = Math.floor((diffMs % 60000) / 1000)
      setElapsed(`${pad(h)}:${pad(m)}:${pad(s)}`)
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [raceStartNs])

  useEffect(() => {
    const h = (e) => {
      if (e.code === "Space" && document.activeElement.tagName !== "INPUT") {
        e.preventDefault(); capture()
      }
    }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [capture])

  const handleInput = async (id, val) => {
    setHints(p => ({ ...p, [id]: null }))
    if (!val) return
    const r = await bibLookup(val)
    setHints(p => ({ ...p, [id]: r }))
  }

  const handleAssign = (id) => {
    const inp = document.getElementById("bib-" + id)
    if (inp?.value) { assignBib(id, inp.value); inp.value = "" }
  }

  const startRace = async () => {
    if (raceStartNs) { alert("La largada ya fue registrada"); return }
    if (!confirm("¿Registrar largada AHORA?")) return
    const r = await fetch(API + "/races/" + raceId + "/start", { method: "POST" })
    const data = await r.json()
    if (r.ok) setRaceStartNs(data.race_start_ns)
    else alert(data.detail || "Error")
  }

  if (!race) return (
    <div style={{ textAlign: "center", padding: 60, color: "#525a60" }}>Seleccioná una carrera</div>
  )

  // ── Carrera finalizada: solo mostrar clasificación final ──
  if (race.status === "FINISHED") {
    return (
      <div>
        <div style={{ background: "#0f0f0f", border: "1px solid #f5a62340", borderRadius: 10, padding: "20px 24px", marginBottom: 20, display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 36 }}>🏆</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17, color: "#f5a623", marginBottom: 4 }}>Carrera finalizada</div>
            <div style={{ fontSize: 13, color: "#525a60" }}>El cronómetro está cerrado. Consultá los resultados en la pestaña <strong style={{ color: "#8a9299" }}>Resultados</strong>.</div>
          </div>
        </div>
        <div style={{ ...CARD }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: "#8a9299", marginBottom: 12, display: "flex", alignItems: "center" }}>
            Clasificación final
            <span style={{ marginLeft: "auto", background: "#4d9fff15", color: "#4d9fff", border: "1px solid #4d9fff30", borderRadius: 20, padding: "2px 8px", fontSize: 11 }}>{finishers.length} finishers</span>
          </div>
          {finishers.length === 0
            ? <div style={{ textAlign: "center", padding: 32, color: "#525a60" }}>Sin tiempos registrados</div>
            : finishers.map((f, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #1c1f21" }}>
                <span style={{ fontFamily: "monospace", fontSize: 14, color: i === 0 ? "#f5a623" : i === 1 ? "#aabbcc" : i === 2 ? "#cd7c4a" : "#525a60", minWidth: 24, fontWeight: i < 3 ? 700 : 400 }}>{i + 1}</span>
                <span style={{ fontFamily: "monospace", fontSize: 11, background: "#1c1f21", padding: "1px 6px", borderRadius: 3, color: "#8a9299" }}>{f.bib_number}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{f.runner?.full_name || "--"}</div>
                  <div style={{ fontSize: 11, color: "#525a60" }}>{f.runner?.category || ""}</div>
                </div>
                <span style={{ fontFamily: "monospace", fontSize: 13, color: "#00e5a0", fontWeight: 600 }}>{formatNs(f.net_time_ns || f.capture_ns)}</span>
              </div>
            ))
          }
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      {/* ── Banner de estado de largada ── */}
      {!raceStartNs ? (
        <div style={{ background: "#1a1200", border: "2px solid #f5a623", borderRadius: 10, padding: "14px 20px", display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 28 }}>⏸</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: "#f5a623", marginBottom: 2 }}>Carrera sin largada oficial</div>
            <div style={{ fontSize: 12, color: "#8a7a50" }}>Los tiempos se cuentan desde que se capture la primera llegada. Registrá la largada para medir tiempos netos reales.</div>
          </div>
          <button onClick={startRace}
            style={{ padding: "10px 24px", background: "#f5a623", border: "none", borderRadius: 8, cursor: "pointer", color: "#000", fontWeight: 800, fontSize: 14, letterSpacing: 0.5, flexShrink: 0 }}>
            🏁 REGISTRAR LARGADA
          </button>
        </div>
      ) : (
        <div style={{ background: "#001a0f", border: "2px solid #00e5a0", borderRadius: 10, padding: "14px 20px", display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 28 }}>🟢</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: "#00e5a0", marginBottom: 2 }}>CARRERA EN CURSO</div>
            <div style={{ fontSize: 12, color: "#00a070" }}>Largada registrada — los tiempos se miden desde ese momento</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "monospace", fontSize: 32, fontWeight: 900, color: "#00e5a0", letterSpacing: 2, lineHeight: 1 }}>{elapsed}</div>
            <div style={{ fontSize: 10, color: "#00a070", marginTop: 2, letterSpacing: 1, textTransform: "uppercase" }}>Tiempo transcurrido</div>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16 }}>

      {/* Columna izquierda */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <button onClick={capture}
          style={{ width: "100%", padding: 20, fontSize: 18, fontWeight: 700, background: OP_GRAD, border: "none", borderRadius: 8, cursor: "pointer", color: "#000", letterSpacing: 2 }}>
          ⏱ CAPTURAR LLEGADA
        </button>

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ fontSize: 11, color: "#525a60" }}>También podés presionar <kbd style={{ background: "#1c1f21", border: "1px solid #363b3f", borderRadius: 3, padding: "1px 6px", fontFamily: "monospace", fontSize: 11 }}>ESPACIO</kbd></div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: connected ? "#00e5a0" : "#ff4d4d", boxShadow: connected ? "0 0 6px #00e5a0" : "none" }} />
            <span style={{ fontSize: 11, color: connected ? "#00e5a0" : "#ff4d4d" }}>{connected ? "Conectado" : "Reconectando..."}</span>
          </div>
        </div>

        <div style={{ ...CARD, flex: 1, overflow: "auto" }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: "#8a9299", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
            Cola de capturas
            {queue.length > 0 && (
              <span style={{ marginLeft: "auto", background: "#f5a62315", color: "#f5a623", border: "1px solid #f5a62330", borderRadius: 20, padding: "2px 8px", fontSize: 11 }}>
                {queue.length} pendiente{queue.length > 1 ? "s" : ""}
              </span>
            )}
          </div>

          {queue.length === 0 && (
            <div style={{ textAlign: "center", padding: 32, color: "#525a60" }}>
              {connected ? "Presioná ESPACIO para capturar llegadas" : "Sin conexión — reconectando..."}
            </div>
          )}

          {queue.map(item => (
            <div key={item.id} style={{ background: "#1c1f21", border: "1px solid #2a2e31", borderRadius: 6, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ fontFamily: "monospace", fontSize: 11, color: "#525a60", minWidth: 22 }}>#{item.sequence_order}</span>
              <span style={{ fontFamily: "monospace", fontSize: 14, color: "#00e5a0", minWidth: 100 }}>
                {raceStartNs ? formatNs(item.captured_ns - raceStartNs) : formatNs(item.captured_ns)}
              </span>
              <input
                id={"bib-" + item.id}
                placeholder="Dorsal"
                onInput={e => handleInput(item.id, e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAssign(item.id)}
                style={{ width: 72, background: "#232729", border: "1px solid #363b3f", borderRadius: 4, padding: "4px 8px", fontFamily: "monospace", fontSize: 14, color: "#e8eaeb", textAlign: "center", outline: "none" }}
                autoComplete="off"
              />
              <span style={{ flex: 1, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                color: hints[item.id]?.already_finished ? "#f5a623" : hints[item.id]?.found ? "#00e5a0" : hints[item.id] ? "#ff4d4d" : "#525a60" }}>
                {hints[item.id]?.already_finished
                  ? `⚠ Ya registrado — ${hints[item.id].runner?.full_name || ""}`
                  : hints[item.id]?.found
                    ? hints[item.id].runner.full_name
                    : hints[item.id] ? "No encontrado" : "--"}
              </span>
              <button onClick={() => handleAssign(item.id)}
                style={{ padding: "4px 10px", background: "#00e5a020", color: "#00e5a0", border: "1px solid #00e5a040", borderRadius: 4, cursor: "pointer", fontWeight: 600, fontSize: 12 }}>OK</button>
              <button onClick={() => discard(item.id)}
                style={{ padding: "4px 8px", background: "transparent", color: "#ff4d4d", border: "1px solid #2a2e31", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>✕</button>
            </div>
          ))}

        </div>
      </div>

      {/* Columna derecha: Clasificación en vivo */}
      <div style={{ ...CARD, overflow: "auto" }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: "#8a9299", marginBottom: 12, display: "flex", alignItems: "center" }}>
          Clasificación en vivo
          <span style={{ marginLeft: "auto", background: "#4d9fff15", color: "#4d9fff", border: "1px solid #4d9fff30", borderRadius: 20, padding: "2px 8px", fontSize: 11 }}>{finishers.length}</span>
        </div>
        {finishers.length === 0
          ? <div style={{ textAlign: "center", padding: 24, color: "#525a60", fontSize: 13 }}>Sin finishers aún</div>
          : finishers.map((f, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid #1c1f21" }}>
              <span style={{ fontFamily: "monospace", fontSize: 13, color: i === 0 ? "#f5a623" : i === 1 ? "#aabbcc" : i === 2 ? "#cd7c4a" : "#525a60", minWidth: 22 }}>{i + 1}</span>
              <span style={{ fontFamily: "monospace", fontSize: 11, background: "#1c1f21", padding: "1px 6px", borderRadius: 3, color: "#8a9299" }}>{f.bib_number}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.runner?.full_name || "--"}</div>
                <div style={{ fontSize: 11, color: "#525a60" }}>{f.runner?.category || ""}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: "monospace", fontSize: 12, color: "#00e5a0" }}>{formatNs(f.net_time_ns || f.capture_ns)}</div>
                {f.capture_id && (
                  <button onClick={() => undoAssign(f.capture_id)} title="Deshacer"
                    style={{ padding: "1px 5px", background: "transparent", color: "#f5a62360", border: "none", cursor: "pointer", fontSize: 10 }}>✎</button>
                )}
              </div>
            </div>
          ))
        }
      </div>
      </div>{/* end grid */}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// RESULTS DETAIL (resultados de una carrera con filtros)
// ═══════════════════════════════════════════════════════════════════════════════

function ResultsDetail({ race, onBack, hideBackButton = false }) {
  const [results, setResults]       = useState(null)
  const [loading, setLoading]       = useState(true)
  const [view, setView]             = useState("general")
  const [search, setSearch]         = useState("")
  const [catFilter, setCatFilter]   = useState("")
  const [genderFilter, setGender]   = useState("")
  const [distFilter, setDistFilter] = useState(null)  // null = todas
  const [sortKey, setSortKey]       = useState("time")
  const [autoRefresh, setAutoRefresh] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    fetch(API + "/races/" + race.id + "/results")
      .then(r => r.json())
      .then(d => { setResults(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [race.id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!autoRefresh) return
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [autoRefresh, load])

  useEffect(() => {
    setSearch(""); setCatFilter(""); setGender(""); setDistFilter(null); setSortKey("time"); setView("general")
  }, [race.id])

  const MEDAL = ["🥇", "🥈", "🥉"]

  const categories = results
    ? [...new Set(results.results.map(r => r.category).filter(Boolean))].sort()
    : []

  const availDistances = results?.distances || []
  const hasMultiDist = availDistances.length > 1

  const filtered = (results?.results || [])
    .filter(r => {
      if (distFilter !== null && r.distance_km !== distFilter) return false
      if (catFilter && r.category !== catFilter) return false
      if (genderFilter && r.runner.gender !== genderFilter) return false
      if (search) {
        const q = search.toLowerCase()
        if (!r.runner.full_name.toLowerCase().includes(q) && !r.bib_number.includes(q)) return false
      }
      return true
    })
    .sort((a, b) => {
      if (sortKey === "time")      return (a.net_time_ns || a.finish_time_ns) - (b.net_time_ns || b.finish_time_ns)
      if (sortKey === "time_desc") return (b.net_time_ns || b.finish_time_ns) - (a.net_time_ns || a.finish_time_ns)
      if (sortKey === "name")      return a.runner.full_name.localeCompare(b.runner.full_name)
      if (sortKey === "bib")       return a.bib_number.localeCompare(b.bib_number, undefined, { numeric: true })
      return 0
    })

  const byCat = {}
  ;(results?.results || [])
    .filter(r => {
      if (distFilter !== null && r.distance_km !== distFilter) return false
      if (genderFilter && r.runner.gender !== genderFilter) return false
      if (search) {
        const q = search.toLowerCase()
        if (!r.runner.full_name.toLowerCase().includes(q) && !r.bib_number.includes(q)) return false
      }
      return true
    })
    .forEach(r => {
      const cat = r.category || "Sin categoría"
      if (!byCat[cat]) byCat[cat] = []
      byCat[cat].push(r)
    })
  Object.keys(byCat).forEach(cat => {
    byCat[cat].sort((a, b) => (a.net_time_ns || a.finish_time_ns) - (b.net_time_ns || b.finish_time_ns))
  })
  const sortedCats = Object.keys(byCat).sort()

  const SEL = (active) => ({
    padding: "5px 12px", fontSize: 12, borderRadius: 6, cursor: "pointer", border: "1px solid",
    background: active ? "#00e5a020" : "transparent",
    color: active ? "#00e5a0" : "#8a9299",
    borderColor: active ? "#00e5a040" : "#363b3f",
    fontWeight: active ? 700 : 400,
  })

  return (
    <div>
      {/* Header */}
      {!hideBackButton && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
          <button onClick={onBack} style={{ ...BTN_GHOST, flexShrink: 0, marginTop: 2 }}>← Carreras</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{race.name}</div>
            <div style={{ fontSize: 12, color: "#525a60", marginTop: 2 }}>
              {[race.race_date, race.location].filter(Boolean).join(" · ")}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginBottom: 12 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#525a60", cursor: "pointer" }}>
          <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
          Auto-actualizar
        </label>
        <button onClick={load} style={BTN_GHOST}>↻ Actualizar</button>
        <button onClick={() => window.open(API + "/races/" + race.id + "/export/csv", "_blank")} style={BTN_GHOST}>⬇ CSV</button>
        <button onClick={() => results && printResultsReport({ race, results })} disabled={!results} style={BTN_GHOST}>📄 Reporte PDF</button>
      </div>

      {/* Stats */}
      {results && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
          {[
            ["Finishers",  results.total_finishers,  "#00e5a0"],
            ["Inscritos",  results.total_registered, null],
            ["Pendientes", Math.max(0, results.total_registered - results.total_finishers - results.dnf_list.length), null],
            ["DNS/DNF/DQ", results.dnf_list.length,  results.dnf_list.length > 0 ? "#f5a623" : null],
          ].map(([label, val, color]) => (
            <div key={label} style={{ ...CARD }}>
              <div style={{ fontSize: 26, fontWeight: 700, color: color || "#e8eaeb" }}>{val}</div>
              <div style={{ fontSize: 11, color: "#525a60", marginTop: 3, textTransform: "uppercase" }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Selector de distancia (solo si hay múltiples) ── */}
      {hasMultiDist && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "#525a60", fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>Distancia</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button onClick={() => { setDistFilter(null); setCatFilter("") }}
              style={{ padding: "7px 18px", fontSize: 13, fontWeight: distFilter === null ? 800 : 500, borderRadius: 8, cursor: "pointer", border: "2px solid", background: distFilter === null ? "#00e5a020" : "transparent", color: distFilter === null ? "#00e5a0" : "#8a9299", borderColor: distFilter === null ? "#00e5a0" : "#363b3f" }}>
              Todas
            </button>
            {availDistances.map(d => (
              <button key={d} onClick={() => { setDistFilter(d); setCatFilter("") }}
                style={{ padding: "7px 18px", fontSize: 13, fontWeight: distFilter === d ? 800 : 500, borderRadius: 8, cursor: "pointer", border: "2px solid", background: distFilter === d ? "#4d9fff20" : "transparent", color: distFilter === d ? "#4d9fff" : "#8a9299", borderColor: distFilter === d ? "#4d9fff" : "#363b3f" }}>
                {d} km
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar nombre o dorsal…"
          style={{ ...INPUT, width: 200, flex: "0 0 auto" }} />
        {categories.length > 0 && (
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
            style={{ background: "#1c1f21", border: "1px solid #363b3f", borderRadius: 6, padding: "7px 10px", color: catFilter ? "#e8eaeb" : "#525a60", fontSize: 12, outline: "none" }}>
            <option value="">Todas las categorías</option>
            {categories.map(c => <option key={c}>{c}</option>)}
          </select>
        )}
        <div style={{ display: "flex", gap: 4 }}>
          {[["", "Todos"], ["M", "Masculino"], ["F", "Femenino"]].map(([val, label]) => (
            <button key={val} onClick={() => setGender(val)} style={SEL(genderFilter === val)}>{label}</button>
          ))}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "#525a60", alignSelf: "center" }}>Ordenar:</span>
          {[["time", "Tiempo ↑"], ["time_desc", "Tiempo ↓"], ["name", "Nombre"], ["bib", "Dorsal"]].map(([val, label]) => (
            <button key={val} onClick={() => setSortKey(val)} style={SEL(sortKey === val)}>{label}</button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {[["general", "Clasificación General"], ["categories", "Por Categoría"]].map(([id, label]) => (
          <button key={id} onClick={() => setView(id)} style={SEL(view === id)}>{label}</button>
        ))}
        {(search || catFilter || genderFilter) && (
          <span style={{ alignSelf: "center", fontSize: 12, color: "#f5a623", marginLeft: 8 }}>
            {filtered.length} resultado{filtered.length !== 1 ? "s" : ""}
            {" "}
            <span onClick={() => { setSearch(""); setCatFilter(""); setGender("") }}
              style={{ color: "#525a60", cursor: "pointer", textDecoration: "underline", fontSize: 11 }}>limpiar</span>
          </span>
        )}
      </div>

      {/* Vista General */}
      {view === "general" && (
        <>
          {loading
            ? <div style={{ textAlign: "center", padding: 48, color: "#525a60" }}>Cargando…</div>
            : (
              <div style={{ ...CARD, overflow: "hidden", padding: 0 }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #2a2e31" }}>
                      {["Pos.", "Dorsal", hasMultiDist ? "Dist." : null, "Nombre", "Categoría", "Club", "Tiempo Neto", ""].filter(Boolean).map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "8px 14px", fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: "#525a60" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0
                      ? <tr><td colSpan={8} style={{ textAlign: "center", padding: 48, color: "#525a60" }}>Sin resultados para los filtros aplicados</td></tr>
                      : filtered.map((r, i) => {
                          const isTop3 = sortKey === "time" && i < 3 && !catFilter && !genderFilter && !search
                          return (
                            <tr key={r.bib_number + (r.distance_km || "")} style={{ borderBottom: "1px solid #1c1f21" }}>
                              <td style={{ padding: "9px 14px", fontFamily: "monospace", color: isTop3 ? (i === 0 ? "#f5a623" : i === 1 ? "#aabbcc" : "#cd7c4a") : "#525a60", fontWeight: isTop3 ? 700 : 400 }}>
                                {isTop3 ? MEDAL[i] : r.position}
                              </td>
                              <td style={{ padding: "9px 14px" }}>
                                <span style={{ fontFamily: "monospace", fontSize: 12, background: "#1c1f21", padding: "2px 8px", borderRadius: 3, color: "#8a9299" }}>{r.bib_number}</span>
                              </td>
                              {hasMultiDist && (
                                <td style={{ padding: "9px 14px" }}>
                                  {r.distance_km ? <span style={{ background: "#4d9fff15", color: "#4d9fff", border: "1px solid #4d9fff30", borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>{r.distance_km} km</span> : "--"}
                                </td>
                              )}
                              <td style={{ padding: "9px 14px", fontWeight: 500, fontSize: 13 }}>{r.runner.full_name}</td>
                              <td style={{ padding: "9px 14px" }}>
                                <span style={{ background: r.category?.startsWith("F") ? "#4d9fff15" : "#00e5a015", color: r.category?.startsWith("F") ? "#4d9fff" : "#00e5a0", border: "1px solid " + (r.category?.startsWith("F") ? "#4d9fff30" : "#00e5a030"), borderRadius: 20, padding: "2px 8px", fontSize: 11 }}>
                                  {r.category || "--"}
                                </span>
                              </td>
                              <td style={{ padding: "9px 14px", fontSize: 13, color: "#8a9299" }}>{r.club || "--"}</td>
                              <td style={{ padding: "9px 14px", fontFamily: "monospace", color: "#00e5a0", fontSize: 14, fontWeight: 600 }}>
                                {formatNs(r.net_time_ns || r.finish_time_ns)}
                              </td>
                              <td style={{ padding: "9px 10px", textAlign: "right" }}>
                                <button
                                  title="Imprimir certificado"
                                  onClick={() => printCertificate({ race, runner: r.runner, bib_number: r.bib_number, position: r.position, net_time_ns: r.net_time_ns || r.finish_time_ns, category: r.category, club: r.club, dni: r.runner.dni, distance_km: r.distance_km })}
                                  style={{ padding: "3px 8px", background: "transparent", border: "1px solid #363b3f", borderRadius: 4, cursor: "pointer", color: "#8a9299", fontSize: 12 }}>
                                  🖨️
                                </button>
                              </td>
                            </tr>
                          )
                        })
                    }
                  </tbody>
                </table>
              </div>
            )
          }

          {/* DNS / DNF / DQ */}
          {results?.dnf_list?.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#525a60", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
                DNS / DNF / DQ — {results.dnf_list.length} corredor{results.dnf_list.length !== 1 ? "es" : ""}
              </div>
              <div style={{ ...CARD, overflow: "hidden", padding: 0, opacity: 0.65 }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <tbody>
                    {results.dnf_list
                      .filter(r => {
                        if (genderFilter && r.runner.gender !== genderFilter) return false
                        if (catFilter && r.category !== catFilter) return false
                        if (search) {
                          const q = search.toLowerCase()
                          if (!r.runner.full_name.toLowerCase().includes(q) && !r.bib_number.includes(q)) return false
                        }
                        return true
                      })
                      .map(r => (
                        <tr key={r.bib_number} style={{ borderBottom: "1px solid #1c1f21" }}>
                          <td style={{ padding: "8px 14px", width: 64 }}>
                            <span style={{ fontFamily: "monospace", fontSize: 12, background: "#1c1f21", padding: "2px 8px", borderRadius: 3, color: "#525a60" }}>{r.bib_number}</span>
                          </td>
                          <td style={{ padding: "8px 14px", fontSize: 13 }}>{r.runner.full_name}</td>
                          <td style={{ padding: "8px 14px", fontSize: 12, color: "#525a60" }}>{r.category || "--"}</td>
                          <td style={{ padding: "8px 14px" }}><RegStatusBadge status={r.status} /></td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Vista Por Categoría */}
      {view === "categories" && (
        <div>
          {sortedCats.length === 0
            ? <div style={{ textAlign: "center", padding: 48, color: "#525a60" }}>Sin resultados para los filtros aplicados</div>
            : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 12 }}>
                {sortedCats.map(cat => {
                  const runners = byCat[cat]
                  const isFem   = cat.startsWith("F")
                  const accent  = isFem ? "#4d9fff" : "#00e5a0"
                  return (
                    <div key={cat} style={{ ...CARD }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                        <span style={{ background: accent + "20", color: accent, border: `1px solid ${accent}40`, borderRadius: 20, padding: "3px 12px", fontSize: 13, fontWeight: 700 }}>{cat}</span>
                        <span style={{ color: "#525a60", fontSize: 12 }}>{runners.length} finisher{runners.length !== 1 ? "s" : ""}</span>
                      </div>
                      {runners.map((r, i) => (
                        <div key={r.bib_number} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: i < runners.length - 1 ? "1px solid #1c1f21" : "none" }}>
                          <span style={{ fontSize: i < 3 ? 16 : 13, minWidth: 24, fontFamily: i >= 3 ? "monospace" : "inherit", color: i >= 3 ? "#525a60" : "inherit" }}>
                            {i < 3 ? MEDAL[i] : `${i + 1}.`}
                          </span>
                          <span style={{ fontFamily: "monospace", fontSize: 11, background: "#1c1f21", padding: "1px 6px", borderRadius: 3, color: "#525a60" }}>{r.bib_number}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: i < 3 ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.runner.full_name}</div>
                          </div>
                          <span style={{ fontFamily: "monospace", fontSize: 12, color: accent, fontWeight: i < 3 ? 700 : 400 }}>
                            {formatNs(r.net_time_ns || r.finish_time_ns)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            )
          }
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// RACE DETAIL PAGE — drill-in con sub-tabs por carrera
// ═══════════════════════════════════════════════════════════════════════════════

function RaceDetailPage({ race: initialRace, onBack }) {
  const [race, setRace]     = useState(initialRace)
  const [subPage, setSubPage] = useState("inscriptos")
  const [publishing, setPublishing] = useState(false)
  const [sending, setSending] = useState(false)

  const refreshRace = useCallback(() => {
    fetch(API + "/races/" + initialRace.id)
      .then(r => r.json())
      .then(setRace)
      .catch(() => {})
  }, [initialRace.id])

  const changeStatus = async (status) => {
    const r = await fetch(API + "/races/" + race.id, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      alert(err.detail || "No se puede cambiar el estado")
      return
    }
    refreshRace()
  }

  const reopenForCorrection = async () => {
    if (!confirm(`¿Reabrir "${race.name}" para corregir?\n\nLa carrera vuelve al estado "En curso" para que puedas ajustar dorsales, tiempos o estados de los corredores. Cuando termines, finalizala de nuevo.\n\nNo puede haber otra carrera en curso al mismo tiempo.`)) return
    await changeStatus("ACTIVE")
  }

  const duplicate = async () => {
    if (!confirm(`¿Duplicar "${race.name}" como nueva carrera?\n\nSe crea una copia en estado "En preparación" con los mismos inscriptos (sin tiempos ni resultados). Útil para ediciones recurrentes.`)) return
    const r = await fetch(API + "/races/" + race.id + "/duplicate", { method: "POST" })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      alert("Error al duplicar: " + (err.detail || "error desconocido"))
      return
    }
    const created = await r.json()
    alert(`Carrera duplicada: "${created.name}".\nLa encontrás en la lista de carreras.`)
    onBack()
  }

  const publish = async () => {
    // Verificar que la nube esté configurada
    const cfg = await fetch(API + "/cloud/config").then(r => r.json()).catch(() => null)
    if (!cfg || !cfg.configured) {
      alert("Primero configurá la conexión al portal en Configuración → Nube (URL + API key).")
      return
    }
    if (!confirm(`¿Publicar los resultados de "${race.name}" en el portal público?\n\nSe enviará: nombre, categoría, club, dorsal, distancia y tiempos.\nNO se envía DNI ni fecha de nacimiento.\n\nLos corredores podrán reclamar su resultado en: ${cfg.url}`)) return
    setPublishing(true)
    try {
      const r = await fetch(API + "/races/" + race.id + "/publish", { method: "POST" })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        alert("No se pudo publicar: " + (data.detail || "error desconocido"))
        return
      }
      alert(`✅ ${data.message}\n\nResultados publicados: ${data.published_results}\nCódigo de la carrera: ${data.code}\n\nLos corredores ya pueden buscarla en el portal con ese código.`)
    } catch (e) {
      alert("No se pudo publicar: " + e.message)
    } finally {
      setPublishing(false)
    }
  }

  const sendResults = async () => {
    const cfg = await fetch(API + "/email/config").then(r => r.json()).catch(() => null)
    if (!cfg || !cfg.configured) {
      alert("Primero configurá el envío de emails en Configuración → Email (API key + remitente).")
      return
    }
    if (!confirm(`¿Enviar por email el resultado a los finishers de "${race.name}"?\n\nSe enviará a cada corredor que tenga email cargado: su tiempo, posición y un link al portal.\n\nRemitente: ${cfg.from_name} <${cfg.from_email}>`)) return
    setSending(true)
    try {
      const r = await fetch(API + "/races/" + race.id + "/send-results", { method: "POST" })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        alert("No se pudo enviar: " + (data.detail || "error desconocido"))
        return
      }
      let msg = `✅ Emails enviados: ${data.sent}\n`
      if (data.no_email) msg += `Sin email (omitidos): ${data.no_email}\n`
      if (data.failed) msg += `\nFallidos: ${data.failed}\n` + (data.failed_detail || []).join("\n")
      alert(msg)
    } catch (e) {
      alert("No se pudo enviar: " + e.message)
    } finally {
      setSending(false)
    }
  }

  const SUB = [
    { id: "inscriptos", label: "Inscriptos" },
    { id: "cronometro", label: "Cronómetro" },
    { id: "resultados", label: "Resultados" },
  ]

  return (
    <div>
      {/* Header de carrera */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 0 }}>
        <button onClick={onBack} style={{ ...BTN_GHOST, marginTop: 4, flexShrink: 0 }}>← Carreras</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 20 }}>{race.name}</div>
          <div style={{ fontSize: 12, color: "#525a60", marginTop: 3 }}>
            {[race.race_date, race.location].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0, marginTop: 2 }}>
          <RaceStatusBadge status={race.status} />
          <button onClick={duplicate}
            title="Crear una copia de esta carrera con los mismos inscriptos"
            style={{ padding: "5px 12px", background: "#4d9fff15", color: "#4d9fff", border: "1px solid #4d9fff30", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
            ⧉ Duplicar
          </button>
          <button onClick={publish} disabled={publishing}
            title="Publicar los resultados en el portal público (sin DNI ni fecha de nacimiento)"
            style={{ padding: "5px 12px", background: "#00e5a015", color: "#00e5a0", border: "1px solid #00e5a030", borderRadius: 6, cursor: publishing ? "default" : "pointer", fontSize: 12, fontWeight: 600, opacity: publishing ? 0.6 : 1 }}>
            {publishing ? "Publicando…" : "☁ Publicar"}
          </button>
          <button onClick={sendResults} disabled={sending}
            title="Enviar a cada finisher su resultado por email"
            style={{ padding: "5px 12px", background: "#4d9fff15", color: "#4d9fff", border: "1px solid #4d9fff30", borderRadius: 6, cursor: sending ? "default" : "pointer", fontSize: 12, fontWeight: 600, opacity: sending ? 0.6 : 1 }}>
            {sending ? "Enviando…" : "📧 Enviar resultados"}
          </button>
          {race.status !== "FINISHED" ? (
            <button onClick={() => changeStatus("FINISHED")}
              style={{ padding: "5px 14px", background: "#f5a62315", color: "#f5a623", border: "1px solid #f5a62330", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
              ■ Finalizar carrera
            </button>
          ) : (
            <button onClick={reopenForCorrection}
              title="Reabrir la carrera para corregir resultados"
              style={{ padding: "5px 14px", background: "#00e5a015", color: "#00e5a0", border: "1px solid #00e5a030", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
              ↺ Reabrir para corregir
            </button>
          )}
        </div>
      </div>

      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #2a2e31", marginTop: 16, marginBottom: 20 }}>
        {SUB.map(s => (
          <button key={s.id} onClick={() => setSubPage(s.id)}
            style={{ padding: "10px 20px", background: "transparent", border: "none", borderBottom: subPage === s.id ? "2px solid #00e5a0" : "2px solid transparent", cursor: "pointer", color: subPage === s.id ? "#00e5a0" : "#8a9299", fontWeight: subPage === s.id ? 700 : 400, fontSize: 13, marginBottom: -1, transition: "color 0.15s" }}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Contenido del sub-tab */}
      {subPage === "inscriptos" && <InscriptosView race={race} />}
      {subPage === "cronometro" && <TimingPage race={race} />}
      {subPage === "resultados" && <ResultsDetail race={race} hideBackButton />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// PÁGINA: INICIO — dashboard del operador
// ═══════════════════════════════════════════════════════════════════════════════

function DashboardPage({ onNavigate }) {
  const [races, setRaces]     = useState([])
  const [runners, setRunners] = useState([])
  const [loading, setLoading] = useState(true)
  const [now, setNow]         = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const load = useCallback(async () => {
    try {
      const [r, rn] = await Promise.all([
        fetch(API + "/races").then(r => r.json()),
        fetch(API + "/runners").then(r => r.json()),
      ])
      setRaces(Array.isArray(r) ? r : [])
      setRunners(Array.isArray(rn) ? rn : [])
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const active   = races.filter(r => r.status === "ACTIVE")
  const finished = races.filter(r => r.status === "FINISHED")
  const planned  = races.filter(r => r.status === "PLANNED")

  const dayName = now.toLocaleDateString("es-AR", { weekday: "long" })
  const dateStr = now.toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`

  const QUICK = [
    { label: "Nueva Carrera", icon: "🏁", page: "races", desc: "Crear y gestionar carreras" },
    { label: "Atletas",       icon: "👤", page: "athletes", desc: "Base de corredores" },
    { label: "Historial",     icon: "📋", page: "history",  desc: "Resultados y estadísticas" },
  ]

  return (
    <div>
      {/* ── Bienvenida ── */}
      <div style={{ ...CARD, background: "linear-gradient(135deg, #0d1a14 0%, #141618 60%, #0d1a14 100%)", border: "1px solid #00e5a030", marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: "#00e5a060", letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>
            {dayName}, {dateStr}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#e8eaeb" }}>
            Panel de <OpGrad>Control</OpGrad>
          </div>
          <div style={{ fontSize: 13, color: "#525a60", marginTop: 4 }}>
            Sistema de cronometraje de carreras · ChronoTrack v2.0
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "monospace", fontSize: 36, fontWeight: 900, color: "#00e5a0", letterSpacing: 2, lineHeight: 1 }}>
            {timeStr}
          </div>
          <div style={{ fontSize: 10, color: "#525a60", marginTop: 4, letterSpacing: 1, textTransform: "uppercase" }}>Hora actual</div>
        </div>
      </div>

      {/* ── Stats ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Carreras totales", value: races.length,   color: "#e8eaeb", icon: "🏁" },
          { label: "Activas ahora",    value: active.length,  color: active.length > 0 ? "#00e5a0" : "#e8eaeb", icon: "▶" },
          { label: "Finalizadas",      value: finished.length, color: "#f5a623", icon: "✓" },
          { label: "Atletas en DB",    value: runners.length,  color: "#4d9fff", icon: "👤" },
        ].map(s => (
          <div key={s.label} style={{ ...CARD, textAlign: "center" }}>
            <div style={{ fontSize: 26, marginBottom: 6 }}>{s.icon}</div>
            <div style={{ fontSize: 32, fontWeight: 900, color: s.color, lineHeight: 1 }}>{loading ? "—" : s.value}</div>
            <div style={{ fontSize: 11, color: "#525a60", marginTop: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

        {/* ── Carreras activas ── */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#525a60", letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>
            {active.length > 0 ? "🟢 Carreras en curso" : "Próximas carreras"}
          </div>
          {loading ? (
            <div style={{ ...CARD, textAlign: "center", padding: 32, color: "#525a60" }}>Cargando…</div>
          ) : (active.length > 0 ? active : planned).length === 0 ? (
            <div style={{ ...CARD, textAlign: "center", padding: 32, color: "#525a60" }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>🏁</div>
              <div>No hay carreras {active.length > 0 ? "activas" : "planificadas"}</div>
              <button onClick={() => onNavigate("races")} style={{ ...BTN_PRIMARY, marginTop: 12 }}>Crear carrera</button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(active.length > 0 ? active : planned).slice(0, 4).map(race => (
                <div key={race.id} style={{ ...CARD, padding: 14, display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}
                  onClick={() => onNavigate("races", race)}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "#00e5a040"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = "#2a2e31"}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{race.name}</div>
                    <div style={{ fontSize: 11, color: "#525a60" }}>
                      {race.race_date || ""}
                    </div>
                  </div>
                  <RaceStatusBadge status={race.status} />
                  <span style={{ color: "#00e5a060", fontSize: 12 }}>→</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Accesos rápidos + últimas finalizadas ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Accesos rápidos */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#525a60", letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>Accesos rápidos</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {QUICK.map(q => (
                <div key={q.page}
                  onClick={() => onNavigate(q.page)}
                  style={{ ...CARD, padding: "12px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, transition: "border-color 0.15s" }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "#00e5a040"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = "#2a2e31"}>
                  <span style={{ fontSize: 20 }}>{q.icon}</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{q.label}</div>
                    <div style={{ fontSize: 11, color: "#525a60" }}>{q.desc}</div>
                  </div>
                  <span style={{ marginLeft: "auto", color: "#363b3f", fontSize: 14 }}>›</span>
                </div>
              ))}
            </div>
          </div>

          {/* Últimas finalizadas */}
          {finished.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#525a60", letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>Últimas finalizadas</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {finished.slice(0, 3).map(race => (
                  <div key={race.id}
                    onClick={() => onNavigate("history")}
                    style={{ ...CARD, padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = "#f5a62340"}
                    onMouseLeave={e => e.currentTarget.style.borderColor = "#2a2e31"}>
                    <span style={{ fontSize: 14 }}>🏆</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{race.name}</div>
                      <div style={{ fontSize: 11, color: "#525a60" }}>{race.race_date || "Sin fecha"}</div>
                    </div>
                    <span style={{ color: "#f5a62360", fontSize: 11 }}>Ver →</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Nota del sistema ── */}
      <div style={{ marginTop: 20, padding: "12px 16px", background: "#1c1f21", borderRadius: 6, border: "1px solid #2a2e31", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 16 }}>💡</span>
        <div style={{ fontSize: 12, color: "#525a60" }}>
          <strong style={{ color: "#8a9299" }}>Tip:</strong> En cada carrera encontrás los tabs de <strong style={{ color: "#8a9299" }}>Inscriptos</strong>, <strong style={{ color: "#8a9299" }}>Cronómetro</strong> y <strong style={{ color: "#8a9299" }}>Resultados</strong>. La categoría se calcula automáticamente al ingresar fecha de nacimiento. Desde Resultados podés imprimir el certificado de cada corredor 🖨️.
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// PÁGINA: CARRERAS — lista + drill-in
// ═══════════════════════════════════════════════════════════════════════════════

function RacesPage() {
  const [races, setRaces]       = useState([])
  const [drillRace, setDrillRace] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: "", location: "", race_date: "" })
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState("")

  const load = useCallback(() => {
    fetch(API + "/races").then(r => r.json()).then(setRaces).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  // Si hay drill activo, mostrar detalle
  if (drillRace) {
    const fresh = races.find(r => r.id === drillRace.id) || drillRace
    return <RaceDetailPage race={fresh} onBack={() => { setDrillRace(null); load() }} />
  }

  const create = async () => {
    if (!form.name) { setError("El nombre es obligatorio"); return }
    setSaving(true); setError("")
    const r = await fetch(API + "/races", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name, location: form.location || null, race_date: form.race_date || null }),
    })
    if (r.ok) { setShowForm(false); setForm({ name: "", location: "", race_date: "" }); load() }
    else { const e = await r.json(); setError(e.detail || "Error") }
    setSaving(false)
  }

  const deleteRace = async (race, e) => {
    e.stopPropagation()
    const msg = race.status === "FINISHED"
      ? `¿Eliminar "${race.name}"?\n\nSe eliminarán también todos los inscriptos, tiempos y resultados de esta carrera. Esta acción no se puede deshacer.`
      : `¿Eliminar "${race.name}"? Esta acción no se puede deshacer.`
    if (!confirm(msg)) return
    const r = await fetch(API + "/races/" + race.id, { method: "DELETE" })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      alert("Error al eliminar: " + (err.detail || "error desconocido"))
    } else load()
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 16 }}><OpGrad>Carreras</OpGrad></span>
          <span style={{ marginLeft: 10, background: "#4d9fff15", color: "#4d9fff", border: "1px solid #4d9fff30", borderRadius: 20, padding: "2px 10px", fontSize: 12 }}>{races.length}</span>
        </div>
        <button onClick={() => { setShowForm(!showForm); setError("") }} style={BTN_PRIMARY}>+ Nueva Carrera</button>
      </div>

      {showForm && (
        <div style={{ ...CARD, border: "1px solid #00e5a040", marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#00e5a0", marginBottom: 12 }}>Nueva Carrera</div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: "#525a60", marginBottom: 4, textTransform: "uppercase" }}>Nombre *</div>
              <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="ej. Media Maratón Río Cuarto" style={INPUT} onKeyDown={e => e.key === "Enter" && create()} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#525a60", marginBottom: 4, textTransform: "uppercase" }}>Lugar</div>
              <input value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} placeholder="Río Cuarto" style={INPUT} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#525a60", marginBottom: 4, textTransform: "uppercase" }}>Fecha</div>
              <input value={form.race_date} onChange={e => setForm(p => ({ ...p, race_date: e.target.value }))} style={INPUT} type="date" />
            </div>
          </div>
          {error && <div style={{ color: "#ff4d4d", fontSize: 12, marginBottom: 10, padding: "6px 10px", background: "#ff4d4d15", borderRadius: 4 }}>{error}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button onClick={() => setShowForm(false)} style={BTN_GHOST}>Cancelar</button>
            <button onClick={create} disabled={saving} style={{ ...BTN_PRIMARY, opacity: saving ? 0.6 : 1 }}>{saving ? "Creando..." : "Crear"}</button>
          </div>
        </div>
      )}

      {races.length === 0 && !showForm && (
        <div style={{ textAlign: "center", padding: 60, color: "#525a60" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🏁</div>
          <div style={{ fontSize: 14 }}>No hay carreras. Creá una para comenzar.</div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
        {races.map(race => (
          <div key={race.id}
            onClick={() => setDrillRace(race)}
            style={{ ...CARD, cursor: "pointer", transition: "border-color 0.15s, transform 0.1s", position: "relative" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "#00e5a050"; e.currentTarget.style.transform = "translateY(-1px)" }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "#2a2e31"; e.currentTarget.style.transform = "translateY(0)" }}>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 15, flex: 1, paddingRight: 8 }}>{race.name}</div>
              <button onClick={(e) => deleteRace(race, e)}
                style={{ background: "transparent", border: "none", color: "#363b3f", cursor: "pointer", fontSize: 14, padding: "0 4px", lineHeight: 1 }}
                onMouseEnter={e => e.currentTarget.style.color = "#ff4d4d"}
                onMouseLeave={e => e.currentTarget.style.color = "#363b3f"}>✕</button>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
              <RaceStatusBadge status={race.status} />
              {race.race_date && <span style={{ color: "#525a60", fontSize: 12 }}>📅 {race.race_date}</span>}
              {race.location && <span style={{ color: "#525a60", fontSize: 12 }}>📍 {race.location}</span>}
            </div>

            {race.race_start_ns && (
              <div style={{ fontSize: 11, color: "#00e5a060", marginBottom: 8 }}>✓ Largada registrada</div>
            )}

            <div style={{ marginTop: 8, fontSize: 12, color: "#00e5a070", fontWeight: 600 }}>
              Entrar →
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// PÁGINA: ATLETAS — base global de corredores (sin dorsal)
// ═══════════════════════════════════════════════════════════════════════════════

function AthletesPage() {
  const [runners, setRunners]   = useState([])
  const [search, setSearch]     = useState("")
  const [showForm, setShowForm] = useState(false)
  const [editRunner, setEditRunner] = useState(null)
  const [form, setForm] = useState({ first_name: "", last_name: "", email: "", dni: "", birth_date: "", category: "", club: "", gender: "M" })
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState("")
  const [selected, setSelected] = useState(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const load = useCallback((q = search) => {
    const url = q ? API + "/runners?search=" + encodeURIComponent(q) : API + "/runners"
    fetch(url).then(r => r.json()).then(data => { setRunners(data); setSelected(new Set()) }).catch(() => {})
  }, [search])

  useEffect(() => { load("") }, [])

  useEffect(() => {
    const t = setTimeout(() => load(search), 280)
    return () => clearTimeout(t)
  }, [search])

  const resetForm = () => {
    setForm({ first_name: "", last_name: "", email: "", dni: "", birth_date: "", category: "", club: "", gender: "M" })
    setEditRunner(null); setError("")
  }

  const startEdit = (r) => {
    setEditRunner(r)
    setForm({ first_name: r.first_name, last_name: r.last_name, email: r.email || "", dni: r.dni || "", birth_date: r.birth_date || "", category: r.category || "", club: r.club || "", gender: r.gender || "M" })
    setShowForm(true)
  }

  const save = async () => {
    if (!form.first_name || !form.last_name) { setError("Nombre y apellido son obligatorios"); return }
    setSaving(true); setError("")
    const url    = editRunner ? API + "/runners/" + editRunner.id : API + "/runners"
    const method = editRunner ? "PATCH" : "POST"
    const r = await fetch(url, {
      method, headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    })
    if (r.ok) { load(search); setShowForm(false); resetForm() }
    else { const e = await r.json(); setError(e.detail || "Error") }
    setSaving(false)
  }

  const deleteRunner = async (runner) => {
    if (!confirm(`¿Eliminar a ${runner.full_name}? Si está inscripto en carreras no se podrá eliminar.`)) return
    const r = await fetch(API + "/runners/" + runner.id, { method: "DELETE" })
    if (!r.ok) alert("No se puede eliminar: el atleta tiene inscripciones en alguna carrera.")
    else load(search)
  }

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === runners.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(runners.map(r => r.id)))
    }
  }

  const bulkDelete = async () => {
    if (selected.size === 0) return
    if (!confirm(`¿Eliminar ${selected.size} atleta${selected.size > 1 ? "s" : ""} de la base de datos?\n\nSolo se eliminarán los que no tengan inscripciones en carreras.`)) return
    setBulkDeleting(true)
    let deleted = 0, skipped = 0
    // Eliminar de a uno para manejar errores por FK individualmente
    await Promise.all([...selected].map(async (id) => {
      const r = await fetch(API + "/runners/" + id, { method: "DELETE" })
      r.ok ? deleted++ : skipped++
    }))
    setBulkDeleting(false)
    load(search)
    if (skipped > 0) alert(`${deleted} eliminado${deleted !== 1 ? "s" : ""}. ${skipped} no se pudo${skipped !== 1 ? "n" : ""} eliminar porque tienen inscripciones en carreras.`)
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 16 }}><OpGrad>Atletas</OpGrad></span>
          <span style={{ marginLeft: 10, background: "#4d9fff15", color: "#4d9fff", border: "1px solid #4d9fff30", borderRadius: 20, padding: "2px 10px", fontSize: 12 }}>{runners.length}</span>
          <span style={{ marginLeft: 8, fontSize: 12, color: "#525a60" }}>— base global de corredores</span>
        </div>
        <button onClick={() => { setShowForm(!showForm); resetForm() }} style={BTN_PRIMARY}>+ Nuevo atleta</button>
      </div>

      {showForm && (
        <div style={{ ...CARD, border: "1px solid #00e5a040", marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#00e5a0", marginBottom: 12 }}>
            {editRunner ? `Editar: ${editRunner.full_name}` : "Nuevo atleta"}
          </div>
          <div style={{ fontSize: 12, color: "#525a60", marginBottom: 12 }}>
            El dorsal se asigna al inscribirlo en cada carrera — aquí solo se guarda la información personal.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: "#525a60", marginBottom: 4, textTransform: "uppercase" }}>Nombre *</div>
              <input value={form.first_name} onChange={e => setForm(p => ({ ...p, first_name: e.target.value }))} placeholder="Carlos" style={INPUT} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#525a60", marginBottom: 4, textTransform: "uppercase" }}>Apellido *</div>
              <input value={form.last_name} onChange={e => setForm(p => ({ ...p, last_name: e.target.value }))} placeholder="Méndez" style={INPUT} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#525a60", marginBottom: 4, textTransform: "uppercase" }}>DNI</div>
              <input value={form.dni} onChange={e => setForm(p => ({ ...p, dni: e.target.value }))} placeholder="12345678" style={INPUT} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#525a60", marginBottom: 4, textTransform: "uppercase" }}>Género</div>
              <select value={form.gender} onChange={e => {
                const gender = e.target.value
                setForm(p => ({ ...p, gender, category: autoCategory(p.birth_date, gender) || p.category }))
              }} style={{ ...INPUT }}>
                <option value="M">Masculino</option>
                <option value="F">Femenino</option>
                <option value="X">Otro</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#525a60", marginBottom: 4, textTransform: "uppercase" }}>Club</div>
              <input value={form.club} onChange={e => setForm(p => ({ ...p, club: e.target.value }))} placeholder="RC Runners" style={INPUT} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: "#525a60", marginBottom: 4, textTransform: "uppercase" }}>Email <span style={{ color: "#363b3f" }}>(para enviar resultados)</span></div>
              <input value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="corredor@email.com" style={INPUT} type="email" />
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#525a60", marginBottom: 4, textTransform: "uppercase" }}>Fecha de nacimiento</div>
              <input value={form.birth_date} onChange={e => {
                const birth_date = e.target.value
                setForm(p => ({ ...p, birth_date, category: autoCategory(birth_date, p.gender) || p.category }))
              }} style={INPUT} type="date" />
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#525a60", marginBottom: 4, textTransform: "uppercase" }}>
                Categoría {form.birth_date && <span style={{ color: "#00e5a060" }}>(auto)</span>}
              </div>
              <input
                value={form.category}
                onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                placeholder={form.birth_date ? autoCategory(form.birth_date, form.gender) || "—" : "ej. M30-34"}
                style={{ ...INPUT, color: form.birth_date && autoCategory(form.birth_date, form.gender) ? "#00e5a0" : "#e8eaeb" }}
              />
            </div>
            {form.birth_date && calcAge(form.birth_date) !== null && (
              <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 2 }}>
                <div style={{ background: "#1c1f21", border: "1px solid #363b3f", borderRadius: 6, padding: "7px 10px", color: "#8a9299", fontSize: 13, width: "100%", textAlign: "center" }}>
                  <span style={{ color: "#e8eaeb", fontWeight: 700 }}>{calcAge(form.birth_date)}</span> años
                </div>
              </div>
            )}
          </div>
          {error && <div style={{ color: "#ff4d4d", fontSize: 12, marginBottom: 10, padding: "6px 10px", background: "#ff4d4d15", borderRadius: 4 }}>{error}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button onClick={() => { setShowForm(false); resetForm() }} style={BTN_GHOST}>Cancelar</button>
            <button onClick={save} disabled={saving} style={{ ...BTN_PRIMARY, opacity: saving ? 0.6 : 1 }}>{saving ? "Guardando..." : editRunner ? "Actualizar" : "Crear"}</button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre o DNI…" style={{ ...INPUT, maxWidth: 280 }} />
        {selected.size > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 14px", background: "#ff4d4d15", border: "1px solid #ff4d4d30", borderRadius: 8, marginLeft: "auto" }}>
            <span style={{ fontSize: 13, color: "#ff4d4d", fontWeight: 600 }}>
              {selected.size} seleccionado{selected.size > 1 ? "s" : ""}
            </span>
            <button
              onClick={bulkDelete}
              disabled={bulkDeleting}
              style={{ padding: "4px 14px", background: "#ff4d4d", border: "none", borderRadius: 5, cursor: "pointer", color: "#fff", fontWeight: 700, fontSize: 12, opacity: bulkDeleting ? 0.6 : 1 }}>
              {bulkDeleting ? "Eliminando..." : "🗑 Eliminar seleccionados"}
            </button>
            <button onClick={() => setSelected(new Set())} style={{ ...BTN_GHOST, padding: "4px 10px", fontSize: 12 }}>Cancelar</button>
          </div>
        )}
      </div>

      <div style={{ ...CARD, overflow: "hidden", padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #2a2e31" }}>
              <th style={{ padding: "8px 14px", width: 36 }}>
                <input
                  type="checkbox"
                  checked={runners.length > 0 && selected.size === runners.length}
                  ref={el => { if (el) el.indeterminate = selected.size > 0 && selected.size < runners.length }}
                  onChange={toggleAll}
                  style={{ cursor: "pointer", accentColor: "#00e5a0" }}
                />
              </th>
              {["Nombre", "DNI", "Edad", "Género", "Categoría", "Club", ""].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "8px 14px", fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: "#525a60" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runners.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: "center", padding: 32, color: "#525a60" }}>{search ? "Sin resultados" : "No hay atletas registrados"}</td></tr>
            ) : runners.map(r => {
              const isSelected = selected.has(r.id)
              const age = calcAge(r.birth_date)
              return (
                <tr key={r.id} style={{ borderBottom: "1px solid #1c1f21", background: isSelected ? "#ff4d4d08" : "transparent" }}>
                  <td style={{ padding: "9px 14px" }}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(r.id)}
                      style={{ cursor: "pointer", accentColor: "#00e5a0" }}
                    />
                  </td>
                  <td style={{ padding: "9px 14px", fontSize: 13, fontWeight: 500 }}>{r.full_name}</td>
                  <td style={{ padding: "9px 14px", fontSize: 12, color: "#8a9299", fontFamily: "monospace" }}>{r.dni || "--"}</td>
                  <td style={{ padding: "9px 14px", fontSize: 12, color: "#8a9299" }}>{age !== null ? `${age} a` : "--"}</td>
                  <td style={{ padding: "9px 14px", color: r.gender === "F" ? "#4d9fff" : "#525a60", fontSize: 12 }}>{r.gender || "--"}</td>
                  <td style={{ padding: "9px 14px" }}>
                    <span style={{ background: r.category?.startsWith("F") ? "#4d9fff15" : "#00e5a015", color: r.category?.startsWith("F") ? "#4d9fff" : "#00e5a0", border: "1px solid " + (r.category?.startsWith("F") ? "#4d9fff30" : "#00e5a030"), borderRadius: 20, padding: "2px 8px", fontSize: 11 }}>
                      {r.category || "--"}
                    </span>
                  </td>
                  <td style={{ padding: "9px 14px", fontSize: 13, color: "#8a9299" }}>{r.club || "--"}</td>
                  <td style={{ padding: "9px 14px", textAlign: "right" }}>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <button onClick={() => startEdit(r)} style={{ ...BTN_GHOST, fontSize: 11, padding: "3px 10px" }}>Editar</button>
                      <button onClick={() => deleteRunner(r)} style={BTN_DANGER}>✕</button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// HISTORIAL — todas las carreras con sus resultados
// ═══════════════════════════════════════════════════════════════════════════════

function HistorialPage() {
  const [races, setRaces]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [drillRace, setDrillRace] = useState(null)

  const loadRaces = useCallback(() => {
    setLoading(true)
    fetch(API + "/races")
      .then(r => r.json())
      .then(data => { setRaces(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { loadRaces() }, [loadRaces])

  if (drillRace) {
    const fresh = races.find(r => r.id === drillRace.id) || drillRace
    return <ResultsDetail race={fresh} onBack={() => setDrillRace(null)} />
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 16 }}><OpGrad>Historial</OpGrad> de Carreras</span>
          <span style={{ marginLeft: 10, background: "#4d9fff15", color: "#4d9fff", border: "1px solid #4d9fff30", borderRadius: 20, padding: "2px 10px", fontSize: 12 }}>
            {races.length} carrera{races.length !== 1 ? "s" : ""}
          </span>
        </div>
        <button onClick={loadRaces} style={BTN_GHOST}>↻ Actualizar</button>
      </div>

      {loading && <div style={{ textAlign: "center", padding: 48, color: "#525a60" }}>Cargando…</div>}

      {!loading && races.length === 0 && (
        <div style={{ textAlign: "center", padding: 60, color: "#525a60" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 14 }}>No hay carreras. Creá una en la sección Carreras.</div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
        {races.map(race => (
          <RaceResultCard key={race.id} race={race} onOpen={() => setDrillRace(race)} />
        ))}
      </div>
    </div>
  )
}

function RaceResultCard({ race, onOpen }) {
  const [stats, setStats] = useState(null)

  useEffect(() => {
    fetch(API + "/races/" + race.id + "/results")
      .then(r => r.json())
      .then(d => setStats({ finishers: d.total_finishers, registered: d.total_registered, dnf: d.dnf_list.length }))
      .catch(() => {})
  }, [race.id])

  const pct = stats && stats.registered > 0
    ? Math.round((stats.finishers / stats.registered) * 100)
    : 0

  return (
    <div style={{ ...CARD, cursor: "pointer", transition: "border-color 0.15s" }}
      onClick={onOpen}
      onMouseEnter={e => e.currentTarget.style.borderColor = "#00e5a060"}
      onMouseLeave={e => e.currentTarget.style.borderColor = "#2a2e31"}>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 15, flex: 1, paddingRight: 8 }}>{race.name}</div>
        <RaceStatusBadge status={race.status} />
      </div>

      <div style={{ fontSize: 12, color: "#525a60", marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
        {race.race_date && <span>📅 {race.race_date}</span>}
        {race.location && <span>📍 {race.location}</span>}
      </div>

      {stats ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
            {[
              ["Finishers", stats.finishers, "#00e5a0"],
              ["Inscritos", stats.registered, null],
              ["DNS/DNF",   stats.dnf,        stats.dnf > 0 ? "#f5a623" : null],
            ].map(([label, val, color]) => (
              <div key={label} style={{ background: "#1c1f21", borderRadius: 6, padding: "8px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: color || "#e8eaeb" }}>{val}</div>
                <div style={{ fontSize: 10, color: "#525a60", textTransform: "uppercase" }}>{label}</div>
              </div>
            ))}
          </div>
          <div style={{ background: "#1c1f21", borderRadius: 4, height: 6, marginBottom: 12, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: "#00e5a0", borderRadius: 4, transition: "width 0.4s" }} />
          </div>
          <div style={{ fontSize: 11, color: "#525a60", marginBottom: 12 }}>
            {pct}% completado {stats.finishers > 0 && `· ${stats.finishers} finisher${stats.finishers !== 1 ? "s" : ""}`}
          </div>
        </>
      ) : (
        <div style={{ height: 80, display: "flex", alignItems: "center", justifyContent: "center", color: "#363b3f", fontSize: 12 }}>
          Cargando estadísticas…
        </div>
      )}

      <button style={{ ...BTN_PRIMARY, width: "100%", padding: "8px 0", fontSize: 13 }}>
        Ver resultados →
      </button>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// APP PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

function EmailControls() {
  const [open, setOpen]   = useState(false)
  const [cfg, setCfg]     = useState(null)
  const [fromEmail, setFromEmail] = useState("")
  const [fromName, setFromName]   = useState("ChronoTrack")
  const [key, setKey]     = useState("")
  const [busy, setBusy]   = useState(false)
  const [testTo, setTestTo] = useState("")

  const loadCfg = useCallback(() => {
    fetch(API + "/email/config").then(r => r.json()).then(d => {
      setCfg(d); setFromEmail(d.from_email || ""); setFromName(d.from_name || "ChronoTrack")
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
    } catch (e) { alert("Error: " + e.message) } finally { setBusy(false) }
  }

  const sendTest = async () => {
    if (!testTo.trim()) { alert("Ingresá un email para la prueba."); return }
    setBusy(true)
    try {
      const r = await fetch(API + "/email/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: testTo.trim() }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.detail || "Error")
      alert("✅ Email de prueba enviado a " + testTo.trim())
    } catch (e) { alert("No se pudo enviar la prueba: " + e.message) } finally { setBusy(false) }
  }

  const btn = { width: "100%", padding: "7px 8px", marginBottom: 6, fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: "pointer", border: "1px solid #2a2e31", background: "#1c1f21", color: "#8a9299", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }
  const inp = { width: "100%", padding: "8px 10px", marginTop: 4, marginBottom: 12, fontSize: 13, borderRadius: 6, border: "1px solid #2a2e31", background: "#0d0f10", color: "#e8eaeb", boxSizing: "border-box" }
  const lbl = { fontSize: 11, color: "#8a9299", fontWeight: 600 }

  return (
    <>
      <button onClick={openModal} style={btn} title="Configurar el envío de emails de resultados">
        📧 Emails {cfg?.configured ? "✓" : ""}
      </button>
      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "#000a", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 460, maxHeight: "90vh", overflowY: "auto", background: "#141618", border: "1px solid #2a2e31", borderRadius: 10, padding: 24, color: "#e8eaeb" }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Envío de emails (Brevo)</div>
            <div style={{ fontSize: 12, color: "#8a9299", marginBottom: 16, lineHeight: 1.5 }}>
              Creá una cuenta gratis en <span style={{ color: "#4d9fff" }}>brevo.com</span>, verificá tu email remitente y pegá tu API key (Settings → SMTP &amp; API → API Keys). 300 emails/día gratis.
            </div>
            <div style={lbl}>Nombre del remitente</div>
            <input value={fromName} onChange={e => setFromName(e.target.value)} placeholder="Mi Club / Organización" style={inp} />
            <div style={lbl}>Email remitente (verificado en Brevo)</div>
            <input value={fromEmail} onChange={e => setFromEmail(e.target.value)} placeholder="resultados@miclub.com" style={inp} type="email" />
            <div style={lbl}>API key de Brevo</div>
            <input value={key} onChange={e => setKey(e.target.value)} type="password" placeholder={cfg?.configured ? `Guardada (${cfg.api_key_masked}) — dejá vacío para mantener` : "xkeysib-..."} style={inp} />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setOpen(false)} style={{ ...btn, width: "auto", padding: "8px 16px", margin: 0 }}>Cerrar</button>
              <button onClick={save} disabled={busy} style={{ ...btn, width: "auto", padding: "8px 16px", margin: 0, background: "#00e5a020", color: "#00e5a0", border: "1px solid #00e5a040" }}>{busy ? "Guardando…" : "Guardar"}</button>
            </div>
            <div style={{ borderTop: "1px solid #2a2e31", margin: "16px 0 12px" }} />
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

function CloudControls() {
  const [open, setOpen] = useState(false)
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
      alert("Error: " + e.message)
    } finally {
      setBusy(false)
    }
  }

  const btn = {
    width: "100%", padding: "7px 8px", marginBottom: 6, fontSize: 11, fontWeight: 600,
    borderRadius: 6, cursor: "pointer", border: "1px solid #2a2e31",
    background: "#1c1f21", color: "#8a9299", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
  }
  const inp = {
    width: "100%", padding: "8px 10px", marginTop: 4, marginBottom: 12, fontSize: 13,
    borderRadius: 6, border: "1px solid #2a2e31", background: "#0d0f10", color: "#e8eaeb", boxSizing: "border-box",
  }
  const lbl = { fontSize: 11, color: "#8a9299", fontWeight: 600 }

  return (
    <>
      <button onClick={openModal} style={btn} title="Configurar la conexión al portal público">
        ☁ Portal en la nube {cfg?.configured ? "✓" : ""}
      </button>

      {open && (
        <div onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, background: "#000a", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: 440, background: "#141618", border: "1px solid #2a2e31", borderRadius: 10, padding: 24, color: "#e8eaeb" }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Portal en la nube</div>
            <div style={{ fontSize: 12, color: "#8a9299", marginBottom: 18 }}>
              Configurá dónde se publican los resultados. La API key se guarda sólo en este equipo.
            </div>

            <div style={lbl}>URL del portal</div>
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://mi-portal.com" style={inp} />

            <div style={lbl}>API key de publicación</div>
            <input value={key} onChange={e => setKey(e.target.value)} type="password"
              placeholder={cfg?.configured ? `Guardada (${cfg.api_key_masked}) — dejá vacío para mantener` : "Pegá la API key"}
              style={inp} />

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <button onClick={() => setOpen(false)} style={{ ...btn, width: "auto", padding: "8px 16px", margin: 0 }}>Cancelar</button>
              <button onClick={save} disabled={busy}
                style={{ ...btn, width: "auto", padding: "8px 16px", margin: 0, background: "#00e5a020", color: "#00e5a0", border: "1px solid #00e5a040" }}>
                {busy ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function BackupControls() {
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)

  const doBackup = () => {
    window.open(API + "/backup", "_blank")
  }

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ""  // permitir re-seleccionar el mismo archivo
    if (!file) return
    if (!confirm(`¿Restaurar desde "${file.name}"?\n\nEsto reemplaza TODOS los datos actuales. Se guardará una copia de seguridad del estado actual antes de reemplazar.`)) return
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch(API + "/restore", { method: "POST", body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || "No se pudo restaurar")
      alert((data.message || "Respaldo restaurado.") + "\n\nLa aplicación se recargará.")
      window.location.reload()
    } catch (err) {
      alert("Error al restaurar: " + err.message)
    } finally {
      setBusy(false)
    }
  }

  const btn = {
    width: "100%", padding: "7px 8px", marginBottom: 6, fontSize: 11, fontWeight: 600,
    borderRadius: 6, cursor: busy ? "wait" : "pointer", border: "1px solid #2a2e31",
    background: "#1c1f21", color: "#8a9299", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
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

export default function App() {
  const [page, setPage]   = useState("home")
  const [clock, setClock] = useState("")
  const [showConfig, setShowConfig] = useState(false)

  useEffect(() => {
    const t = setInterval(() => {
      const n = new Date()
      setClock(`${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}.${pad(n.getMilliseconds(), 3)}`)
    }, 33)
    return () => clearInterval(t)
  }, [])

  // onNavigate: permite al Dashboard navegar a otras secciones
  const navigate = useCallback((p) => setPage(p), [])

  const PAGES = [
    { id: "races",    label: "Carreras",  icon: "🏁" },
    { id: "athletes", label: "Atletas",   icon: "👤" },
    { id: "history",  label: "Historial", icon: "📋" },
  ]

  const pageLabel = page === "home" ? "Inicio" : (PAGES.find(p => p.id === page)?.label || "")

  return (
    <div style={{ display: "flex", height: "100vh", background: "#0d0f10", color: "#e8eaeb", fontFamily: "system-ui, sans-serif", overflow: "hidden" }}>

      {/* Sidebar */}
      <div style={{ width: 190, background: "#141618", borderRight: "1px solid #2a2e31", display: "flex", flexDirection: "column", flexShrink: 0 }}>

        {/* Logo — clickeable → Inicio */}
        <div
          onClick={() => setPage("home")}
          style={{ padding: "18px 16px 14px", borderBottom: "1px solid #2a2e31", cursor: "pointer", userSelect: "none" }}
          onMouseEnter={e => e.currentTarget.style.background = "#1c1f21"}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
          <div style={{ fontWeight: 700, fontSize: 20, color: "#00e5a0" }}>CHRONO<span style={{ color: "#8a9299", fontWeight: 400 }}>TRACK</span></div>
          <div style={{ fontSize: 10, color: "#525a60", letterSpacing: 1.5, textTransform: "uppercase", marginTop: 2 }}>Race Timing System</div>
        </div>

        <nav style={{ flex: 1, padding: "12px 8px" }}>
          {/* Inicio */}
          <div onClick={() => setPage("home")}
            style={{ padding: "9px 10px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600, marginBottom: 2, background: page === "home" ? "#00e5a020" : "transparent", color: page === "home" ? "#00e5a0" : "#8a9299", border: `1px solid ${page === "home" ? "#00e5a040" : "transparent"}`, display: "flex", alignItems: "center", gap: 8 }}>
            <span>🏠</span><span>Inicio</span>
          </div>

          <div style={{ height: 1, background: "#2a2e31", margin: "8px 4px" }} />

          {PAGES.map(p => (
            <div key={p.id} onClick={() => setPage(p.id)}
              style={{ padding: "9px 10px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600, marginBottom: 2, background: page === p.id ? "#00e5a020" : "transparent", color: page === p.id ? "#00e5a0" : "#8a9299", border: `1px solid ${page === p.id ? "#00e5a040" : "transparent"}`, display: "flex", alignItems: "center", gap: 8 }}>
              <span>{p.icon}</span>
              <span>{p.label}</span>
            </div>
          ))}
        </nav>

        <div style={{ padding: "12px 12px", borderTop: "1px solid #2a2e31" }}>
          <button
            onClick={() => setShowConfig(v => !v)}
            style={{
              width: "100%", padding: "8px 10px", marginBottom: showConfig ? 8 : 0,
              fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: "pointer",
              border: `1px solid ${showConfig ? "#00e5a040" : "#2a2e31"}`,
              background: showConfig ? "#00e5a020" : "#1c1f21",
              color: showConfig ? "#00e5a0" : "#8a9299",
              display: "flex", alignItems: "center", gap: 8,
            }}
            title="Nube, email y respaldos">
            <span>⚙️</span><span>Configuración</span>
            <span style={{ marginLeft: "auto", fontSize: 10 }}>{showConfig ? "▾" : "▸"}</span>
          </button>
          {showConfig && (
            <div>
              <CloudControls />
              <EmailControls />
              <BackupControls />
            </div>
          )}
          <div style={{ fontSize: 10, color: "#363b3f", textAlign: "center", marginTop: 8 }}>v2.4</div>
        </div>
      </div>

      {/* Contenido principal */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Top bar */}
        <div style={{ height: 52, borderBottom: "1px solid #2a2e31", display: "flex", alignItems: "center", padding: "0 24px", background: "#141618", flexShrink: 0 }}>
          <span style={{ fontWeight: 700, fontSize: 17 }}>{pageLabel}</span>
          <div style={{ marginLeft: "auto", fontFamily: "monospace", fontSize: 16, color: "#00e5a0", letterSpacing: 1 }}>{clock}</div>
        </div>
        {/* Página activa */}
        <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
          {page === "home"     && <DashboardPage onNavigate={navigate} />}
          {page === "races"    && <RacesPage />}
          {page === "athletes" && <AthletesPage />}
          {page === "history"  && <HistorialPage />}
        </div>
      </div>
    </div>
  )
}
