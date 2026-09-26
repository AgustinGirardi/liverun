// Búsqueda de corredores (por nombre) y carreras (por nombre o código).
import { api } from "../nucleo/api.js";
import { esc, fmtTiempo, fmtFecha } from "../nucleo/formato.js";
import { registrar } from "../ui/acciones.js";
import { $, tarjetaCarrera, vacio, errorHtml, cargando, toast } from "../ui/componentes.js";
import { ic } from "../ui/iconos.js";
import { ir } from "../ui/navegar.js";
import { abrirResultado, nombreEstado } from "../ui/resultado.js";

let _resultados = [];

export async function mostrar(ctx) {
  const q = (ctx.query.get("q") || "").trim();
  ctx.titulo(q ? `“${q}”` : "Buscar");
  ctx.app.innerHTML = `
    <h1>Buscar <span class="accent">resultados</span></h1>
    <p class="sub">Tu nombre y apellido, el nombre de la carrera o su código.</p>
    <form class="search-big" role="search" data-submit="buscar" style="max-width:640px;margin-bottom:24px">
      <label for="q" class="sr-only">Tu nombre o el de la carrera</label>
      ${ic("buscar")}
      <input id="q" name="q" value="${esc(q)}" placeholder="Tu nombre o la carrera" autocomplete="off" enterkeyhint="search">
      <button class="btn grad" type="submit">Buscar</button>
    </form>
    <div id="sres" aria-live="polite">${q ? cargando("Buscando…") : ""}</div>`;
  if (!q) { $("q").focus(); return; }

  let d;
  try {
    d = await api("GET", "/api/search?q=" + encodeURIComponent(q));
  } catch (e) {
    if (ctx.vigente()) $("sres").innerHTML = errorHtml(e.message);
    return;
  }
  if (!ctx.vigente()) return;
  _resultados = d.results;

  if (d.too_short) {
    $("sres").innerHTML = vacio({ icono: "buscar", titulo: "Escribí al menos 2 letras." });
    return;
  }
  if (!d.races.length && !d.results.length) {
    $("sres").innerHTML = vacio({
      icono: "buscar", titulo: `No encontramos resultados para “${q}”.`,
      detalle: "Probá con tu nombre y apellido, o el nombre de la carrera.",
    });
    return;
  }

  let html = "";
  if (d.races.length) {
    html += `<section class="home-section" aria-labelledby="tCarr">
      <h2 id="tCarr">Carreras</h2>
      <div class="races-grid">${d.races.map(tarjetaCarrera).join("")}</div></section>`;
  }
  if (d.results.length) {
    html += `<section class="home-section" style="margin-top:${d.races.length ? 28 : 0}px" aria-labelledby="tCorr">
      <h2 id="tCorr">Corredores <span class="muted" style="font-weight:600">· ${d.results.length}${d.truncated ? "+" : ""}</span></h2>
      ${d.truncated ? `<p class="notice truncated">Hay más de ${d.limit} coincidencias: mostramos las primeras. Sumá el apellido o el nombre completo para encontrarte más rápido.</p>` : ""}
      <div class="card table-card"><div class="table-wrap"><table class="res-table">
        <thead><tr><th scope="col">Corredor</th><th scope="col">Carrera</th><th scope="col" class="hide-sm">Dist.</th>
          <th scope="col" class="num-r">Tiempo</th><th class="res-go" aria-hidden="true"></th></tr></thead>
        <tbody>${d.results.map(filaResultado).join("")}</tbody>
      </table></div></div></section>`;
  }
  $("sres").innerHTML = html;
}

function filaResultado(r, i) {
  const fin = r.status === "FINISHER";
  return `<tr class="res-row">
    <td><button type="button" class="row-btn" data-act="verResultadoBusqueda" data-i="${i}">${esc(r.full_name)}</button>
        <div class="dim">Dorsal ${esc(r.bib_number)}${fin && r.position ? ` · ${r.position}º` : ""}</div></td>
    <td><div class="race-nm">${esc(r.race_name)}</div><div class="dim">${esc(fmtFecha(r.race_date))}</div></td>
    <td class="hide-sm">${r.distance_km ? `${esc(r.distance_km)} km` : "—"}</td>
    <td class="time">${fin ? fmtTiempo(r.net_time_ns || r.finish_time_ns) : `<span class="pill warn">${esc(nombreEstado(r.status))}</span>`}</td>
    <td class="res-go">${ic("derecha")}</td>
  </tr>`;
}

registrar({
  buscar(form) {
    const q = form.q.value.trim();
    if (q.length < 2) { toast("Escribí al menos 2 letras.", "warn"); form.q.focus(); return; }
    ir(`#/buscar?q=${encodeURIComponent(q)}`);
  },
  verResultadoBusqueda(btn) {
    const r = _resultados[Number(btn.dataset.i)];
    if (!r) return;
    abrirResultado(r, { code: r.race_code, name: r.race_name, race_date: r.race_date, location: r.location });
  },
});
