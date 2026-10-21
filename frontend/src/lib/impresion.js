import { formatNs, formatTiempo } from "./tiempo.js"
import { APP_VERSION } from "./version.js"

// ── Certificado PDF ───────────────────────────────────────────────────────────

export function printCertificate({ race, runner, bib_number, position, net_time_ns, category, club, dni, distance_km }) {
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

export function printResultsReport({ race, results }) {
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
            <td class="c-time">${formatTiempo(r.net_time_ns, r.finish_time_ns)}</td>
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
