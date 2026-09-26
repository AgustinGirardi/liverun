// Detalle de una carrera: podio, resultados por distancia (filtro y páginas)
// y quienes no finalizaron. La distancia elegida queda en el link (?d=21)
// para poder compartirlo.
import { api, sesion, misResultados } from "../nucleo/api.js";
import { esc, fmtTiempo, fmtFecha, normalizar, tiempoOrden } from "../nucleo/formato.js";
import { registrar } from "../ui/acciones.js";
import { $, vacio, errorHtml, cargando, toast } from "../ui/componentes.js";
import { ic } from "../ui/iconos.js";
import { volver } from "../ui/navegar.js";
import { abrirResultado, nombreEstado } from "../ui/resultado.js";

const POR_PAGINA = 50;
const est = { carrera: null, dist: null, filtro: "", pagina: 0, ranking: [], mios: new Set() };

const claveMia = (code, r) => `${code}|${r.bib_number}|${r.distance_km}`;

export async function mostrar(ctx) {
  const code = (ctx.partes[0] || "").toUpperCase();
  ctx.app.innerHTML = `
    <a class="back no-print" href="#/carreras" data-act="volverCarrera">${ic("izquierda")}Volver</a>
    <div id="rc">${cargando()}</div>`;
  let carrera;
  try {
    carrera = await api("GET", "/api/races/" + encodeURIComponent(code));
  } catch (e) {
    if (!ctx.vigente()) return;
    $("rc").innerHTML = e.status === 404
      ? vacio({ icono: "bandera", titulo: `No encontramos la carrera “${code}”.`,
                detalle: `Revisá el código o buscala en <a class="lnk" href="#/carreras">todas las carreras</a>.` })
      : errorHtml(e.message);
    return;
  }
  if (!ctx.vigente()) return;
  ctx.titulo(carrera.name);

  est.carrera = carrera;
  est.filtro = ""; est.pagina = 0; est.mios = new Set();
  const finishers = carrera.results.filter((r) => r.status === "FINISHER");
  const noFin = carrera.results.filter((r) => r.status !== "FINISHER");
  const dists = carrera.distances.length ? carrera.distances
    : [...new Set(finishers.map((r) => r.distance_km).filter((x) => x != null))];
  const pedida = Number(ctx.query.get("d"));
  est.dist = dists.includes(pedida) ? pedida : (dists[0] ?? null);
  est.dists = dists;

  const sub = [fmtFecha(carrera.race_date), carrera.location].filter(Boolean).map(esc).join(" · ");
  $("rc").innerHTML = `
    <div class="race-head">
      <div>
        <h1>${esc(carrera.name)}</h1>
        <p class="sub">${sub}${sub ? " · " : ""}código <span class="bib">${esc(carrera.code)}</span></p>
      </div>
      <div class="row no-print">
        <button type="button" class="btn ghost sm" data-act="compartirCarrera">${ic("compartir")}Compartir</button>
        <button type="button" class="btn ghost sm" data-act="imprimirCarrera">${ic("imprimir")}Imprimir</button>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><div class="v key">${finishers.length}</div><div class="l">Finishers</div></div>
      <div class="stat"><div class="v">${carrera.results.length}</div><div class="l">En la clasificación</div></div>
      <div class="stat"><div class="v">${noFin.length}</div><div class="l">No finalizaron</div></div>
    </div>
    ${dists.length > 1 ? `<div class="dist-tabs" role="group" aria-label="Distancia">${dists.map((d) =>
      `<button type="button" data-act="distanciaCarrera" data-d="${d}" aria-pressed="${d === est.dist}">${esc(d)} km</button>`).join("")}</div>` : ""}
    <div id="podio"></div>
    <div class="race-filter">
      ${ic("buscar")}
      <label for="rfilter" class="sr-only">Filtrar por nombre o dorsal</label>
      <input id="rfilter" type="search" placeholder="Buscá tu nombre o tu dorsal" autocomplete="off" data-input="filtrarCarrera">
    </div>
    <div id="tbl"></div>
    ${noFin.length ? `
      <h2 style="margin-top:28px">No finalizaron <span class="muted" style="font-weight:600">· ${noFin.length}</span></h2>
      <div class="card table-card"><div class="table-wrap"><table>
        <thead><tr><th scope="col">Dorsal</th><th scope="col">Nombre</th><th scope="col" class="hide-sm">Dist.</th>
          <th scope="col" class="hide-sm">Categoría</th><th scope="col">Estado</th></tr></thead>
        <tbody>${noFin.map((r) => `<tr>
          <td><span class="bib">${esc(r.bib_number)}</span></td>
          <td>${esc(r.full_name)}</td>
          <td class="hide-sm">${r.distance_km ? `${esc(r.distance_km)} km` : "—"}</td>
          <td class="hide-sm">${esc(r.category || "—")}</td>
          <td><span class="pill warn">${esc(nombreEstado(r.status))}</span></td>
        </tr>`).join("")}</tbody></table></div></div>` : ""}`;
  armarRanking();
  pintarTabla();

  // Tus resultados en esta carrera quedan marcados (si tenés sesión).
  if (sesion.token) {
    misResultados().then((d) => {
      if (!ctx.vigente() || !d) return;
      est.mios = new Set(d.results.filter((r) => r.race_code === carrera.code).map((r) => claveMia(carrera.code, r)));
      if (est.mios.size) pintarTabla();
    }).catch(() => {});
  }
}

function armarRanking() {
  const c = est.carrera;
  const fin = c.results.filter((r) => r.status === "FINISHER" && (est.dist == null || r.distance_km === est.dist));
  est.ranking = [...fin].sort((a, b) => tiempoOrden(a) - tiempoOrden(b));
  const top = est.ranking.slice(0, 3);
  $("podio").innerHTML = top.length === 3 ? `<div class="podium" aria-label="Podio${est.dist != null ? ` ${est.dist} km` : ""}">${top.map((r, i) => `
    <div class="p p${i + 1}"><span class="medal" aria-label="Puesto ${i + 1}">${i + 1}</span>
      <div class="nm">${esc(r.full_name)}</div><div class="tm">${fmtTiempo(r.net_time_ns || r.finish_time_ns)}</div></div>`).join("")}
    </div>` : "";
}

function pintarTabla() {
  const box = $("tbl");
  if (!box) return;
  const code = est.carrera.code;
  const f = normalizar(est.filtro.trim());
  const lista = f
    ? est.ranking.filter((r) => normalizar(r.full_name).includes(f) || normalizar(r.bib_number) === f)
    : est.ranking;

  if (!est.ranking.length) {
    box.innerHTML = vacio({ icono: "bandera", titulo: "No hay finishers en esta distancia." });
    return;
  }
  if (!lista.length) {
    box.innerHTML = vacio({ icono: "buscar", titulo: `Nadie coincide con “${est.filtro.trim()}”.`,
      accion: `<button type="button" class="btn ghost sm" data-act="limpiarFiltroCarrera">Limpiar filtro</button>` });
    return;
  }
  const paginas = Math.ceil(lista.length / POR_PAGINA);
  est.pagina = Math.max(0, Math.min(est.pagina, paginas - 1));
  const desde = est.pagina * POR_PAGINA;
  const filas = lista.slice(desde, desde + POR_PAGINA).map((r) => {
    const puesto = est.ranking.indexOf(r) + 1;
    const medalla = puesto <= 3 ? ` m${puesto}` : "";
    const mio = est.mios.has(claveMia(code, r));
    return `<tr class="res-row${mio ? " you" : ""}">
      <td class="pos${medalla}">${puesto}</td>
      <td><span class="bib">${esc(r.bib_number)}</span></td>
      <td><button type="button" class="row-btn" data-act="verResultadoCarrera" data-id="${r.result_id}">${esc(r.full_name)}</button>${
        mio ? ` <span class="pill green">Vos</span>` : ""}</td>
      <td class="hide-sm">${r.category ? `<span class="pill plain">${esc(r.category)}</span>` : "—"}</td>
      <td class="hide-sm muted">${esc(r.club || "—")}</td>
      <td class="time">${fmtTiempo(r.net_time_ns || r.finish_time_ns)}</td>
      <td class="res-go">${ic("derecha")}</td>
    </tr>`;
  }).join("");
  box.innerHTML = `
    <div class="card table-card"><div class="table-wrap"><table class="res-table">
      <caption class="sr-only">Resultados${est.dist != null ? ` de ${est.dist} km` : ""}. Tocá un nombre para ver el detalle y el certificado.</caption>
      <thead><tr><th scope="col">Pos</th><th scope="col">Dorsal</th><th scope="col">Nombre</th>
        <th scope="col" class="hide-sm">Categoría</th><th scope="col" class="hide-sm">Club</th>
        <th scope="col" class="num-r">Tiempo</th><th class="res-go"><span class="sr-only">Detalle</span></th></tr></thead>
      <tbody>${filas}</tbody></table></div></div>
    ${paginas > 1 ? `<nav class="pager" aria-label="Páginas de resultados">
      <button type="button" class="btn ghost sm" data-act="paginaCarrera" data-dir="-1" ${est.pagina === 0 ? "disabled" : ""}>${ic("izquierda")}Anteriores</button>
      <span class="pager-info">${desde + 1}–${Math.min(desde + POR_PAGINA, lista.length)} de ${lista.length}</span>
      <button type="button" class="btn ghost sm" data-act="paginaCarrera" data-dir="1" ${est.pagina >= paginas - 1 ? "disabled" : ""}>Siguientes${ic("derecha")}</button>
    </nav>` : ""}`;
}

registrar({
  volverCarrera: () => volver("#/carreras"),
  distanciaCarrera(btn) {
    est.dist = Number(btn.dataset.d);
    est.pagina = 0;
    document.querySelectorAll(".dist-tabs [data-act=distanciaCarrera]").forEach((b) =>
      b.setAttribute("aria-pressed", String(Number(b.dataset.d) === est.dist)));
    // El link queda con la distancia, sin agregar un paso al historial.
    history.replaceState(null, "", `#/carrera/${encodeURIComponent(est.carrera.code)}?d=${est.dist}`);
    armarRanking();
    pintarTabla();
  },
  filtrarCarrera(input) { est.filtro = input.value; est.pagina = 0; pintarTabla(); },
  limpiarFiltroCarrera() {
    const i = $("rfilter");
    if (i) { i.value = ""; i.focus(); }
    est.filtro = ""; pintarTabla();
  },
  paginaCarrera(btn) {
    est.pagina += Number(btn.dataset.dir);
    pintarTabla();
    $("rfilter").scrollIntoView({ block: "start", behavior: "smooth" });
  },
  verResultadoCarrera(btn) {
    const id = Number(btn.dataset.id);
    const r = est.carrera.results.find((x) => x.result_id === id);
    if (!r) return;
    abrirResultado(r, est.carrera, {
      puesto: est.ranking.indexOf(r) + 1,
      total: est.ranking.length,
      guardado: est.mios.has(claveMia(est.carrera.code, r)),
    });
  },
  async compartirCarrera() {
    const url = location.href;
    const titulo = `${est.carrera.name} · Resultados`;
    if (navigator.share) {
      try { await navigator.share({ title: titulo, url }); } catch { /* cancelado */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast("Copiamos el link de la carrera.");
    } catch {
      toast("No pudimos copiar el link. Copialo de la barra de direcciones.", "warn");
    }
  },
  imprimirCarrera: () => window.print(),
});

// Al guardar un resultado desde la ficha, la fila pasa a "Vos".
document.addEventListener("resultado-guardado", () => {
  if (!est.carrera || !sesion.token) return;
  misResultados().then((d) => {
    est.mios = new Set(d.results.filter((r) => r.race_code === est.carrera.code).map((r) => claveMia(est.carrera.code, r)));
    pintarTabla();
  }).catch(() => {});
});
