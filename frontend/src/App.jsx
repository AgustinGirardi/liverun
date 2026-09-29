import { useState, useEffect, useRef, useCallback } from "react"

const API = "/api/v1"
const APP_VERSION = __APP_VERSION__ // inyectada por Vite desde version.txt

function getWsBase() {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${proto}//${window.location.host}/api/v1`
}

// ── Utilidades ────────────────────────────────────────────────────────────────

function pad(n, l = 2) { return String(n).padStart(l, "0") }

// "2026-09-13" -> "13 sep 2026". Se parsea a mano: new Date("2026-09-13") toma
// UTC y en Argentina corre el día para atrás.
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "")
  if (!m || +m[2] < 1 || +m[2] > 12) return iso || ""
  return `${+m[3]} ${MESES[+m[2] - 1]} ${m[1]}`
}

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
  html, body { width: 210mm; height: 297mm; background: #fff; font-family: "Segoe UI", system-ui, sans-serif; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

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
  .race-card { background: #f9fafb; border: 1px solid #e5e7eb; border-top: 2px solid #00e5a0; border-radius: 6px; padding: 16px 20px; margin: 20px 0; }
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
      <div class="logo-text">LIVE<span>RUN</span></div>
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
      <div class="footer-logo">LIVE<span>RUN</span></div>
      <div style="font-size:9px;color:#9ca3af;margin-top:2px;letter-spacing:1px">RACE TIMING SYSTEM · v${APP_VERSION}</div>
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
  body { font-family: "Segoe UI", system-ui, sans-serif; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

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
    <div class="logo-text">LIVE<span>RUN</span></div>
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
    <span>LiveRun · Race Timing System</span>
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

// ── Tokens de marca — Dirección A "Pista nocturna" ──────────────────────────────
// Fuente de verdad de color/tipografía/radios. Los CSS vars equivalentes viven en
// index.css (:root); estas constantes JS son para los estilos inline de React.
const C = {
  bg: "#0d0f10", surface: "#141618", surface2: "#1c1f21",
  line: "#262b2e", lineStrong: "#363b3f",
  fg: "#e8eaeb", muted: "#9aa1a7", faint: "#868e94",
  accent: "#00e5a0", accent2: "#00bf85", onAccent: "#06281d",
  blue: "#4d9fff", gold: "#f5a623", danger: "#ff4d4d",
}
// Podio: plata y bronce (el oro es C.gold)
const SILVER = "#aabbcc"
const BRONZE = "#cd7c4a"
const FONT_DISPLAY = 'ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, sans-serif'
const FONT_NUM = { fontVariantNumeric: "tabular-nums", fontFeatureSettings: '"tnum" 1' }
const RADIUS = { card: 16, hero: 20, pill: 999, sm: 8 }

// ── Estilos compartidos ───────────────────────────────────────────────────────

const INPUT = {
  background: C.surface2, border: `1px solid ${C.lineStrong}`, borderRadius: RADIUS.sm,
  padding: "8px 12px", color: C.fg, fontSize: 13, outline: "none", width: "100%",
}
const BTN_PRIMARY = {
  padding: "8px 18px", background: C.accent, border: "none",
  borderRadius: RADIUS.pill, cursor: "pointer", fontWeight: 800, fontSize: 12,
  color: C.onAccent, fontFamily: FONT_DISPLAY, letterSpacing: 0.2,
}
const BTN_GHOST = {
  padding: "8px 14px", background: "transparent", border: `1px solid ${C.lineStrong}`,
  borderRadius: RADIUS.pill, cursor: "pointer", color: C.muted, fontSize: 12, fontWeight: 600,
}
const BTN_DANGER = {
  padding: "4px 8px", background: "transparent", border: `1px solid ${C.line}`,
  borderRadius: RADIUS.sm, cursor: "pointer", color: C.danger, fontSize: 11,
}
const CARD = {
  background: C.surface, border: `1px solid ${C.line}`, borderRadius: RADIUS.card, padding: 16,
}

// ── Íconos ────────────────────────────────────────────────────────────────────
// Trazo único de 2px en grilla de 24, heredan el color del texto. Reemplazan a
// los emojis, que cambiaban de estilo según el sistema y no seguían el color.
const ICONS = {
  home:     <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>,
  flag:     <><path d="M5 22V4" /><path d="M5 4h13l-2.5 4.5L18 13H5" /></>,
  user:     <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  list:     <><path d="M9 6h12M9 12h12M9 18h12" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></>,
  settings: <><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  pin:      <><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
  timer:    <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5M9 2h6" /></>,
  pause:    <><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></>,
  stop:     <rect x="6" y="6" width="12" height="12" rx="2" />,
  trophy:   <><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" /></>,
  cloud:    <><path d="M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 8" /><path d="M12 12v8M9 15l3-3 3 3" /></>,
  mail:     <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  copy:     <><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
  undo:     <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></>,
  x:        <path d="M18 6 6 18M6 6l12 12" />,
  download: <path d="M12 4v12M7 11l5 5 5-5M5 20h14" />,
  upload:   <path d="M12 20V8M7 13l5-5 5 5M5 4h14" />,
  file:     <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></>,
  refresh:  <><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" /><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" /><path d="M21 3v5h-5M3 21v-5h5" /></>,
  pencil:   <path d="M4 20h4L19 9l-4-4L4 16z" />,
  lock:     <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  trash:    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  logout:   <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  alert:    <><path d="M12 3 2 21h20z" /><path d="M12 10v5M12 18h.01" /></>,
  check:    <path d="m5 12 5 5 9-10" />,
  chevronR: <path d="m9 6 6 6-6 6" />,
  chevronD: <path d="m6 9 6 6 6-6" />,
  printer:  <><path d="M6 9V3h12v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M7 14h10v7H7z" /></>,
}
function Icon({ name, size = 16, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ flexShrink: 0, verticalAlign: "-0.15em", ...style }}>
      {ICONS[name]}
    </svg>
  )
}
// Botón con ícono + texto alineados.
const WITH_ICON = { display: "inline-flex", alignItems: "center", gap: 6 }

// ── StatusBadge ───────────────────────────────────────────────────────────────

const RACE_STATUS = {
  PLANNED:  { bg: `${C.blue}15`, color: C.blue, border: `${C.blue}30`, label: "En preparación" },
  ACTIVE:   { bg: `${C.accent}15`, color: C.accent, border: `${C.accent}30`, label: "En curso" },
  FINISHED: { bg: `${C.gold}15`, color: C.gold, border: `${C.gold}30`, label: "Finalizada" },
}
const REG_STATUS = {
  OK:  { color: C.faint,  label: "OK" },
  DNS: { color: C.muted,  label: "DNS" },
  DNF: { color: C.gold,  label: "DNF" },
  DQ:  { color: C.danger,  label: "DQ" },
}

// "hace 3 min" en rioplatense. El backend guarda UTC sin zona: se le agrega la Z
// para que el navegador no lo lea como hora local.
function timeAgo(iso) {
  if (!iso) return ""
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z")
  const min = Math.floor((Date.now() - d.getTime()) / 60000)
  if (min < 1) return "recién"
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const dias = Math.floor(h / 24)
  if (dias === 1) return "ayer"
  if (dias <= 7) return `hace ${dias} días`
  const pad = n => String(n).padStart(2, "0")
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

// Chip de publicación: guarda el "hace X" fresco con su propio timer, así el
// padre no re-renderiza entero cada minuto.
function PublishedChip({ race }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 60000)
    return () => clearInterval(t)
  }, [])
  const copy = () => {
    navigator.clipboard.writeText(race.published_code || "")
      .then(() => notify("Código copiado", { kind: "success" }))
      .catch(() => notify("No se pudo copiar el código", { kind: "error" }))
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 6px 4px 10px", background: C.surface2, border: `1px solid ${C.lineStrong}`, borderRadius: RADIUS.pill, color: C.muted, fontSize: 12, whiteSpace: "nowrap" }}>
      <span>{race.status === "PLANNED" ? "Anunciado" : "Publicado"}</span>
      {race.published_code && (
        <>
          <span aria-hidden="true">·</span>
          <span>código</span>
          <span style={{ ...FONT_NUM, fontFamily: "ui-monospace, Consolas, monospace", color: C.fg, fontWeight: 700 }}>{race.published_code}</span>
          <button onClick={copy} title="Copiar código" aria-label="Copiar código"
            style={{ display: "inline-flex", alignItems: "center", padding: 3, background: "transparent", border: "none", color: C.muted, cursor: "pointer" }}>
            <Icon name="copy" size={13} />
          </button>
        </>
      )}
      <span aria-hidden="true">·</span>
      <span>{timeAgo(race.published_at)}</span>
    </span>
  )
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
  const [error, setError]         = useState("")
  const wsRef     = useRef(null)
  const timerRef  = useRef(null)
  const activeRef = useRef(true)

  // Estado persistido: al abrir y en cada reconexión, para no perder lo que
  // pasó mientras el socket estuvo caído.
  const reload = useCallback(() => {
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
          distance_km: r.distance_km ?? null,
        }))
      ))
      .catch(() => {})
  }, [raceId])

  useEffect(() => { reload() }, [reload])

  const connect = useCallback(() => {
    if (!raceId || !activeRef.current) return
    const ws = new WebSocket(getWsBase() + "/ws/races/" + raceId + "/timing")
    wsRef.current = ws
    ws.onopen  = () => { if (activeRef.current) { setConnected(true); reload() } }
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
            distance_km: data.distance_km ?? null,
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
      } else if (event === "ERROR") {
        setError(data.message || "Error del motor de tiempos")
      }
    }
  }, [raceId, reload])

  useEffect(() => {
    activeRef.current = true
    connect()
    return () => {
      activeRef.current = false
      clearTimeout(timerRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  // Devuelve false si el mensaje no salió, para que la UI no dé por hecho algo
  // que nunca llegó al servidor.
  const send = useCallback((msg) => {
    if (wsRef.current?.readyState !== 1) {
      setError("Sin conexión con el servidor: la acción no se registró. Reintentá en unos segundos.")
      return false
    }
    wsRef.current.send(JSON.stringify(msg))
    return true
  }, [])

  // La llegada es el dato que no se puede recuperar: si el socket está caído
  // se captura por HTTP y se agrega a la cola directamente.
  const capture = useCallback(async () => {
    if (wsRef.current?.readyState === 1) { send({ action: "capture" }); return }
    try {
      const r = await fetch(API + "/races/" + raceId + "/capture", { method: "POST" })
      if (!r.ok) throw new Error()
      const c = await r.json()
      setQueue(prev => prev.some(i => i.id === c.id) ? prev
        : [{ id: c.id, captured_ns: c.captured_ns, sequence_order: c.sequence_order }, ...prev])
    } catch {
      setError("No se pudo registrar la llegada: el servidor no responde.")
    }
  }, [raceId, send])
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

  return { queue, finishers, connected, error, clearError: () => setError(""), capture, assignBib, undoAssign, discard, bibLookup }
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
    if (!(await ask({ title: "Quitar inscripto", message: `¿Quitar a ${reg.runner.full_name} (dorsal ${reg.bib_number}) de esta carrera?`, confirmLabel: "Quitar", danger: true }))) return
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
    if (!(await ask({ title: "Eliminar inscriptos", message: `¿Eliminar ${selected.size} inscripto${selected.size > 1 ? "s" : ""}? Esta acción no se puede deshacer.`, confirmLabel: "Eliminar", danger: true }))) return
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
    background: active ? `${C.blue}20` : "transparent",
    color: active ? C.blue : C.muted,
    borderColor: active ? `${C.blue}40` : C.lineStrong,
    fontWeight: active ? 700 : 400,
  })

  return (
    <div>
      {/* Banner de carrera finalizada */}
      {locked && (
        <div style={{ background: "#0f0f0f", border: `1px solid ${C.gold}40`, borderRadius: 8, padding: "12px 18px", marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
          <Icon name="lock" size={20} style={{ color: C.muted }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: C.gold }}>Carrera finalizada — solo lectura</div>
            <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>No se pueden agregar, modificar ni eliminar inscripciones.</div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Inscriptos</span>
          <span style={{ background: `${C.blue}15`, color: C.blue, border: `1px solid ${C.blue}30`, borderRadius: 20, padding: "2px 10px", fontSize: 12 }}>{registrations.length}</span>
          {statusCounts.DNS > 0 && <span style={{ background: `${C.muted}15`, color: C.muted, border: `1px solid ${C.muted}30`, borderRadius: 20, padding: "2px 8px", fontSize: 11 }}>DNS: {statusCounts.DNS}</span>}
          {statusCounts.DNF > 0 && <span style={{ background: `${C.gold}15`, color: C.gold, border: `1px solid ${C.gold}30`, borderRadius: 20, padding: "2px 8px", fontSize: 11 }}>DNF: {statusCounts.DNF}</span>}
          {statusCounts.DQ  > 0 && <span style={{ background: `${C.danger}15`, color: C.danger, border: `1px solid ${C.danger}30`, borderRadius: 20, padding: "2px 8px", fontSize: 11 }}>DQ: {statusCounts.DQ}</span>}
        </div>
        {!locked && (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setShowImport(!showImport); setImportResult(null) }} style={{ ...BTN_GHOST, ...WITH_ICON }}><Icon name="upload" size={13} />Importar</button>
            <button onClick={() => { setShowAdd(!showAdd); resetAdd() }} style={BTN_PRIMARY}>+ Inscribir</button>
          </div>
        )}
      </div>

      {/* Panel importación */}
      {!locked && showImport && (
        <div style={{ ...CARD, border: `1px solid ${C.blue}30`, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.blue, marginBottom: 8 }}>Importar desde Excel / CSV</div>
          <div style={{ fontSize: 12, color: C.faint, marginBottom: 12 }}>
            Columnas requeridas: <code style={{ background: C.surface2, padding: "2px 6px", borderRadius: 3, color: C.fg }}>dorsal, nombre, apellido</code>
            {" "}· Opcionales: <code style={{ background: C.surface2, padding: "2px 6px", borderRadius: 3, color: C.fg }}>distancia, categoria, club, genero, dni, email</code>
            {" "}· Los atletas ya existentes se reutilizan automáticamente.
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={e => { setImportFile(e.target.files[0]); setImportResult(null) }} style={{ flex: 1, ...INPUT }} />
            <button onClick={doImport} disabled={!importFile || importing} style={{ ...BTN_PRIMARY, opacity: (!importFile || importing) ? 0.6 : 1 }}>{importing ? "Importando..." : "Importar"}</button>
            <button onClick={() => setShowImport(false)} style={BTN_GHOST}>Cerrar</button>
          </div>
          {importResult && (
            <div style={{ marginTop: 12, padding: "10px 14px", background: C.surface2, borderRadius: 6 }}>
              <span style={{ color: C.accent, fontSize: 13, marginRight: 16 }}>✓ {importResult.created} inscriptos</span>
              <span style={{ color: C.faint, fontSize: 13, marginRight: 16 }}>⊘ {importResult.skipped} ya existían</span>
              {importResult.errors.map((e, i) => <div key={i} style={{ color: C.danger, fontSize: 12, marginTop: 4 }}>{e}</div>)}
            </div>
          )}
        </div>
      )}

      {/* Panel inscribir */}
      {!locked && showAdd && (
        <div style={{ ...CARD, border: `1px solid ${C.accent}40`, marginBottom: 16 }}>
          {/* Tabs: Buscar existente / Nuevo */}
          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            <button onClick={() => { setAddMode("search"); setAddError("") }} style={TAB_BTN(addMode === "search")}>Buscar atleta existente</button>
            <button onClick={() => { setAddMode("new"); setAddError("") }} style={TAB_BTN(addMode === "new")}>Nuevo atleta</button>
          </div>

          {addMode === "search" && (
            <div>
              <div style={{ fontSize: 12, color: C.faint, marginBottom: 12 }}>
                Buscá al atleta por nombre. Si ya corrió en otra carrera, sus datos personales estarán guardados.
              </div>

              {!selectedRunner ? (
                <div style={{ position: "relative" }}>
                  <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Buscar por nombre</div>
                  <input
                    value={runnerQuery}
                    onChange={e => setRunnerQuery(e.target.value)}
                    placeholder="ej. Carlos Mendez"
                    style={{ ...INPUT, maxWidth: 340 }}
                    autoFocus
                  />
                  {runnerResults.length > 0 && (
                    <div style={{ position: "absolute", top: "100%", left: 0, right: 0, maxWidth: 340, background: C.surface2, border: `1px solid ${C.lineStrong}`, borderRadius: 6, boxShadow: "0 4px 20px #00000060", zIndex: 10, maxHeight: 240, overflowY: "auto", marginTop: 4 }}>
                      {runnerResults.map(r => (
                        <div key={r.id}
                          onClick={() => { setSelectedRunner(r); setRunnerQuery(""); setRunnerResults([]) }}
                          style={{ padding: "10px 14px", cursor: "pointer", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 10 }}
                          onMouseEnter={e => e.currentTarget.style.background = C.line}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{r.full_name}</div>
                            <div style={{ fontSize: 11, color: C.faint }}>
                              {[r.category, r.club, r.gender].filter(Boolean).join(" · ")}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {runnerQuery.length >= 2 && runnerResults.length === 0 && (
                    <div style={{ marginTop: 8, fontSize: 12, color: C.faint }}>
                      Sin resultados. Podés{" "}
                      <span onClick={() => setAddMode("new")} style={{ color: C.accent, cursor: "pointer", textDecoration: "underline" }}>crear un nuevo atleta</span>.
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div style={{ background: C.surface2, border: `1px solid ${C.accent}30`, borderRadius: 8, padding: "12px 16px", flex: 1, minWidth: 200 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{selectedRunner.full_name}</div>
                    <div style={{ fontSize: 12, color: C.muted }}>
                      {[selectedRunner.category, selectedRunner.club, selectedRunner.gender].filter(Boolean).join(" · ")}
                    </div>
                    <button onClick={() => setSelectedRunner(null)} style={{ ...BTN_GHOST, fontSize: 11, marginTop: 8, padding: "3px 10px" }}>Cambiar</button>
                  </div>
                  <div style={{ minWidth: 120 }}>
                    <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Dorsal *</div>
                    <input
                      value={bibForExisting}
                      onChange={e => setBibForExisting(e.target.value)}
                      placeholder="ej. 101"
                      style={{ ...INPUT, fontFamily: "monospace", fontWeight: 700, fontSize: 16, color: C.accent, textAlign: "center" }}
                      onKeyDown={e => e.key === "Enter" && addExisting()}
                      autoFocus
                    />
                  </div>
                  <div style={{ minWidth: 100 }}>
                    <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Distancia (km)</div>
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
              <div style={{ fontSize: 12, color: C.faint, marginBottom: 12 }}>
                El atleta se guardará en la base de datos global. El dorsal solo aplica a esta carrera.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "80px 80px 1fr 1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Dorsal *</div>
                  <input value={newForm.bib_number} onChange={e => setNewForm(p => ({ ...p, bib_number: e.target.value }))}
                    placeholder="101" style={{ ...INPUT, fontFamily: "monospace", fontWeight: 700, color: C.accent, textAlign: "center" }} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Dist. km</div>
                  <input value={newForm.distance_km} onChange={e => setNewForm(p => ({ ...p, distance_km: e.target.value }))}
                    placeholder="10" style={{ ...INPUT, textAlign: "center" }} type="number" step="0.5" />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Nombre *</div>
                  <input value={newForm.first_name} onChange={e => setNewForm(p => ({ ...p, first_name: e.target.value }))} placeholder="Carlos" style={INPUT} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Apellido *</div>
                  <input value={newForm.last_name} onChange={e => setNewForm(p => ({ ...p, last_name: e.target.value }))} placeholder="Méndez" style={INPUT} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>DNI</div>
                  <input value={newForm.dni} onChange={e => setNewForm(p => ({ ...p, dni: e.target.value }))} placeholder="12345678" style={INPUT} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Género</div>
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
                  <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Fecha de nacimiento</div>
                  <input value={newForm.birth_date} onChange={e => {
                    const birth_date = e.target.value
                    setNewForm(p => ({ ...p, birth_date, category: autoCategory(birth_date, p.gender) }))
                  }} style={INPUT} type="date" />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>
                    Categoría {newForm.birth_date && <span style={{ color: C.muted }}>(auto)</span>}
                  </div>
                  <input
                    value={newForm.category}
                    onChange={e => setNewForm(p => ({ ...p, category: e.target.value }))}
                    placeholder={newForm.birth_date ? autoCategory(newForm.birth_date, newForm.gender) || "—" : "ej. M30-34"}
                    style={{ ...INPUT, color: newForm.birth_date && autoCategory(newForm.birth_date, newForm.gender) ? C.accent : C.fg }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Club</div>
                  <input value={newForm.club} onChange={e => setNewForm(p => ({ ...p, club: e.target.value }))} placeholder="RC Runners" style={INPUT} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Email</div>
                  <input value={newForm.email} onChange={e => setNewForm(p => ({ ...p, email: e.target.value }))} placeholder="corredor@email.com" style={INPUT} type="email" />
                </div>
                {newForm.birth_date && calcAge(newForm.birth_date) !== null && (
                  <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 2 }}>
                    <div style={{ background: C.surface2, border: `1px solid ${C.lineStrong}`, borderRadius: 6, padding: "7px 10px", color: C.muted, fontSize: 13, width: "100%", textAlign: "center" }}>
                      <span style={{ color: C.fg, fontWeight: 700 }}>{calcAge(newForm.birth_date)}</span> años
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {addError && <div style={{ color: C.danger, fontSize: 12, marginBottom: 10, padding: "6px 10px", background: `${C.danger}15`, borderRadius: 4 }}>{addError}</div>}

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
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 14px", background: `${C.danger}15`, border: `1px solid ${C.danger}30`, borderRadius: 8, marginLeft: "auto" }}>
            <span style={{ fontSize: 13, color: C.danger, fontWeight: 600 }}>
              {selected.size} seleccionado{selected.size > 1 ? "s" : ""}
            </span>
            <button
              onClick={bulkDelete}
              disabled={bulkDeleting}
              style={{ padding: "4px 14px", background: C.danger, border: "none", borderRadius: 5, cursor: "pointer", color: "#fff", fontWeight: 700, fontSize: 12, opacity: bulkDeleting ? 0.6 : 1 }}>
              {bulkDeleting ? "Eliminando..." : "Eliminar seleccionados"}
            </button>
            <button onClick={() => setSelected(new Set())} style={{ ...BTN_GHOST, padding: "4px 10px", fontSize: 12 }}>Cancelar</button>
          </div>
        )}
      </div>

      {/* Tabla */}
      <div style={{ ...CARD, overflow: "hidden", padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.line}` }}>
              {!locked && (
                <th style={{ padding: "8px 14px", width: 36 }}>
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selected.size === filtered.length}
                    ref={el => { if (el) el.indeterminate = selected.size > 0 && selected.size < filtered.length }}
                    onChange={toggleAll}
                    style={{ cursor: "pointer", accentColor: C.accent }}
                  />
                </th>
              )}
              {["Dorsal", "Dist.", "Nombre", "Categoría", "Club", "Estado"].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "8px 14px", fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: C.faint }}>{h}</th>
              ))}
              {!locked && <th />}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={locked ? 6 : 8} style={{ textAlign: "center", padding: 32, color: C.faint }}>{search ? "Sin resultados" : "No hay inscriptos aún"}</td></tr>
            ) : filtered.map(r => {
              const isSelected = selected.has(r.id)
              const dist = r.distance_km
              const statusInfo = REG_STATUS[r.status] || REG_STATUS.OK
              return (
                <tr key={r.id} style={{ borderBottom: `1px solid ${C.surface2}`, opacity: r.status !== "OK" ? 0.65 : 1, background: isSelected ? `${C.danger}08` : "transparent" }}>
                  {!locked && (
                    <td style={{ padding: "9px 14px" }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(r.id)}
                        style={{ cursor: "pointer", accentColor: C.accent }}
                      />
                    </td>
                  )}
                  <td style={{ padding: "9px 14px" }}>
                    <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, background: C.surface2, padding: "2px 10px", borderRadius: 4, color: C.accent }}>{r.bib_number}</span>
                  </td>
                  <td style={{ padding: "9px 14px" }}>
                    {dist ? <span style={{ background: `${C.blue}15`, color: C.blue, border: `1px solid ${C.blue}30`, borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>{dist} km</span> : <span style={{ color: C.faint, fontSize: 12 }}>--</span>}
                  </td>
                  <td style={{ padding: "9px 14px", fontSize: 13, fontWeight: 500 }}>{r.runner.full_name}</td>
                  <td style={{ padding: "9px 14px" }}>
                    <span style={{ background: r.runner.category?.startsWith("F") ? `${C.blue}15` : `${C.accent}15`, color: r.runner.category?.startsWith("F") ? C.blue : C.accent, border: "1px solid " + (r.runner.category?.startsWith("F") ? `${C.blue}30` : `${C.accent}30`), borderRadius: 20, padding: "2px 8px", fontSize: 11 }}>
                      {r.runner.category || "--"}
                    </span>
                  </td>
                  <td style={{ padding: "9px 14px", fontSize: 13, color: C.muted }}>{r.runner.club || "--"}</td>
                  <td style={{ padding: "9px 14px" }}>
                    {locked
                      ? <span style={{ background: statusInfo.color + "20", color: statusInfo.color, border: `1px solid ${statusInfo.color}40`, borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>{statusInfo.label}</span>
                      : <select value={r.status} onChange={e => setStatus(r, e.target.value)}
                          style={{ background: C.surface2, border: `1px solid ${C.lineStrong}`, borderRadius: 4, padding: "3px 6px", color: REG_STATUS[r.status]?.color || C.fg, fontSize: 12, outline: "none", cursor: "pointer" }}>
                          <option value="OK">OK</option>
                          <option value="DNS">DNS — No largó</option>
                          <option value="DNF">DNF — No terminó</option>
                          <option value="DQ">DQ — Descalificado</option>
                        </select>
                    }
                  </td>
                  {!locked && (
                    <td style={{ padding: "9px 14px", textAlign: "right" }}>
                      <button onClick={() => deleteReg(r)} style={BTN_DANGER} aria-label="Eliminar"><Icon name="x" size={12} /></button>
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

// Tiempo de carrera con centésimas. Escribe directo en su nodo en cada cuadro:
// un setState a 60 fps re-renderizaba toda la app y metía demora al tipear.
function RaceClock({ startNs, style }) {
  const ref = useRef(null)
  useEffect(() => {
    let raf
    const startMs = Math.floor(startNs / 1_000_000)
    const tick = () => {
      const d = Math.max(0, Date.now() - startMs)
      if (ref.current) ref.current.textContent =
        `${pad(Math.floor(d / 3600000))}:${pad(Math.floor(d % 3600000 / 60000))}:${pad(Math.floor(d % 60000 / 1000))}.${pad(Math.floor(d % 1000 / 10))}`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [startNs])
  return <span ref={ref} style={style} />
}

// Hora del día: referencia secundaria, sin centésimas para no competir con el
// tiempo de carrera.
function WallClock({ style }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return <span style={style}>{pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}</span>
}

// Ritmo en min/km ("4:52 /km"); vacío si falta tiempo neto o distancia.
function formatPace(netNs, km) {
  if (!netNs || !km) return ""
  const secPerKm = Math.round(netNs / 1e9 / km)
  return `${Math.floor(secPerKm / 60)}:${String(secPerKm % 60).padStart(2, "0")} /km`
}

// Clasificación agrupada por distancia. La posición se calcula acá (por tiempo
// neto dentro de cada grupo) porque la del servidor queda vieja si después se
// asigna a alguien que cruzó antes.
function Standings({ finishers, onCorrect }) {
  const timeOf = f => f.net_time_ns || f.capture_ns
  const byDist = new Map()
  finishers.forEach(f => {
    const k = f.distance_km ?? null
    if (!byDist.has(k)) byDist.set(k, [])
    byDist.get(k).push(f)
  })
  // Ascendente por distancia; los que no tienen distancia van al final
  const keys = [...byDist.keys()].sort((a, b) => (a === null) - (b === null) || a - b)
  const showHeaders = keys.length > 1
  const podium = [C.gold, SILVER, BRONZE]

  return keys.map((k, gi) => {
    const rows = byDist.get(k).slice().sort((a, b) => timeOf(a) - timeOf(b))
    return (
      <div key={k ?? "none"} style={{ marginTop: showHeaders && gi > 0 ? 20 : 0 }}>
        {showHeaders && (
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: C.muted, padding: "0 0 6px", borderBottom: `1px solid ${C.lineStrong}`, display: "flex", justifyContent: "space-between" }}>
            <span>{k === null ? "" : `${k} km`}</span>
            <span>{rows.length}</span>
          </div>
        )}
        {rows.map((f, i) => (
          <div key={f.capture_id ?? `b${f.bib_number}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: `1px solid ${C.surface2}` }}>
            <span style={{ ...FONT_NUM, fontFamily: "monospace", fontSize: 13, color: i < 3 ? podium[i] : C.faint, fontWeight: i < 3 ? 700 : 400, minWidth: 22 }}>{i + 1}</span>
            <span style={{ fontFamily: "monospace", fontSize: 11, background: C.surface2, padding: "1px 6px", borderRadius: 3, color: C.muted }}>{f.bib_number}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.runner?.full_name || "--"}</div>
              <div style={{ fontSize: 11, color: C.faint }}>{f.runner?.category || ""}</div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ ...FONT_NUM, fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 13, color: C.fg }}>{formatNs(timeOf(f))}</div>
              {formatPace(f.net_time_ns, f.distance_km) && (
                <div style={{ ...FONT_NUM, fontSize: 11, color: C.muted }}>{formatPace(f.net_time_ns, f.distance_km)}</div>
              )}
              {onCorrect && f.capture_id && (
                <button onClick={() => onCorrect(f.capture_id)} title="Quitar el dorsal y devolver la llegada a la cola para reasignarla"
                  style={{ padding: "1px 0", background: "transparent", color: C.gold, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, ...WITH_ICON, gap: 4 }}><Icon name="pencil" size={11} />Corregir</button>
              )}
            </div>
          </div>
        ))}
      </div>
    )
  })
}

function TimingPage({ race, onRaceChange, onFinish }) {
  const raceId = race?.id
  const { queue: rawQueue, finishers, connected, error, clearError, capture, assignBib, undoAssign, discard, bibLookup } = useTimingEngine(raceId)
  // La más vieja arriba: es la próxima que hay que asignar, en el orden en que cruzaron.
  const queue = [...rawQueue].sort((a, b) => a.sequence_order - b.sequence_order)
  const [hints, setHints] = useState({})
  const [raceStartNs, setRaceStartNs] = useState(race?.race_start_ns || null)

  useEffect(() => {
    if (!raceId) return
    fetch(API + "/races/" + raceId)
      .then(r => r.json())
      .then(d => setRaceStartNs(d.race_start_ns || null))
      .catch(() => {})
  }, [raceId])

  // ESPACIO captura siempre, también mientras se tipea un dorsal: los dorsales
  // no llevan espacios y el operador no puede soltar el teclado cuando llega
  // otro corredor. Sólo se respeta en campos de texto que no son de dorsal.
  useEffect(() => {
    const h = (e) => {
      if (e.code !== "Space") return
      const el = document.activeElement
      const isBib = el?.classList?.contains("bib-input")
      if (!isBib && ["INPUT", "TEXTAREA", "SELECT"].includes(el?.tagName)) return
      e.preventDefault()
      if (e.repeat) return // mantener apretado no genera ráfagas de capturas
      if (el?.tagName === "BUTTON") el.blur()
      capture()
    }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [capture])

  // Descartar no pide confirmación: un confirm() nativo congela la página (ESPACIO
  // deja de capturar) y ESPACIO/ENTER lo aceptan por reflejo. La fila se oculta
  // y el descarte se envía recién a los 8 s, salvo que se deshaga antes.
  const [discarding, setDiscarding] = useState(null) // { id, seq }
  const discardTimer = useRef(null)
  const commitDiscard = useCallback((d) => {
    clearTimeout(discardTimer.current)
    setDiscarding(null)
    if (d) discard(d.id)
  }, [discard])
  const askDiscard = (item) => {
    commitDiscard(discarding)
    const d = { id: item.id, seq: item.sequence_order }
    setDiscarding(d)
    discardTimer.current = setTimeout(() => commitDiscard(d), 8000)
  }
  const pendingRef = useRef(null)
  useEffect(() => { pendingRef.current = discarding }, [discarding])
  useEffect(() => () => { // al salir de la pantalla, lo pendiente se confirma
    clearTimeout(discardTimer.current)
    if (pendingRef.current) discard(pendingRef.current.id)
  }, [discard])
  const visibleQueue = discarding ? queue.filter(i => i.id !== discarding.id) : queue

  // Si el foco no está en un dorsal, llevarlo a la captura pendiente más vieja
  // para poder tipear el número apenas se captura.
  const queueKey = visibleQueue.map(i => i.id).join(",")
  useEffect(() => {
    if (document.activeElement?.tagName === "INPUT") return
    document.querySelector(".bib-input")?.focus()
  }, [queueKey])

  // El aviso de conexión espera 2 s: al abrir la pantalla el socket tarda un
  // instante y no tiene sentido alarmar por eso.
  // Cada corte arranca su propio timer; el cleanup (al volver la conexión) rearma graceOver en false.
  const [graceOver, setGraceOver] = useState(false)
  useEffect(() => {
    if (connected) return
    const t = setTimeout(() => setGraceOver(true), 2000)
    return () => { clearTimeout(t); setGraceOver(false) }
  }, [connected])
  const offline = !connected && graceOver

  const handleInput = async (id, val) => {
    setHints(p => ({ ...p, [id]: null }))
    if (!val) return
    const r = await bibLookup(val)
    setHints(p => ({ ...p, [id]: r }))
  }

  // No se limpia el campo: si el servidor acepta, la fila desaparece sola; si
  // rechaza el dorsal, queda escrito para corregirlo.
  const handleAssign = (id) => {
    const inp = document.getElementById("bib-" + id)
    const bib = inp?.value.trim()
    if (bib) assignBib(id, bib)
  }

  const startRace = async () => {
    if (raceStartNs) { notify("La largada ya fue registrada", { kind: "info" }); return }
    if (!(await ask({ title: "Registrar largada", message: "Los tiempos netos se van a medir desde este instante. Hacelo en el momento exacto de la largada.", confirmLabel: "Registrar largada" }))) return
    const r = await fetch(API + "/races/" + raceId + "/start", { method: "POST" })
    const data = await r.json()
    if (r.ok) { setRaceStartNs(data.race_start_ns); onRaceChange?.() }
    else notify(data.detail || "Error", { kind: "error" })
  }

  if (!race) return (
    <div style={{ textAlign: "center", padding: 60, color: C.faint }}>Seleccioná una carrera</div>
  )

  // ── Carrera finalizada: solo mostrar clasificación final ──
  if (race.status === "FINISHED") {
    return (
      <div>
        <div style={{ background: "#0f0f0f", border: `1px solid ${C.gold}40`, borderRadius: RADIUS.hero, padding: "20px 24px", marginBottom: 20, display: "flex", alignItems: "center", gap: 16 }}>
          <Icon name="trophy" size={32} style={{ color: C.gold }} />
          <div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 17, color: C.gold, marginBottom: 4 }}>Carrera finalizada</div>
            <div style={{ fontSize: 13, color: C.faint }}>El cronómetro está cerrado. Consultá los resultados en la pestaña <strong style={{ color: C.muted }}>Resultados</strong>.</div>
          </div>
        </div>
        <div style={{ ...CARD }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: C.muted, marginBottom: 12, display: "flex", alignItems: "center" }}>
            Clasificación <span style={{ marginLeft: 4 }}>final</span>
            <span style={{ marginLeft: "auto", background: `${C.blue}15`, color: C.blue, border: `1px solid ${C.blue}30`, borderRadius: 20, padding: "2px 8px", fontSize: 11 }}>{finishers.length} finishers</span>
          </div>
          {finishers.length === 0
            ? <div style={{ textAlign: "center", padding: 32, color: C.faint }}>Sin tiempos registrados</div>
            : <Standings finishers={finishers} />
          }
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      {/* ── Banner de estado de largada ── */}
      {!raceStartNs ? (
        <div style={{ background: "#1a1200", border: `2px solid ${C.gold}`, borderRadius: RADIUS.hero, padding: "14px 20px", display: "flex", alignItems: "center", gap: 16 }}>
          <Icon name="pause" size={26} style={{ color: C.gold }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 15, color: C.gold, marginBottom: 2 }}>Carrera sin largada oficial</div>
            <div style={{ fontSize: 12, color: "#b8a878" }}>Los tiempos se cuentan desde que se capture la primera llegada. Registrá la largada para medir tiempos netos reales.</div>
          </div>
          <button onClick={startRace}
            style={{ padding: "10px 24px", background: C.gold, border: "none", borderRadius: RADIUS.pill, cursor: "pointer", color: "#000", fontWeight: 800, fontFamily: FONT_DISPLAY, fontSize: 14, letterSpacing: 0.5, flexShrink: 0 }}>
            <span style={WITH_ICON}><Icon name="flag" size={16} />Registrar largada</span>
          </button>
        </div>
      ) : (
        <div style={{ background: C.surface, border: `1px solid ${C.lineStrong}`, borderRadius: RADIUS.hero, padding: "14px 20px", display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 15, color: C.fg, marginBottom: 2 }}>Carrera en curso</div>
            <div style={{ fontSize: 12, color: C.muted }}>Largada registrada: los tiempos se miden desde ese momento</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <RaceClock startNs={raceStartNs} style={{ display: "block", fontFamily: FONT_DISPLAY, ...FONT_NUM, fontSize: 44, fontWeight: 800, color: C.accent, lineHeight: 1, letterSpacing: -0.5 }} />
            <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Tiempo de carrera</div>
          </div>
          {/* Cerrar la carrera vive donde está el operador el día de la
              carrera, no escondido en la cabecera. */}
          <button onClick={onFinish}
            title="Cerrar el cronómetro y pasar la carrera a Finalizadas"
            style={{ padding: "10px 18px", background: "transparent", border: `1px solid ${C.gold}`, borderRadius: RADIUS.pill, cursor: "pointer", color: C.gold, fontWeight: 800, fontFamily: FONT_DISPLAY, fontSize: 13, flexShrink: 0 }}>
            <span style={WITH_ICON}><Icon name="stop" size={14} />Finalizar carrera</span>
          </button>
        </div>
      )}

      {offline && (
        <div role="status" style={{ background: `${C.danger}15`, border: `1px solid ${C.danger}60`, borderRadius: RADIUS.sm, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, color: C.fg, fontSize: 14 }}>
          <Icon name="alert" size={18} style={{ color: C.danger, flexShrink: 0 }} />
          <span><strong>Sin conexión en vivo, reconectando.</strong> ESPACIO sigue capturando llegadas; asignar y descartar vuelven cuando se recupere la conexión.</span>
        </div>
      )}

      {/* El error queda hasta que el operador lo cierra: si se iba solo, una
          acción fallida durante un pelotón pasaba sin que nadie la viera. */}
      {error && (
        <div role="alert" style={{ background: `${C.danger}15`, border: `1px solid ${C.danger}60`, borderRadius: RADIUS.sm, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, color: C.danger, fontSize: 14 }}>
          <span style={{ flex: 1 }}>{error}</span>
          <button onClick={clearError} aria-label="Cerrar aviso"
            style={{ background: "transparent", border: "none", color: C.danger, cursor: "pointer", padding: 4, display: "flex" }}><Icon name="x" size={16} /></button>
        </div>
      )}

      {discarding && (
        <div role="status" style={{ background: C.surface2, border: `1px solid ${C.lineStrong}`, borderRadius: RADIUS.sm, padding: "8px 8px 8px 14px", display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
          <span style={{ flex: 1 }}>Llegada #{discarding.seq} descartada.</span>
          <button onClick={() => { clearTimeout(discardTimer.current); setDiscarding(null) }}
            style={{ ...BTN_GHOST, color: C.fg, padding: "6px 14px" }}>Deshacer</button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16 }}>

      {/* Columna izquierda */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <button onClick={capture}
          style={{ width: "100%", padding: 20, fontSize: 18, fontWeight: 800, fontFamily: FONT_DISPLAY, background: C.accent, border: "none", borderRadius: RADIUS.pill, cursor: "pointer", color: C.onAccent, letterSpacing: 1 }}>
          <span style={{ ...WITH_ICON, gap: 10 }}><Icon name="timer" size={22} />Capturar llegada</span>
        </button>

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ fontSize: 12, color: C.muted }}>
            <kbd style={{ background: C.surface2, border: `1px solid ${C.lineStrong}`, borderRadius: 3, padding: "1px 6px", fontFamily: "monospace", fontSize: 11 }}>ESPACIO</kbd> captura (también mientras escribís un dorsal) ·{" "}
            <kbd style={{ background: C.surface2, border: `1px solid ${C.lineStrong}`, borderRadius: 3, padding: "1px 6px", fontFamily: "monospace", fontSize: 11 }}>ENTER</kbd> asigna y pasa a la siguiente
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <div aria-hidden="true" style={{ width: 10, height: 10, borderRadius: "50%", background: connected ? C.accent : C.danger }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: connected ? C.muted : C.danger }}>{connected ? "Conectado" : "Reconectando…"}</span>
          </div>
        </div>

        <div style={{ ...CARD, flex: 1, overflow: "auto" }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: C.muted, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
            Cola de capturas
            {visibleQueue.length > 0 && (
              <span style={{ marginLeft: "auto", background: `${C.gold}15`, color: C.gold, border: `1px solid ${C.gold}30`, borderRadius: 20, padding: "2px 8px", fontSize: 11 }}>
                {visibleQueue.length} pendiente{visibleQueue.length > 1 ? "s" : ""}
              </span>
            )}
          </div>

          {visibleQueue.length === 0 && (
            <div style={{ textAlign: "center", padding: 32, color: C.faint }}>
              {connected ? "Presioná ESPACIO para capturar llegadas" : "Sin conexión — reconectando..."}
            </div>
          )}

          {visibleQueue.map(item => (
            <div key={item.id} style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 6, padding: "8px 12px", display: "flex", alignItems: "center", gap: 12, marginBottom: 6, maxWidth: 820 }}>
              <span style={{ ...FONT_NUM, fontSize: 12, color: C.faint, minWidth: 28 }}>#{item.sequence_order}</span>
              <span style={{ ...FONT_NUM, fontFamily: "monospace", fontSize: 15, color: C.fg, minWidth: 110 }}>
                {raceStartNs ? formatNs(item.captured_ns - raceStartNs) : formatNs(item.captured_ns)}
              </span>
              <input
                id={"bib-" + item.id}
                className="bib-input"
                placeholder="Dorsal"
                aria-label={`Dorsal de la llegada #${item.sequence_order}`}
                onInput={e => handleInput(item.id, e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAssign(item.id)}
                style={{ width: 104, background: C.bg, border: `1px solid ${C.lineStrong}`, borderRadius: 4, padding: "6px 8px", fontFamily: "monospace", fontSize: 22, fontWeight: 700, color: C.fg, textAlign: "center", outline: "none" }}
                autoComplete="off"
              />
              <span style={{ flex: 1, fontSize: 16, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                color: hints[item.id]?.already_finished ? C.gold : hints[item.id]?.found ? C.accent : hints[item.id] ? C.danger : C.faint }}>
                {hints[item.id]?.already_finished
                  ? `Ya registrado — ${hints[item.id].runner?.full_name || ""}`
                  : hints[item.id]?.found
                    ? hints[item.id].runner.full_name
                    : hints[item.id] ? "No encontrado" : "--"}
              </span>
              <button onClick={() => handleAssign(item.id)}
                style={{ padding: "8px 14px", background: "transparent", color: C.fg, border: `1px solid ${C.lineStrong}`, borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>Asignar</button>
              {/* Separado de Asignar para que un clic apurado no caiga en el otro. */}
              <button onClick={() => askDiscard(item)}
                title="Descartar captura (fue un error)" aria-label={`Descartar llegada #${item.sequence_order}`}
                style={{ marginLeft: 20, padding: 8, background: "transparent", color: C.faint, border: "none", borderRadius: 6, cursor: "pointer", display: "flex" }}
                onMouseEnter={e => e.currentTarget.style.color = C.danger}
                onMouseLeave={e => e.currentTarget.style.color = C.faint}><Icon name="trash" size={16} /></button>
            </div>
          ))}

        </div>
      </div>

      {/* Columna derecha: Clasificación en vivo */}
      <div style={{ ...CARD, overflow: "auto" }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: C.muted, marginBottom: 12, display: "flex", alignItems: "center" }}>
          Clasificación <span style={{ marginLeft: 4 }}>en vivo</span>
          <span style={{ marginLeft: "auto", background: `${C.blue}15`, color: C.blue, border: `1px solid ${C.blue}30`, borderRadius: 20, padding: "2px 8px", fontSize: 11 }}>{finishers.length}</span>
        </div>
        {finishers.length === 0
          ? <div style={{ textAlign: "center", padding: 24, color: C.faint, fontSize: 13 }}>Sin finishers aún</div>
          : <Standings finishers={finishers} onCorrect={undoAssign} />
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

  // Oro / plata / bronce: el puesto en color, con el mismo peso que el resto de la tabla.
  const MEDAL_COLOR = [C.gold, "#aabbcc", "#cd7c4a"]

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
    background: active ? `${C.accent}20` : "transparent",
    color: active ? C.accent : C.muted,
    borderColor: active ? `${C.accent}40` : C.lineStrong,
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
            <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>
              {[formatDate(race.race_date), race.location].filter(Boolean).join(" · ")}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginBottom: 12 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: C.faint, cursor: "pointer" }}>
          <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
          Auto-actualizar
        </label>
        <button onClick={load} style={{ ...BTN_GHOST, ...WITH_ICON }}><Icon name="refresh" size={13} />Actualizar</button>
        <button onClick={() => window.open(API + "/races/" + race.id + "/export/csv", "_blank")} style={{ ...BTN_GHOST, ...WITH_ICON }}><Icon name="download" size={13} />CSV</button>
        <button onClick={() => results && printResultsReport({ race, results })} disabled={!results} style={{ ...BTN_GHOST, ...WITH_ICON }}><Icon name="file" size={13} />Reporte PDF</button>
      </div>

      {/* Stats */}
      {results && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
          {[
            ["Finishers",  results.total_finishers,  C.accent],
            ["Inscritos",  results.total_registered, null],
            ["Pendientes", Math.max(0, results.total_registered - results.total_finishers - results.dnf_list.length), null],
            ["DNS/DNF/DQ", results.dnf_list.length,  results.dnf_list.length > 0 ? C.gold : null],
          ].map(([label, val, color]) => (
            <div key={label} style={{ ...CARD }}>
              <div style={{ fontSize: 26, fontWeight: 700, color: color || C.fg }}>{val}</div>
              <div style={{ fontSize: 11, color: C.faint, marginTop: 3, textTransform: "uppercase" }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Selector de distancia (solo si hay múltiples) ── */}
      {hasMultiDist && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: C.faint, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>Distancia</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button onClick={() => { setDistFilter(null); setCatFilter("") }}
              style={{ padding: "7px 18px", fontSize: 13, fontWeight: distFilter === null ? 800 : 500, borderRadius: RADIUS.pill, cursor: "pointer", border: "2px solid", background: distFilter === null ? `${C.accent}20` : "transparent", color: distFilter === null ? C.accent : C.muted, borderColor: distFilter === null ? C.accent : C.lineStrong }}>
              Todas
            </button>
            {availDistances.map(d => (
              <button key={d} onClick={() => { setDistFilter(d); setCatFilter("") }}
                style={{ padding: "7px 18px", fontSize: 13, fontWeight: distFilter === d ? 800 : 500, borderRadius: RADIUS.pill, cursor: "pointer", border: "2px solid", background: distFilter === d ? `${C.blue}20` : "transparent", color: distFilter === d ? C.blue : C.muted, borderColor: distFilter === d ? C.blue : C.lineStrong }}>
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
            style={{ background: C.surface2, border: `1px solid ${C.lineStrong}`, borderRadius: 6, padding: "7px 10px", color: catFilter ? C.fg : C.faint, fontSize: 12, outline: "none" }}>
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
          <span style={{ fontSize: 11, color: C.faint, alignSelf: "center" }}>Ordenar:</span>
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
          <span style={{ alignSelf: "center", fontSize: 12, color: C.gold, marginLeft: 8 }}>
            {filtered.length} resultado{filtered.length !== 1 ? "s" : ""}
            {" "}
            <span onClick={() => { setSearch(""); setCatFilter(""); setGender("") }}
              style={{ color: C.faint, cursor: "pointer", textDecoration: "underline", fontSize: 11 }}>limpiar</span>
          </span>
        )}
      </div>

      {/* Vista General */}
      {view === "general" && (
        <>
          {loading
            ? <div style={{ textAlign: "center", padding: 48, color: C.faint }}>Cargando…</div>
            : (
              <div style={{ ...CARD, overflow: "hidden", padding: 0 }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.line}` }}>
                      {["Pos.", "Dorsal", hasMultiDist ? "Dist." : null, "Nombre", "Categoría", "Club", "Tiempo Neto", ""].filter(Boolean).map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "8px 14px", fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: C.faint }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0
                      ? <tr><td colSpan={8} style={{ textAlign: "center", padding: 48, color: C.faint }}>Sin resultados para los filtros aplicados</td></tr>
                      : filtered.map((r, i) => {
                          const isTop3 = sortKey === "time" && i < 3 && !catFilter && !genderFilter && !search
                          return (
                            <tr key={r.bib_number + (r.distance_km || "")} style={{ borderBottom: `1px solid ${C.surface2}` }}>
                              <td style={{ padding: "9px 14px", fontFamily: "monospace", color: isTop3 ? (i === 0 ? C.gold : i === 1 ? "#aabbcc" : "#cd7c4a") : C.faint, fontWeight: isTop3 ? 700 : 400 }}>
                                {r.position}
                              </td>
                              <td style={{ padding: "9px 14px" }}>
                                <span style={{ fontFamily: "monospace", fontSize: 12, background: C.surface2, padding: "2px 8px", borderRadius: 3, color: C.muted }}>{r.bib_number}</span>
                              </td>
                              {hasMultiDist && (
                                <td style={{ padding: "9px 14px" }}>
                                  {r.distance_km ? <span style={{ background: `${C.blue}15`, color: C.blue, border: `1px solid ${C.blue}30`, borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>{r.distance_km} km</span> : "--"}
                                </td>
                              )}
                              <td style={{ padding: "9px 14px", fontWeight: 500, fontSize: 13 }}>{r.runner.full_name}</td>
                              <td style={{ padding: "9px 14px" }}>
                                <span style={{ background: r.category?.startsWith("F") ? `${C.blue}15` : `${C.accent}15`, color: r.category?.startsWith("F") ? C.blue : C.accent, border: "1px solid " + (r.category?.startsWith("F") ? `${C.blue}30` : `${C.accent}30`), borderRadius: 20, padding: "2px 8px", fontSize: 11 }}>
                                  {r.category || "--"}
                                </span>
                              </td>
                              <td style={{ padding: "9px 14px", fontSize: 13, color: C.muted }}>{r.club || "--"}</td>
                              <td style={{ padding: "9px 14px", fontFamily: "monospace", ...FONT_NUM, color: C.fg, fontSize: 14, fontWeight: 600 }}>
                                {formatNs(r.net_time_ns || r.finish_time_ns)}
                              </td>
                              <td style={{ padding: "9px 10px", textAlign: "right" }}>
                                <button
                                  title="Imprimir certificado"
                                  onClick={() => printCertificate({ race, runner: r.runner, bib_number: r.bib_number, position: r.position, net_time_ns: r.net_time_ns || r.finish_time_ns, category: r.category, club: r.club, dni: r.runner.dni, distance_km: r.distance_km })}
                                  style={{ padding: "3px 8px", background: "transparent", border: `1px solid ${C.lineStrong}`, borderRadius: 4, cursor: "pointer", color: C.muted, fontSize: 12, ...WITH_ICON, gap: 5 }}>
                                  <Icon name="printer" size={13} />Certificado
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
              <div style={{ fontSize: 11, fontWeight: 600, color: C.faint, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
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
                        <tr key={r.bib_number} style={{ borderBottom: `1px solid ${C.surface2}` }}>
                          <td style={{ padding: "8px 14px", width: 64 }}>
                            <span style={{ fontFamily: "monospace", fontSize: 12, background: C.surface2, padding: "2px 8px", borderRadius: 3, color: C.faint }}>{r.bib_number}</span>
                          </td>
                          <td style={{ padding: "8px 14px", fontSize: 13 }}>{r.runner.full_name}</td>
                          <td style={{ padding: "8px 14px", fontSize: 12, color: C.faint }}>{r.category || "--"}</td>
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
            ? <div style={{ textAlign: "center", padding: 48, color: C.faint }}>Sin resultados para los filtros aplicados</div>
            : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 12 }}>
                {sortedCats.map(cat => {
                  const runners = byCat[cat]
                  const isFem   = cat.startsWith("F")
                  const accent  = isFem ? C.blue : C.accent
                  return (
                    <div key={cat} style={{ ...CARD }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                        <span style={{ background: accent + "20", color: accent, border: `1px solid ${accent}40`, borderRadius: 20, padding: "3px 12px", fontSize: 13, fontWeight: 700 }}>{cat}</span>
                        <span style={{ color: C.faint, fontSize: 12 }}>{runners.length} finisher{runners.length !== 1 ? "s" : ""}</span>
                      </div>
                      {runners.map((r, i) => (
                        <div key={r.bib_number} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: i < runners.length - 1 ? `1px solid ${C.surface2}` : "none" }}>
                          <span style={{ fontSize: 13, minWidth: 24, fontFamily: "monospace", fontWeight: i < 3 ? 700 : 400, color: i < 3 ? MEDAL_COLOR[i] : C.faint }}>
                            {i + 1}
                          </span>
                          <span style={{ fontFamily: "monospace", fontSize: 11, background: C.surface2, padding: "1px 6px", borderRadius: 3, color: C.faint }}>{r.bib_number}</span>
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
// PANEL DE INSCRIPCIÓN — cupo y link que se publican en el calendario del portal
// ═══════════════════════════════════════════════════════════════════════════════

function InscripcionPanel({ race, onSaved }) {
  const [cupo, setCupo] = useState(race.capacity != null ? String(race.capacity) : "")
  const [url, setUrl]   = useState(race.registration_url || "")
  const [saving, setSaving] = useState(false)
  const [msg, setMsg]   = useState("")
  const [inscriptos, setInscriptos] = useState(null)

  // El portal informa los inscriptos reales al publicar; acá lo mostramos para
  // que el organizador vea el mismo número antes de mandar el anuncio.
  useEffect(() => {
    fetch(API + "/races/" + race.id + "/registrations")
      .then(r => r.json())
      .then(d => setInscriptos(Array.isArray(d) ? d.length : null))
      .catch(() => {})
  }, [race.id])

  const sucio = cupo !== (race.capacity != null ? String(race.capacity) : "")
             || url !== (race.registration_url || "")

  const guardar = async () => {
    const u = url.trim()
    if (u && !/^https?:\/\//i.test(u)) { setMsg("El link tiene que empezar con http:// o https://"); return }
    setSaving(true); setMsg("")
    const r = await fetch(API + "/races/" + race.id, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capacity: cupo ? parseInt(cupo, 10) : null, registration_url: u || null }),
    })
    if (r.ok) { setMsg("Guardado ✓ — publicá para que se vea en el calendario"); onSaved() }
    else { const e = await r.json().catch(() => ({})); setMsg(typeof e.detail === "string" ? e.detail : "No se pudo guardar") }
    setSaving(false)
  }

  return (
    <div style={{ ...CARD, marginTop: 16, border: `1px solid ${C.blue}30` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.blue }}>📅 Inscripción · calendario del portal</span>
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
        Los corredores ven esto en el Calendario del portal. El link es adónde los mandás a inscribirse
        (tu formulario, tu pasarela de pago o la web de la carrera). La cantidad de inscriptos se toma sola
        de esta carrera: hoy son <b style={{ color: C.fg }}>{inscriptos ?? "…"}</b>.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "160px 1fr auto", gap: 10, alignItems: "end" }}>
        <div>
          <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Cupo</div>
          <input value={cupo} onChange={e => setCupo(e.target.value.replace(/\D/g, ""))}
                 placeholder="sin límite" inputMode="numeric" style={INPUT} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Link de inscripción</div>
          <input value={url} onChange={e => setUrl(e.target.value)}
                 placeholder="https://tu-formulario-de-inscripcion.com" style={INPUT}
                 onKeyDown={e => e.key === "Enter" && sucio && guardar()} />
        </div>
        <button onClick={guardar} disabled={saving || !sucio}
          style={{ ...BTN_PRIMARY, opacity: (saving || !sucio) ? 0.45 : 1, cursor: (saving || !sucio) ? "default" : "pointer" }}>
          {saving ? "Guardando…" : "Guardar"}
        </button>
      </div>
      {msg && <div style={{ fontSize: 12, marginTop: 10, color: msg.includes("✓") ? C.accent : C.danger }}>{msg}</div>}
      {!url && <div style={{ fontSize: 12, marginTop: 10, color: C.gold }}>
        Sin link, el evento se anuncia igual pero el portal muestra “Inscripción a cargo del organizador” en lugar del botón.
      </div>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// RACE DETAIL PAGE — drill-in con sub-tabs por carrera
// ═══════════════════════════════════════════════════════════════════════════════

function RaceDetailPage({ race: initialRace, onBack }) {
  const [race, setRace]     = useState(initialRace)
  // Abrir en la pestaña que corresponde al momento de la carrera: el día de la
  // carrera se entra a cronometrar, después a ver resultados.
  const [subPage, setSubPage] = useState(
    initialRace.status === "ACTIVE" ? "cronometro" : initialRace.status === "FINISHED" ? "resultados" : "inscriptos"
  )
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
      notify(err.detail || "No se puede cambiar el estado", { kind: "error" })
      return false
    }
    refreshRace()
    return true
  }

  const finishRace = async () => {
    const pend = await fetch(API + "/races/" + race.id + "/captures?status=PENDING")
      .then(r => r.json()).catch(() => [])
    const n = Array.isArray(pend) ? pend.length : 0
    const aviso = n > 0
      ? `Quedan ${n} llegada${n > 1 ? "s" : ""} sin dorsal asignado en la cola.\n\nSi finalizás ahora, esos tiempos no entran en los resultados (podés reabrir la carrera para corregir).\n\n¿Finalizar "${race.name}" igual?`
      : `¿Finalizar "${race.name}"?\n\nSe cierra el cronómetro y la carrera pasa a Finalizadas. Después vas a poder publicar y enviar los resultados.`
    if (!(await ask({ title: "Finalizar carrera", message: aviso, confirmLabel: "Finalizar carrera", danger: true }))) return
    if (await changeStatus("FINISHED")) setSubPage("resultados")
  }

  const reopenForCorrection = async () => {
    if (!(await ask({ title: "Reabrir carrera", confirmLabel: "Reabrir", message: `¿Reabrir "${race.name}" para corregir?\n\nLa carrera vuelve al estado "En curso" para que puedas ajustar dorsales, tiempos o estados de los corredores. Cuando termines, finalizala de nuevo.\n\nNo puede haber otra carrera en curso al mismo tiempo.` }))) return
    if (await changeStatus("ACTIVE")) setSubPage("cronometro")
  }

  const duplicate = async () => {
    if (!(await ask({ title: "Duplicar carrera", confirmLabel: "Duplicar", message: `¿Duplicar "${race.name}" como nueva carrera?\n\nSe crea una copia en estado "En preparación" con los mismos inscriptos (sin tiempos ni resultados). Útil para ediciones recurrentes.` }))) return
    const r = await fetch(API + "/races/" + race.id + "/duplicate", { method: "POST" })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      notify("Error al duplicar: " + (err.detail || "error desconocido"), { kind: "error" })
      return
    }
    const created = await r.json()
    notify(`Carrera duplicada: "${created.name}".\nLa encontrás en la lista de carreras.`, { kind: "success" })
    onBack()
  }

  const publish = async () => {
    // Verificar que la nube esté configurada
    const cfg = await fetch(API + "/cloud/config").then(r => r.json()).catch(() => null)
    if (!cfg || !cfg.configured) {
      notify("Primero configurá la conexión al portal en Configuración → Nube (URL + API key).", { kind: "error" })
      return
    }
    // Una carrera todavía en preparación se anuncia en el calendario del portal;
    // una ya corrida publica su tabla de resultados. El backend decide según el
    // estado, así que el aviso tiene que decir lo mismo que va a pasar.
    const esEvento = race.status === "PLANNED"
    const aviso = esEvento
      ? `¿Anunciar "${race.name}" en el calendario del portal?\n\nSe enviará: nombre, fecha, lugar, distancias, cupo, cantidad de inscriptos y el link de inscripción.\nNO se envían datos de los corredores.\n\nLos corredores lo van a ver en: ${cfg.url}`
      : `¿Publicar los resultados de "${race.name}" en el portal público?\n\nSe enviará: nombre, categoría, club, dorsal, distancia y tiempos.\nNO se envía DNI ni fecha de nacimiento.\n\nLos corredores podrán reclamar su resultado en: ${cfg.url}`
    if (!(await ask({ title: esEvento ? "Anunciar en el portal" : "Publicar resultados", message: aviso, confirmLabel: esEvento ? "Anunciar" : "Publicar" }))) return
    setPublishing(true)
    try {
      const r = await fetch(API + "/races/" + race.id + "/publish", { method: "POST" })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        notify("No se pudo publicar: " + (data.detail || "error desconocido"), { kind: "error" })
        return
      }
      // el código queda visible en el chip del header; el aviso ya no necesita ser sticky
      notify(data.event
        ? `${data.message}\n\nInscriptos informados: ${data.registered_count}\nCódigo de la carrera: ${data.code}\n\nYa aparece en el Calendario del portal. Cuando publiques los resultados, pasa sola a Carreras con el mismo código.`
        : `${data.message}\n\nResultados publicados: ${data.published_results}\nCódigo de la carrera: ${data.code}\n\nLos corredores ya pueden buscarla en el portal con ese código.`, { kind: "success" })
      refreshRace()
    } catch (e) {
      notify("No se pudo publicar: " + e.message, { kind: "error" })
    } finally {
      setPublishing(false)
    }
  }

  const sendResults = async () => {
    const cfg = await fetch(API + "/email/config").then(r => r.json()).catch(() => null)
    if (!cfg || !cfg.configured) {
      notify("Primero configurá el envío de emails en Configuración → Email (API key + remitente).", { kind: "error" })
      return
    }
    if (!(await ask({ title: "Enviar resultados por email", confirmLabel: "Enviar", message: `¿Enviar por email el resultado a los finishers de "${race.name}"?\n\nSe enviará a cada corredor que tenga email cargado: su tiempo, posición y un link al portal.\n\nRemitente: ${cfg.from_name} <${cfg.from_email}>` }))) return
    setSending(true)
    try {
      const r = await fetch(API + "/races/" + race.id + "/send-results", { method: "POST" })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        notify("No se pudo enviar: " + (data.detail || "error desconocido"), { kind: "error" })
        return
      }
      let msg = `Emails enviados: ${data.sent}\n`
      if (data.no_email) msg += `Sin email (omitidos): ${data.no_email}\n`
      if (data.failed) msg += `\nFallidos: ${data.failed}\n` + (data.failed_detail || []).join("\n")
      notify(msg, { kind: data.failed ? "error" : "success" })
    } catch (e) {
      notify("No se pudo enviar: " + e.message, { kind: "error" })
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
          <div style={{ fontSize: 12, color: C.faint, marginTop: 3, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span>{[formatDate(race.race_date), race.location].filter(Boolean).join(" · ")}</span>
            {/* El chip va acá y no en la fila de acciones: ahí le sacaba ancho al nombre. */}
            {race.published_at && <PublishedChip race={race} />}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end", flexShrink: 0, marginTop: 2 }}>
          {/* Acciones ordenadas por etapa: secundarias a la izquierda, y a la
              derecha la única acción principal de este momento de la carrera. */}
          <RaceStatusBadge status={race.status} />
          <button onClick={duplicate}
            title="Crear una copia de esta carrera con los mismos inscriptos"
            style={BTN_GHOST}>
            <span style={WITH_ICON}><Icon name="copy" size={13} />Duplicar</span>
          </button>
          {race.status === "FINISHED" && (
            <button onClick={reopenForCorrection}
              title="Reabrir la carrera para corregir resultados"
              style={BTN_GHOST}>
              <span style={WITH_ICON}><Icon name="undo" size={13} />Reabrir para corregir</span>
            </button>
          )}
          {race.status === "FINISHED" && (
            <button onClick={sendResults} disabled={sending}
              title="Enviar a cada finisher su resultado por email"
              style={{ ...BTN_GHOST, cursor: sending ? "default" : "pointer", opacity: sending ? 0.6 : 1 }}>
              {sending ? "Enviando…" : <span style={WITH_ICON}><Icon name="mail" size={13} />Enviar resultados</span>}
            </button>
          )}
          {race.status === "ACTIVE" ? (
            <>
              {/* En la pestaña Cronómetro el botón ya está en el banner de carrera en curso. */}
              <button onClick={publish} disabled={publishing}
                title="Publicar los resultados parciales en el portal público (sin DNI ni fecha de nacimiento)"
                style={{ ...BTN_GHOST, cursor: publishing ? "default" : "pointer", opacity: publishing ? 0.6 : 1 }}>
                {publishing ? "Publicando…" : <span style={WITH_ICON}><Icon name="cloud" size={13} />{race.published_at ? "Volver a publicar parciales" : "Publicar parciales"}</span>}
              </button>
              {subPage !== "cronometro" && (
                <button onClick={finishRace}
                  title="Cerrar el cronómetro y pasar la carrera a Finalizadas"
                  style={{ ...BTN_PRIMARY, background: C.gold, color: "#000" }}>
                  <span style={WITH_ICON}><Icon name="stop" size={12} />Finalizar carrera</span>
                </button>
              )}
            </>
          ) : (
            <button onClick={publish} disabled={publishing}
              title={race.status === "PLANNED"
                ? "Anunciar la carrera en el calendario del portal"
                : "Publicar los resultados en el portal público (sin DNI ni fecha de nacimiento)"}
              style={{ ...BTN_PRIMARY, cursor: publishing ? "default" : "pointer", opacity: publishing ? 0.6 : 1 }}>
              {publishing ? "Publicando…" : <span style={WITH_ICON}><Icon name="cloud" size={13} />{race.status === "PLANNED"
                ? (race.published_at ? "Volver a anunciar" : "Publicar en calendario")
                : (race.published_at ? "Volver a publicar" : "Publicar resultados")}</span>}
            </button>
          )}
        </div>
      </div>

      {/* Inscripción: sólo mientras la carrera no se corrió — es lo que viaja al
          calendario del portal cuando se aprieta "Publicar". */}
      {race.status === "PLANNED" && <InscripcionPanel race={race} onSaved={refreshRace} />}

      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${C.line}`, marginTop: 16, marginBottom: 20 }}>
        {SUB.map(s => (
          <button key={s.id} onClick={() => setSubPage(s.id)}
            style={{ padding: "10px 20px", background: "transparent", border: "none", borderBottom: subPage === s.id ? `2px solid ${C.accent}` : "2px solid transparent", cursor: "pointer", color: subPage === s.id ? C.accent : C.muted, fontWeight: subPage === s.id ? 700 : 400, fontSize: 13, marginBottom: -1, transition: "color 0.15s" }}>
            {s.label}
            {s.id === "cronometro" && race.status === "ACTIVE" && (
              <span title="Carrera en curso" style={{ display: "inline-block", width: 7, height: 7, borderRadius: 7, background: C.accent, marginLeft: 6, verticalAlign: "middle" }} />
            )}
          </button>
        ))}
      </div>

      {/* Contenido del sub-tab */}
      {subPage === "inscriptos" && <InscriptosView race={race} />}
      {subPage === "cronometro" && <TimingPage race={race} onRaceChange={refreshRace} onFinish={finishRace} />}
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

  // Sólo para la fecha del encabezado; la hora vive en el reloj maestro de la barra superior.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000)
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
  // Las más cercanas primero; las que no tienen fecha, al final.
  const planned  = races.filter(r => r.status === "PLANNED")
    .sort((a, b) => (a.race_date || "9999").localeCompare(b.race_date || "9999"))
  const live     = active[0]

  const dateStr = now.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })

  const QUICK = [
    { label: "Nueva Carrera", icon: "flag", page: "races", desc: "Crear y gestionar carreras" },
    { label: "Atletas",       icon: "user", page: "athletes", desc: "Base de corredores" },
    { label: "Historial",     icon: "list", page: "history",  desc: "Resultados y estadísticas" },
  ]
  const SECTION = { fontSize: 11, fontWeight: 600, color: C.muted, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }

  return (
    <div>
      {/* ── Encabezado ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 24, fontWeight: 800, letterSpacing: -0.3, color: C.fg }}>
          Panel de control
        </div>
        <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>{dateStr.charAt(0).toUpperCase() + dateStr.slice(1)}</div>
      </div>

      {/* ── Carrera en curso: lo único urgente, arriba y a un clic del cronómetro ── */}
      {live && (
        <button onClick={() => onNavigate("races", live)}
          style={{ width: "100%", textAlign: "left", marginBottom: 20, padding: "18px 22px", borderRadius: RADIUS.hero, cursor: "pointer",
            background: `linear-gradient(135deg, #0d1a14 0%, ${C.surface} 70%)`, border: `1px solid ${C.accent}60`, color: C.fg,
            display: "flex", alignItems: "center", gap: 16 }}>
          <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 12, background: C.accent, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.accent }}>Carrera en curso</div>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 800, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{live.name}</div>
          </div>
          <span style={{ ...BTN_PRIMARY, ...WITH_ICON, padding: "10px 18px", fontSize: 13 }}>
            <Icon name="timer" size={15} />Ir al cronómetro
          </span>
        </button>
      )}

      {/* ── Resumen ── */}
      <div style={{ ...CARD, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", padding: 0, marginBottom: 20 }}>
        {[
          { label: "Carreras",    value: races.length,    color: C.fg },
          { label: "En curso",    value: active.length,   color: active.length > 0 ? C.accent : C.fg },
          { label: "Finalizadas", value: finished.length, color: C.gold },
          { label: "Atletas",     value: runners.length,  color: C.blue },
        ].map((s, i) => (
          <div key={s.label} style={{ padding: "14px 18px", borderLeft: i ? `1px solid ${C.line}` : "none" }}>
            <div style={{ fontFamily: FONT_DISPLAY, ...FONT_NUM, fontSize: 26, fontWeight: 800, color: s.color, lineHeight: 1 }}>{loading ? "—" : s.value}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

        {/* ── Próximas carreras ── */}
        <div>
          <div style={SECTION}>Próximas carreras</div>
          {loading ? (
            <div style={{ ...CARD, textAlign: "center", padding: 32, color: C.muted }}>Cargando…</div>
          ) : planned.length === 0 ? (
            <div style={{ ...CARD, textAlign: "center", padding: 32, color: C.muted }}>
              <Icon name="flag" size={24} style={{ marginBottom: 8 }} />
              <div>No hay carreras en preparación</div>
              <button onClick={() => onNavigate("races")} style={{ ...BTN_PRIMARY, marginTop: 12 }}>Crear carrera</button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {planned.slice(0, 4).map(race => (
                <button key={race.id} onClick={() => onNavigate("races", race)} className="row-link"
                  style={{ ...CARD, padding: 14, display: "flex", alignItems: "center", gap: 12, cursor: "pointer", textAlign: "left", color: C.fg, width: "100%" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{race.name}</div>
                    <div style={{ fontSize: 12, color: C.muted }}>{formatDate(race.race_date) || "Sin fecha"}</div>
                  </div>
                  <RaceStatusBadge status={race.status} />
                  <Icon name="chevronR" size={14} style={{ color: C.faint }} />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Accesos rápidos + últimas finalizadas ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          <div>
            <div style={SECTION}>Accesos rápidos</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {QUICK.map(q => (
                <button key={q.page} onClick={() => onNavigate(q.page)} className="row-link"
                  style={{ ...CARD, padding: "12px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, textAlign: "left", color: C.fg, width: "100%" }}>
                  <Icon name={q.icon} size={18} style={{ color: C.accent }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{q.label}</div>
                    <div style={{ fontSize: 12, color: C.muted }}>{q.desc}</div>
                  </div>
                  <Icon name="chevronR" size={14} style={{ marginLeft: "auto", color: C.faint }} />
                </button>
              ))}
            </div>
          </div>

          {finished.length > 0 && (
            <div>
              <div style={SECTION}>Últimas finalizadas</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {finished.slice(0, 3).map(race => (
                  <button key={race.id} onClick={() => onNavigate("races", race)} className="row-link"
                    style={{ ...CARD, padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, textAlign: "left", color: C.fg, width: "100%" }}>
                    <Icon name="trophy" size={15} style={{ color: C.gold }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{race.name}</div>
                      <div style={{ fontSize: 12, color: C.muted }}>{formatDate(race.race_date) || "Sin fecha"}</div>
                    </div>
                    <span style={{ color: C.gold, fontSize: 12, fontWeight: 600 }}>Ver resultados</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Nota del sistema ── */}
      <div style={{ marginTop: 20, padding: "12px 16px", background: C.surface2, borderRadius: RADIUS.card, border: `1px solid ${C.line}`, fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
        Cada carrera se abre en la pestaña de su momento: <strong style={{ color: C.fg }}>Inscriptos</strong> mientras se prepara, <strong style={{ color: C.fg }}>Cronómetro</strong> el día de la carrera y <strong style={{ color: C.fg }}>Resultados</strong> cuando termina. La categoría se calcula sola con la fecha de nacimiento, y desde Resultados podés imprimir el certificado de cada corredor.
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// PÁGINA: CARRERAS — lista + drill-in
// ═══════════════════════════════════════════════════════════════════════════════

// Orden por fecha con los sin fecha al final; `dir` = 1 próxima primero, -1 reciente primero.
const porFecha = (dir) => (a, b) => {
  if (!a.race_date) return 1
  if (!b.race_date) return -1
  return a.race_date < b.race_date ? -dir : a.race_date > b.race_date ? dir : 0
}
const GRUPOS_CARRERA = [
  { status: "ACTIVE",   titulo: "En curso",        orden: porFecha(-1), colapsable: false,
    ayuda: "Cronómetro corriendo. Entrá para capturar llegadas." },
  { status: "PLANNED",  titulo: "En preparación",  orden: porFecha(1),  colapsable: false,
    ayuda: "Todavía no se corrieron: cargá inscriptos, cupo y link, y publicalas al calendario del portal." },
  { status: "FINISHED", titulo: "Finalizadas",     orden: porFecha(-1), colapsable: true,
    ayuda: "Ya cronometradas. Entrá para ver resultados, publicarlos o exportarlos." },
]
const VISIBLES_FINALIZADAS = 6

function RacesPage({ openRace, onOpenRace }) {
  const [races, setRaces]       = useState([])
  const [drillRace, setDrillRace] = useState(openRace || null)
  const [verTodas, setVerTodas] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: "", location: "", race_date: "", capacity: "", registration_url: "" })
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState("")

  const load = useCallback(() => {
    fetch(API + "/races").then(r => r.json()).then(setRaces).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  // Avisa al padre qué carrera está abierta (para la barra superior); al
  // volver a la lista o desmontarse, el cleanup lo deja en null.
  useEffect(() => {
    onOpenRace?.(drillRace)
    return () => onOpenRace?.(null)
  }, [drillRace, onOpenRace])

  // Si hay drill activo, mostrar detalle
  if (drillRace) {
    const fresh = races.find(r => r.id === drillRace.id) || drillRace
    return <RaceDetailPage race={fresh} onBack={() => { setDrillRace(null); load() }} />
  }

  const EMPTY_FORM = { name: "", location: "", race_date: "", capacity: "", registration_url: "" }

  const create = async () => {
    if (!form.name) { setError("El nombre es obligatorio"); return }
    const url = form.registration_url.trim()
    if (url && !/^https?:\/\//i.test(url)) { setError("El link de inscripción debe empezar con http:// o https://"); return }
    setSaving(true); setError("")
    const r = await fetch(API + "/races", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name, location: form.location || null, race_date: form.race_date || null,
        capacity: form.capacity ? parseInt(form.capacity, 10) : null,
        registration_url: url || null,
      }),
    })
    if (r.ok) { setShowForm(false); setForm(EMPTY_FORM); load() }
    else { const e = await r.json(); setError(typeof e.detail === "string" ? e.detail : "Error") }
    setSaving(false)
  }

  const deleteRace = async (race, e) => {
    e.stopPropagation()
    const msg = race.status === "FINISHED"
      ? `¿Eliminar "${race.name}"?\n\nSe eliminarán también todos los inscriptos, tiempos y resultados de esta carrera. Esta acción no se puede deshacer.`
      : `¿Eliminar "${race.name}"? Esta acción no se puede deshacer.`
    if (!(await ask({ title: "Eliminar carrera", message: msg, confirmLabel: "Eliminar", danger: true }))) return
    const r = await fetch(API + "/races/" + race.id, { method: "DELETE" })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      notify("Error al eliminar: " + (err.detail || "error desconocido"), { kind: "error" })
    } else load()
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 17, letterSpacing: -0.3 }}>Carreras</span>
          <span style={{ marginLeft: 10, background: `${C.blue}15`, color: C.blue, border: `1px solid ${C.blue}30`, borderRadius: 20, padding: "2px 10px", fontSize: 12 }}>{races.length}</span>
        </div>
        <button onClick={() => { setShowForm(!showForm); setError("") }} style={BTN_PRIMARY}>+ Nueva Carrera</button>
      </div>

      {showForm && (
        <div style={{ ...CARD, border: `1px solid ${C.accent}40`, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.accent, marginBottom: 12 }}>Nueva Carrera</div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Nombre *</div>
              <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="ej. Media Maratón Río Cuarto" style={INPUT} onKeyDown={e => e.key === "Enter" && create()} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Lugar</div>
              <input value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} placeholder="Río Cuarto" style={INPUT} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Fecha</div>
              <input value={form.race_date} onChange={e => setForm(p => ({ ...p, race_date: e.target.value }))} style={INPUT} type="date" />
            </div>
          </div>
          {/* Calendario del portal: mientras la carrera esté en PLANNED, "Subir a
              la web" la publica como evento con estos dos datos. */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Cupo</div>
              <input value={form.capacity} onChange={e => setForm(p => ({ ...p, capacity: e.target.value.replace(/\D/g, "") }))} placeholder="sin límite" style={INPUT} inputMode="numeric" />
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Link de inscripción</div>
              <input value={form.registration_url} onChange={e => setForm(p => ({ ...p, registration_url: e.target.value }))} placeholder="https://… (se muestra en el calendario del portal)" style={INPUT} />
            </div>
          </div>
          {error && <div style={{ color: C.danger, fontSize: 12, marginBottom: 10, padding: "6px 10px", background: `${C.danger}15`, borderRadius: 4 }}>{error}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button onClick={() => setShowForm(false)} style={BTN_GHOST}>Cancelar</button>
            <button onClick={create} disabled={saving} style={{ ...BTN_PRIMARY, opacity: saving ? 0.6 : 1 }}>{saving ? "Creando..." : "Crear"}</button>
          </div>
        </div>
      )}

      {races.length === 0 && !showForm && (
        <div style={{ textAlign: "center", padding: 60, color: C.faint }}>
          <Icon name="flag" size={30} style={{ marginBottom: 12, color: C.muted }} />
          <div style={{ fontSize: 14 }}>No hay carreras. Creá una para comenzar.</div>
        </div>
      )}

      {/* Agrupadas por estado: primero lo que necesita atención ahora (una
          carrera en curso), después lo que viene, y al final el archivo. */}
      {GRUPOS_CARRERA.map(g => {
        const delGrupo = races.filter(r => r.status === g.status).sort(g.orden)
        if (!delGrupo.length) return null
        const colapsado = g.colapsable && !verTodas && delGrupo.length > VISIBLES_FINALIZADAS
        const visibles = colapsado ? delGrupo.slice(0, VISIBLES_FINALIZADAS) : delGrupo
        const s = RACE_STATUS[g.status]
        return (
          <div key={g.status} style={{ marginBottom: 26 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span style={{ width: 8, height: 8, borderRadius: 8, background: s.color, flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: C.fg }}>{g.titulo}</span>
              <span style={{ fontSize: 12, color: C.faint }}>{delGrupo.length}</span>
              <div style={{ flex: 1, height: 1, background: C.line }} />
              {g.colapsable && delGrupo.length > VISIBLES_FINALIZADAS && (
                <button onClick={() => setVerTodas(v => !v)}
                  style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                  {colapsado ? `Ver todas (${delGrupo.length}) →` : "Ver menos ←"}
                </button>
              )}
            </div>
            <div style={{ fontSize: 12, color: C.faint, marginTop: -6, marginBottom: 12 }}>{g.ayuda}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
              {visibles.map(race => (
                <div key={race.id} style={{ position: "relative" }}>
                  {/* La tarjeta entera es un botón, así se entra con teclado; eliminar
                      queda afuera para que ENTER en la tarjeta nunca borre. */}
                  <button onClick={() => setDrillRace(race)}
                    style={{ ...CARD, display: "block", width: "100%", height: "100%", textAlign: "left", color: C.fg, cursor: "pointer", transition: "border-color 0.15s, transform 0.1s" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = C.lineStrong; e.currentTarget.style.transform = "translateY(-1px)" }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = C.line; e.currentTarget.style.transform = "translateY(0)" }}>

                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8, paddingRight: 28 }}>{race.name}</div>

                  {/* Sin píldora de estado: la sección ya lo dice, repetirlo en
                      cada tarjeta era ruido y tapaba fecha y lugar. */}
                  <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
                    {race.race_date && <span style={{ color: C.muted, fontSize: 12, ...WITH_ICON, gap: 5 }}><Icon name="calendar" size={13} />{formatDate(race.race_date)}</span>}
                    {race.location && <span style={{ color: C.muted, fontSize: 12, ...WITH_ICON, gap: 5 }}><Icon name="pin" size={13} />{race.location}</span>}
                  </div>

                  {race.race_start_ns && (
                    <div style={{ fontSize: 12, color: C.accent2, marginBottom: 8, ...WITH_ICON, gap: 4 }}><Icon name="check" size={12} />Largada registrada</div>
                  )}

                  <div style={{ marginTop: 8, fontSize: 12, color: C.muted, fontWeight: 600 }}>
                    Entrar →
                  </div>
                  </button>
                  <button onClick={(e) => deleteRace(race, e)}
                    style={{ position: "absolute", top: 10, right: 10, background: "transparent", border: "none", color: C.faint, cursor: "pointer", padding: 6, borderRadius: 6, display: "flex" }}
                    onMouseEnter={e => e.currentTarget.style.color = C.danger}
                    onMouseLeave={e => e.currentTarget.style.color = C.faint} aria-label={`Eliminar ${race.name}`} title="Eliminar carrera"><Icon name="x" size={14} /></button>
                </div>
              ))}
            </div>
          </div>
        )
      })}
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
    if (!(await ask({ title: "Eliminar atleta", message: `¿Eliminar a ${runner.full_name}? Si está inscripto en carreras no se podrá eliminar.`, confirmLabel: "Eliminar", danger: true }))) return
    const r = await fetch(API + "/runners/" + runner.id, { method: "DELETE" })
    if (!r.ok) notify("No se puede eliminar: el atleta tiene inscripciones en alguna carrera.", { kind: "error" })
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
    if (!(await ask({ title: "Eliminar atletas", message: `¿Eliminar ${selected.size} atleta${selected.size > 1 ? "s" : ""} de la base de datos?\n\nSolo se eliminarán los que no tengan inscripciones en carreras.`, confirmLabel: "Eliminar", danger: true }))) return
    setBulkDeleting(true)
    let deleted = 0, skipped = 0
    // Eliminar de a uno para manejar errores por FK individualmente
    await Promise.all([...selected].map(async (id) => {
      const r = await fetch(API + "/runners/" + id, { method: "DELETE" })
      r.ok ? deleted++ : skipped++
    }))
    setBulkDeleting(false)
    load(search)
    if (skipped > 0) notify(`${deleted} eliminado${deleted !== 1 ? "s" : ""}. ${skipped} no se pudo${skipped !== 1 ? "n" : ""} eliminar porque tienen inscripciones en carreras.`, { kind: "error" })
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 17, letterSpacing: -0.3 }}>Atletas</span>
          <span style={{ marginLeft: 10, background: `${C.blue}15`, color: C.blue, border: `1px solid ${C.blue}30`, borderRadius: 20, padding: "2px 10px", fontSize: 12 }}>{runners.length}</span>
          <span style={{ marginLeft: 8, fontSize: 12, color: C.faint }}>— base global de corredores</span>
        </div>
        <button onClick={() => { setShowForm(!showForm); resetForm() }} style={BTN_PRIMARY}>+ Nuevo atleta</button>
      </div>

      {showForm && (
        <div style={{ ...CARD, border: `1px solid ${C.accent}40`, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.accent, marginBottom: 12 }}>
            {editRunner ? `Editar: ${editRunner.full_name}` : "Nuevo atleta"}
          </div>
          <div style={{ fontSize: 12, color: C.faint, marginBottom: 12 }}>
            El dorsal se asigna al inscribirlo en cada carrera — aquí solo se guarda la información personal.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Nombre *</div>
              <input value={form.first_name} onChange={e => setForm(p => ({ ...p, first_name: e.target.value }))} placeholder="Carlos" style={INPUT} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Apellido *</div>
              <input value={form.last_name} onChange={e => setForm(p => ({ ...p, last_name: e.target.value }))} placeholder="Méndez" style={INPUT} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>DNI</div>
              <input value={form.dni} onChange={e => setForm(p => ({ ...p, dni: e.target.value }))} placeholder="12345678" style={INPUT} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Género</div>
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
              <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Club</div>
              <input value={form.club} onChange={e => setForm(p => ({ ...p, club: e.target.value }))} placeholder="RC Runners" style={INPUT} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Email <span style={{ color: C.faint }}>(para enviar resultados)</span></div>
              <input value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="corredor@email.com" style={INPUT} type="email" />
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>Fecha de nacimiento</div>
              <input value={form.birth_date} onChange={e => {
                const birth_date = e.target.value
                setForm(p => ({ ...p, birth_date, category: autoCategory(birth_date, p.gender) || p.category }))
              }} style={INPUT} type="date" />
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.faint, marginBottom: 4, textTransform: "uppercase" }}>
                Categoría {form.birth_date && <span style={{ color: C.muted }}>(auto)</span>}
              </div>
              <input
                value={form.category}
                onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                placeholder={form.birth_date ? autoCategory(form.birth_date, form.gender) || "—" : "ej. M30-34"}
                style={{ ...INPUT, color: form.birth_date && autoCategory(form.birth_date, form.gender) ? C.accent : C.fg }}
              />
            </div>
            {form.birth_date && calcAge(form.birth_date) !== null && (
              <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 2 }}>
                <div style={{ background: C.surface2, border: `1px solid ${C.lineStrong}`, borderRadius: 6, padding: "7px 10px", color: C.muted, fontSize: 13, width: "100%", textAlign: "center" }}>
                  <span style={{ color: C.fg, fontWeight: 700 }}>{calcAge(form.birth_date)}</span> años
                </div>
              </div>
            )}
          </div>
          {error && <div style={{ color: C.danger, fontSize: 12, marginBottom: 10, padding: "6px 10px", background: `${C.danger}15`, borderRadius: 4 }}>{error}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button onClick={() => { setShowForm(false); resetForm() }} style={BTN_GHOST}>Cancelar</button>
            <button onClick={save} disabled={saving} style={{ ...BTN_PRIMARY, opacity: saving ? 0.6 : 1 }}>{saving ? "Guardando..." : editRunner ? "Actualizar" : "Crear"}</button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre o DNI…" style={{ ...INPUT, maxWidth: 280 }} />
        {selected.size > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 14px", background: `${C.danger}15`, border: `1px solid ${C.danger}30`, borderRadius: 8, marginLeft: "auto" }}>
            <span style={{ fontSize: 13, color: C.danger, fontWeight: 600 }}>
              {selected.size} seleccionado{selected.size > 1 ? "s" : ""}
            </span>
            <button
              onClick={bulkDelete}
              disabled={bulkDeleting}
              style={{ padding: "4px 14px", background: C.danger, border: "none", borderRadius: 5, cursor: "pointer", color: "#fff", fontWeight: 700, fontSize: 12, opacity: bulkDeleting ? 0.6 : 1 }}>
              {bulkDeleting ? "Eliminando..." : "Eliminar seleccionados"}
            </button>
            <button onClick={() => setSelected(new Set())} style={{ ...BTN_GHOST, padding: "4px 10px", fontSize: 12 }}>Cancelar</button>
          </div>
        )}
      </div>

      <div style={{ ...CARD, overflow: "hidden", padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.line}` }}>
              <th style={{ padding: "8px 14px", width: 36 }}>
                <input
                  type="checkbox"
                  checked={runners.length > 0 && selected.size === runners.length}
                  ref={el => { if (el) el.indeterminate = selected.size > 0 && selected.size < runners.length }}
                  onChange={toggleAll}
                  style={{ cursor: "pointer", accentColor: C.accent }}
                />
              </th>
              {["Nombre", "DNI", "Edad", "Género", "Categoría", "Club", ""].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "8px 14px", fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: C.faint }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runners.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: "center", padding: 32, color: C.faint }}>{search ? "Sin resultados" : "No hay atletas registrados"}</td></tr>
            ) : runners.map(r => {
              const isSelected = selected.has(r.id)
              const age = calcAge(r.birth_date)
              return (
                <tr key={r.id} style={{ borderBottom: `1px solid ${C.surface2}`, background: isSelected ? `${C.danger}08` : "transparent" }}>
                  <td style={{ padding: "9px 14px" }}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(r.id)}
                      style={{ cursor: "pointer", accentColor: C.accent }}
                    />
                  </td>
                  <td style={{ padding: "9px 14px", fontSize: 13, fontWeight: 500 }}>{r.full_name}</td>
                  <td style={{ padding: "9px 14px", fontSize: 12, color: C.muted, fontFamily: "monospace" }}>{r.dni || "--"}</td>
                  <td style={{ padding: "9px 14px", fontSize: 12, color: C.muted }}>{age !== null ? `${age} a` : "--"}</td>
                  <td style={{ padding: "9px 14px", color: r.gender === "F" ? C.blue : C.faint, fontSize: 12 }}>{r.gender || "--"}</td>
                  <td style={{ padding: "9px 14px" }}>
                    <span style={{ background: r.category?.startsWith("F") ? `${C.blue}15` : `${C.accent}15`, color: r.category?.startsWith("F") ? C.blue : C.accent, border: "1px solid " + (r.category?.startsWith("F") ? `${C.blue}30` : `${C.accent}30`), borderRadius: 20, padding: "2px 8px", fontSize: 11 }}>
                      {r.category || "--"}
                    </span>
                  </td>
                  <td style={{ padding: "9px 14px", fontSize: 13, color: C.muted }}>{r.club || "--"}</td>
                  <td style={{ padding: "9px 14px", textAlign: "right" }}>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <button onClick={() => startEdit(r)} style={{ ...BTN_GHOST, fontSize: 11, padding: "3px 10px" }}>Editar</button>
                      <button onClick={() => deleteRunner(r)} style={BTN_DANGER} aria-label="Eliminar"><Icon name="x" size={12} /></button>
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
          <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 17, letterSpacing: -0.3 }}>Historial de Carreras</span>
          <span style={{ marginLeft: 10, background: `${C.blue}15`, color: C.blue, border: `1px solid ${C.blue}30`, borderRadius: 20, padding: "2px 10px", fontSize: 12 }}>
            {races.length} carrera{races.length !== 1 ? "s" : ""}
          </span>
        </div>
        <button onClick={loadRaces} style={{ ...BTN_GHOST, ...WITH_ICON }}><Icon name="refresh" size={13} />Actualizar</button>
      </div>

      {loading && <div style={{ textAlign: "center", padding: 48, color: C.faint }}>Cargando…</div>}

      {!loading && races.length === 0 && (
        <div style={{ textAlign: "center", padding: 60, color: C.faint }}>
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
      onMouseEnter={e => e.currentTarget.style.borderColor = `${C.accent}60`}
      onMouseLeave={e => e.currentTarget.style.borderColor = C.line}>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 15, flex: 1, paddingRight: 8 }}>{race.name}</div>
        <RaceStatusBadge status={race.status} />
      </div>

      <div style={{ fontSize: 12, color: C.faint, marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
        {race.race_date && <span style={{ ...WITH_ICON, gap: 5 }}><Icon name="calendar" size={13} />{formatDate(race.race_date)}</span>}
        {race.location && <span style={{ ...WITH_ICON, gap: 5 }}><Icon name="pin" size={13} />{race.location}</span>}
      </div>

      {stats ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
            {[
              ["Finishers", stats.finishers, C.accent],
              ["Inscritos", stats.registered, null],
              ["DNS/DNF",   stats.dnf,        stats.dnf > 0 ? C.gold : null],
            ].map(([label, val, color]) => (
              <div key={label} style={{ background: C.surface2, borderRadius: RADIUS.sm, padding: "8px 10px", textAlign: "center" }}>
                <div style={{ fontFamily: FONT_DISPLAY, ...FONT_NUM, fontSize: 20, fontWeight: 800, color: color || C.fg }}>{val}</div>
                <div style={{ fontSize: 11, color: C.muted }}>{label}</div>
              </div>
            ))}
          </div>
          <div style={{ background: C.surface2, borderRadius: 4, height: 6, marginBottom: 12, overflow: "hidden" }}>
            <div style={{ height: "100%", width: "100%", background: C.accent, borderRadius: 4, transform: `scaleX(${pct / 100})`, transformOrigin: "left", transition: "transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)" }} />
          </div>
          <div style={{ fontSize: 11, color: C.faint, marginBottom: 12 }}>
            {pct}% completado {stats.finishers > 0 && `· ${stats.finishers} finisher${stats.finishers !== 1 ? "s" : ""}`}
          </div>
        </>
      ) : (
        <div style={{ height: 80, display: "flex", alignItems: "center", justifyContent: "center", color: C.faint, fontSize: 12 }}>
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

// Esc cierra el modal abierto, como en cualquier diálogo del sistema.
function useEscape(active, onClose) {
  useEffect(() => {
    if (!active) return
    const h = (e) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [active, onClose])
}

// ── Diálogos y avisos propios ─────────────────────────────────────────────────
// Reemplazan a confirm()/alert(): los nativos congelan JS (ESPACIO deja de capturar
// llegadas en el cronómetro) y se aceptan por reflejo con ESPACIO/ENTER. Store a
// nivel módulo para llamarlos desde cualquier handler sin prop drilling.
let dialogQueue = []   // ask() mientras hay otro abierto: se encola y se muestra después
let notices = []
let noticeSeq = 0
const uiListeners = new Set()
const emitUi = () => uiListeners.forEach(fn => fn())
function useUiStore(read) {
  const [, force] = useState(0)
  useEffect(() => {
    const fn = () => force(n => n + 1)
    uiListeners.add(fn)
    return () => uiListeners.delete(fn)
  }, [])
  return read()
}

function ask({ title, message, confirmLabel = "Aceptar", cancelLabel = "Cancelar", danger = false }) {
  return new Promise(resolve => {
    dialogQueue = [...dialogQueue, { title, message, confirmLabel, cancelLabel, danger, resolve }]
    emitUi()
  })
}

function dismissNotice(id) {
  notices = notices.filter(n => n.id !== id)
  emitUi()
}

// sticky: el aviso no se va solo (ej. el código de publicación, que hay que copiar).
function notify(message, { kind = "info", sticky = false } = {}) {
  const id = ++noticeSeq
  notices = [...notices, { id, message, kind }]
  emitUi()
  if (kind !== "error" && !sticky) setTimeout(() => dismissNotice(id), 5000)
}

function DialogHost() {
  const current = useUiStore(() => dialogQueue[0] || null)
  const cancelRef = useRef(null)
  const boxRef = useRef(null)
  const prevFocus = useRef(null)

  const close = useCallback((value) => {
    if (!current) return
    dialogQueue = dialogQueue.filter(d => d !== current)
    emitUi()
    current.resolve(value)
  }, [current])

  useEscape(!!current, () => close(false))

  // Foco inicial en Cancelar; al cerrar vuelve a quien lo tenía.
  useEffect(() => {
    if (!current) return
    prevFocus.current = document.activeElement
    cancelRef.current?.focus()
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
      const btns = boxRef.current.querySelectorAll("button")
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
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button ref={cancelRef} onClick={() => close(false)} style={BTN_GHOST}>{current.cancelLabel}</button>
          <button onClick={() => close(true)}
            style={current.danger ? { ...BTN_PRIMARY, background: C.danger, color: C.bg } : BTN_PRIMARY}>
            {current.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function NoticeHost() {
  const list = useUiStore(() => notices)
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

function EmailControls() {
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

function AccountControls() {
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

function CloudControls() {
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
              placeholder={cfg?.configured ? `Guardada (${cfg.api_key_masked}) — dejá vacío para mantener` : "Pegá la API key"}
              style={inp} />

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
