// Certificado de finisher: una hoja A4 apaisada que se arma en un iframe y se
// manda a imprimir (el navegador ofrece "Guardar como PDF").
import { esc, fmtTiempo, fmtFecha, fmtRitmo, ritmoDe } from "../nucleo/formato.js";

/** r = resultado; carrera = { code, name, race_date, location }. */
export function imprimirCertificado(r, carrera) {
  const tiempo = fmtTiempo(r.net_time_ns || r.finish_time_ns);
  const meta = [r.distance_km ? `${r.distance_km} km` : "", fmtFecha(carrera.race_date), carrera.location]
    .filter(Boolean).map(esc).join("&nbsp;&nbsp;·&nbsp;&nbsp;");
  const ritmo = ritmoDe(r);
  const cajas = [
    [tiempo, "Tiempo oficial"],
    ritmo ? [fmtRitmo(ritmo), "Ritmo"] : null,
    r.position ? [`${r.position}º`, "Puesto general"] : null,
    r.category ? [esc(r.category) + (r.category_position ? ` · ${r.category_position}º` : ""), "Categoría"] : null,
  ].filter(Boolean);

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
  <title>Certificado · ${esc(r.full_name)}</title>
  <style>
    @page { size:A4 landscape; margin:0; }
    html,body { margin:0; padding:0; }
    .cert { width:297mm; height:210mm; box-sizing:border-box; padding:13mm; font-family:Georgia,'Times New Roman',serif; color:#13202b; background:#fff; }
    .frame { height:100%; box-sizing:border-box; border:3px solid #00b483; border-radius:8px; position:relative; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:16mm; }
    .frame:before { content:""; position:absolute; inset:5mm; border:1px solid #d7e3df; border-radius:5px; }
    .brand { position:absolute; top:10mm; left:0; right:0; font-family:Arial,Helvetica,sans-serif; letter-spacing:5px; font-weight:800; color:#00795c; font-size:13pt; }
    .kicker { text-transform:uppercase; letter-spacing:7px; color:#5a6671; font-size:12pt; font-family:Arial,sans-serif; margin-bottom:6mm; }
    .name { font-size:40pt; font-weight:700; margin-bottom:4mm; }
    .desc { font-size:13pt; color:#5a6671; }
    .race { font-size:23pt; font-weight:700; margin:3mm 0; color:#00795c; }
    .meta { font-size:12.5pt; color:#5a6671; }
    .timebox { margin-top:11mm; display:flex; gap:16mm; justify-content:center; }
    .tb .v { font-size:24pt; font-weight:800; font-family:Arial,sans-serif; line-height:1; font-variant-numeric:tabular-nums; }
    .tb:first-child .v { font-size:30pt; }
    .tb .l { font-size:9pt; text-transform:uppercase; letter-spacing:2px; color:#5a6671; margin-top:3mm; font-family:Arial,sans-serif; }
    .foot { position:absolute; bottom:10mm; left:0; right:0; font-size:9pt; color:#6b7681; font-family:Arial,sans-serif; letter-spacing:.5px; }
  </style></head>
  <body><div class="cert"><div class="frame">
    <div class="brand">LIVERUN</div>
    <div class="kicker">Certificado de finisher</div>
    <div class="name">${esc(r.full_name)}</div>
    <div class="desc">completó</div>
    <div class="race">${esc(carrera.name)}</div>
    <div class="meta">${meta}</div>
    <div class="timebox">${cajas.map(([v, l]) => `<div class="tb"><div class="v">${v}</div><div class="l">${l}</div></div>`).join("")}</div>
    <div class="foot">Resultado oficial de cronometraje · dorsal ${esc(r.bib_number)} · código de carrera ${esc(carrera.code || "")}</div>
  </div></div></body></html>`;

  const f = document.createElement("iframe");
  f.title = "Certificado";
  f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(f);
  const doc = f.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
  // Un solo disparo: onload o, si el navegador no lo emite para about:blank,
  // el respaldo. Antes podían correr los dos y abrir dos diálogos.
  let hecho = false;
  const imprimir = () => {
    if (hecho) return;
    hecho = true;
    try { f.contentWindow.focus(); f.contentWindow.print(); } catch { /* bloqueado */ }
    setTimeout(() => f.remove(), 2000);
  };
  f.onload = imprimir;
  setTimeout(imprimir, 400);
}
