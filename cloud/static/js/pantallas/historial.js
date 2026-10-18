// Mi historial: carreras oficiales guardadas en el perfil, mejores marcas y
// evolución de tiempos por distancia.
import { misResultados } from "../nucleo/api.js";
import { esc, fmtHms, fmtRitmo, fmtFecha, fmtFechaCorta, plural } from "../nucleo/formato.js";
import { registrar } from "../ui/acciones.js";
import { $, vacio, errorHtml, cargando } from "../ui/componentes.js";
import { ic } from "../ui/iconos.js";
import { abrirResultado, nombreEstado } from "../ui/resultado.js";
import "../ui/acciones-cuenta.js";

const est = { datos: null, dist: null, modo: "time" };

export async function mostrar(ctx) {
  ctx.app.innerHTML = `
    <h1>Mi <span class="accent">historial</span></h1>
    <p class="sub">Todas tus carreras oficiales, tu evolución y tus mejores marcas.</p>
    <div id="histBody">${cargando("Cargando tu historial…")}</div>`;
  try {
    est.datos = await misResultados();
  } catch (e) {
    if (ctx.vigente()) $("histBody").innerHTML = errorHtml(e.message);
    return;
  }
  if (!ctx.vigente()) return;
  est.dist = Object.keys(est.datos.by_distance).sort((a, b) => a - b)[0] || null;
  est.modo = "time";
  pintar();
}

function pintar() {
  const box = $("histBody"), d = est.datos;
  if (!box || !d) return;
  if (!d.results.length) {
    box.innerHTML = vacio({
      icono: "bandera", titulo: "Todavía no tenés carreras en tu perfil.",
      detalle: `Buscá tu nombre en el <a class="lnk" href="#/">inicio</a> para sumar un resultado, o dejá que los busquemos por tu email.`,
      accion: `<button type="button" class="btn ghost sm" data-act="buscarPorEmail">${ic("refrescar")}Buscar mis resultados por email</button>`,
    });
    return;
  }
  const p = d.participation;
  const stats = `<div class="stats four">
    <div class="stat"><div class="v key">${d.total_races}</div><div class="l">${d.total_races === 1 ? "Carrera" : "Carreras"}</div></div>
    <div class="stat"><div class="v">${Math.round(d.total_km)}</div><div class="l">Km en carrera</div></div>
    <div class="stat"><div class="v">${p.streak_months}</div><div class="l">Meses seguidos</div></div>
    <div class="stat"><div class="v">${p.races_per_month.toFixed(1).replace(".", ",")}</div><div class="l">Carreras por mes</div></div>
  </div>`;

  const marcas = d.personal_bests.length ? `<section class="card" aria-labelledby="tPb">
    <h2 id="tPb">Mejores marcas</h2>
    <div class="pb-grid">${d.personal_bests.map((b) => `<div class="pb">
      <div class="pb-d">${esc(b.distance_km)} km</div>
      <div class="pb-t">${fmtHms(b.net_time_ns / 1e9)}</div>
      <div class="pb-r"><a class="lnk" href="#/carrera/${encodeURIComponent(b.race_code)}" title="${esc(b.race_name)}">${esc(b.race_name)}</a></div>
      <div class="dim">${esc(fmtFecha(b.race_date))}</div>
    </div>`).join("")}</div></section>` : "";

  const dists = Object.keys(d.by_distance).sort((a, b) => a - b);
  const evolucion = dists.length ? `<section class="card" aria-labelledby="tEvo">
    <div class="section-head">
      <h2 id="tEvo">Evolución de tus marcas</h2>
      <div class="seg" role="group" aria-label="Mostrar">
        <button type="button" data-act="modoHistorial" data-m="time" aria-pressed="${est.modo === "time"}">Tiempo</button>
        <button type="button" data-act="modoHistorial" data-m="pace" aria-pressed="${est.modo === "pace"}">Ritmo</button>
      </div>
    </div>
    ${dists.length > 1 ? `<div class="dist-tabs" role="group" aria-label="Distancia">${dists.map((k) =>
      `<button type="button" data-act="distHistorial" data-d="${esc(k)}" aria-pressed="${k === est.dist}">${esc(k)} km</button>`).join("")}</div>` : ""}
    <div id="histChart"></div>
  </section>` : `<section class="card"><h2>Evolución de tus marcas</h2>
    <p class="muted">Cuando corras dos veces la misma distancia vas a ver acá cómo cambian tus tiempos.</p></section>`;

  const filas = d.results.map((r, i) => {
    const fin = r.status === "FINISHER";
    return `<tr class="res-row">
      <td class="nw muted">${esc(fmtFechaCorta(r.race_date))}</td>
      <td class="race-cell"><button type="button" class="row-btn race-nm" data-act="verResultadoHistorial" data-i="${i}">${esc(r.race_name)}</button>
        ${r.location ? `<div class="dim race-loc">${esc(r.location)}</div>` : ""}</td>
      <td class="nw">${r.distance_km ? `${esc(r.distance_km)} km` : "—"}</td>
      <td class="nw time">${fin ? fmtHms((r.net_time_ns || r.finish_time_ns) / 1e9) : `<span class="pill warn">${esc(nombreEstado(r.status))}</span>`}</td>
      <td class="nw hide-sm">${fin ? fmtRitmo(r.pace_s_per_km) : "—"}</td>
      <td class="nw">${r.position ? `${r.position}º${r.distance_finishers ? `<span class="dim"> de ${r.distance_finishers}</span>` : ""}` : "—"}</td>
      <td class="nw hide-sm">${r.category_position
        ? `${r.category_position}º${r.category_total ? `<span class="dim"> de ${r.category_total}</span>` : ""} <span class="pill plain">${esc(r.category || "")}</span>`
        : "—"}</td>
      <td class="res-go">${ic("derecha")}</td>
    </tr>`;
  }).join("");

  box.innerHTML = `${stats}${marcas}${evolucion}
    <div class="hist-head">
      <div>
        <h2 style="margin:0">Mis carreras <span class="muted" style="font-weight:600">· ${d.results.length}</span></h2>
        ${p.first_race_date ? `<p class="dim" style="margin-top:4px">Desde ${esc(fmtFecha(p.first_race_date))} · ${plural(p.months_active, "mes", "meses")} con carreras.</p>` : ""}
      </div>
      <button type="button" class="btn ghost sm" data-act="buscarPorEmail">${ic("refrescar")}Buscar por email</button>
    </div>
    <div class="card table-card"><div class="table-wrap"><table class="res-table hist-table">
      <caption class="sr-only">Tus carreras. Tocá una para ver el detalle y el certificado.</caption>
      <thead><tr><th scope="col">Fecha</th><th scope="col">Carrera</th><th scope="col">Dist.</th><th scope="col">Tiempo</th>
        <th scope="col" class="hide-sm">Ritmo</th><th scope="col">General</th><th scope="col" class="hide-sm">Categoría</th>
        <th class="res-go"><span class="sr-only">Detalle</span></th></tr></thead>
      <tbody>${filas}</tbody></table></div></div>`;
  dibujarGrafico();
}

// Gráfico de evolución: una marca por carrera en la misma distancia, en orden
// cronológico. El eje Y va invertido a propósito: más arriba = más rápido.
// Se dibuja al ancho real del contenedor para que el texto no se achique.
function grafico(serie, modo, ancho) {
  const W = Math.max(300, Math.min(1000, Math.round(ancho || 760)));
  const H = W < 460 ? 190 : 210;
  const L = W < 460 ? 48 : 62, R = 18, T = 18, B = 38;
  const val = (p) => (modo === "pace" ? p.pace_s_per_km : p.net_time_ns / 1e9);
  const lbl = (v) => (modo === "pace" ? fmtRitmo(v) : fmtHms(v));
  const vals = serie.map(val);
  const min = Math.min(...vals), max = Math.max(...vals), rango = (max - min) || Math.max(1, min * 0.05);
  const lo = min - rango * 0.18, hi = max + rango * 0.18;
  const x = (i) => (serie.length === 1 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (serie.length - 1));
  const y = (v) => T + ((v - lo) / (hi - lo)) * (H - T - B);
  const grilla = [lo, (lo + hi) / 2, hi].map((v) => `
    <line x1="${L}" y1="${y(v).toFixed(1)}" x2="${W - R}" y2="${y(v).toFixed(1)}" stroke="var(--border)" stroke-width="1"/>
    <text x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--dim)">${lbl(v)}</text>`).join("");
  const puntos = serie.map((p, i) => `${x(i).toFixed(1)},${y(val(p)).toFixed(1)}`).join(" ");
  const mejor = vals.indexOf(min);
  const marcas = serie.map((p, i) => `
    <circle cx="${x(i).toFixed(1)}" cy="${y(val(p)).toFixed(1)}" r="${i === mejor ? 6 : 4.5}"
      fill="${i === mejor ? "var(--acc)" : "var(--panel)"}" stroke="var(--acc)" stroke-width="2">
      <title>${esc(p.race_name)} · ${esc(fmtFecha(p.race_date))}: ${lbl(val(p))}${p.position ? ` · puesto ${p.position}` : ""}</title>
    </circle>`).join("");
  const maxEtiquetas = Math.max(2, Math.floor((W - L - R) / 78));
  const todas = serie.length <= maxEtiquetas;
  const medio = Math.floor((serie.length - 1) / 2);
  const fechas = serie.map((p, i) => {
    if (!(todas || i === 0 || i === serie.length - 1 || i === medio)) return "";
    const ancla = i === 0 ? "start" : (i === serie.length - 1 ? "end" : "middle");
    return `<text x="${x(i).toFixed(1)}" y="${H - 14}" text-anchor="${ancla}" font-size="11" fill="var(--mut)">${esc(fmtFechaCorta(p.race_date))}</text>`;
  }).join("");
  const resumen = serie.map((p) => `${fmtFechaCorta(p.race_date)}: ${lbl(val(p))}`).join("; ");
  return `<svg class="hist-svg" viewBox="0 0 ${W} ${H}" role="img"
      aria-label="Evolución en ${esc(est.dist)} km (${modo === "pace" ? "ritmo" : "tiempo"}): ${esc(resumen)}">
      ${grilla}
      <polyline points="${puntos}" fill="none" stroke="var(--acc)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${marcas}${fechas}
    </svg>
    <p class="dim hist-legend">Más arriba, más rápido. El punto lleno es tu mejor marca.</p>`;
}

function dibujarGrafico() {
  const c = $("histChart"), d = est.datos;
  if (!c || !d) return;
  const serie = d.by_distance[est.dist];
  if (serie) c.innerHTML = grafico(serie, est.modo, c.clientWidth);
}

let _rz = 0;
window.addEventListener("resize", () => {
  clearTimeout(_rz);
  _rz = setTimeout(dibujarGrafico, 150);
});

registrar({
  distHistorial(btn) { est.dist = btn.dataset.d; pintar(); },
  modoHistorial(btn) { est.modo = btn.dataset.m; pintar(); },
  verResultadoHistorial(btn) {
    const r = est.datos.results[Number(btn.dataset.i)];
    if (!r) return;
    abrirResultado(r, { code: r.race_code, name: r.race_name, race_date: r.race_date, location: r.location }, { guardado: true });
  },
});
