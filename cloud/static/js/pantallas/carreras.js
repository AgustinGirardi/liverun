// Todas las carreras publicadas: filtro por nombre o lugar y páginas de a 12.
import { carreras } from "../nucleo/api.js";
import { normalizar } from "../nucleo/formato.js";
import { registrar } from "../ui/acciones.js";
import { $, tarjetaCarrera, vacio, errorHtml, cargando } from "../ui/componentes.js";
import { ic } from "../ui/iconos.js";

const POR_PAGINA = 12;
const est = { lista: [], filtro: "", pagina: 0 };

export async function mostrar(ctx) {
  est.filtro = ""; est.pagina = 0;
  ctx.app.innerHTML = `
    <h1>Todas las <span class="accent">carreras</span></h1>
    <p class="sub">Resultados oficiales de todas las carreras publicadas.</p>
    <div id="allRaces">${cargando()}</div>`;
  try {
    est.lista = await carreras();
  } catch (e) {
    if (ctx.vigente()) $("allRaces").innerHTML = errorHtml(e.message);
    return;
  }
  if (!ctx.vigente()) return;
  if (!est.lista.length) {
    $("allRaces").innerHTML = vacio({
      icono: "bandera", titulo: "Todavía no hay carreras publicadas.",
      detalle: `Mirá las que se vienen en el <a class="lnk" href="#/calendario">calendario</a>.`,
    });
    return;
  }
  $("allRaces").innerHTML = `
    ${est.lista.length > POR_PAGINA ? `<div class="race-filter" style="max-width:420px">
      ${ic("buscar")}
      <label for="rfiltro" class="sr-only">Filtrar carreras por nombre o lugar</label>
      <input id="rfiltro" type="search" placeholder="Filtrar por nombre o lugar" autocomplete="off" data-input="filtrarCarreras">
    </div>` : ""}
    <div id="racesPage"></div>`;
  pintar();
}

function pintar() {
  const box = $("racesPage");
  if (!box) return;
  const f = normalizar(est.filtro);
  const lista = f ? est.lista.filter((r) => normalizar(`${r.name} ${r.location} ${r.code}`).includes(f)) : est.lista;
  if (!lista.length) {
    box.innerHTML = vacio({ icono: "buscar", titulo: `Ninguna carrera coincide con “${est.filtro}”.` });
    return;
  }
  const paginas = Math.ceil(lista.length / POR_PAGINA);
  est.pagina = Math.max(0, Math.min(est.pagina, paginas - 1));
  const desde = est.pagina * POR_PAGINA;
  box.innerHTML = `
    <div class="races-grid">${lista.slice(desde, desde + POR_PAGINA).map(tarjetaCarrera).join("")}</div>
    ${paginas > 1 ? `<nav class="pager" aria-label="Páginas de carreras">
      <button type="button" class="btn ghost sm" data-act="paginaCarreras" data-dir="-1" ${est.pagina === 0 ? "disabled" : ""}>${ic("izquierda")}Anteriores</button>
      <span class="pager-info">${est.pagina + 1} de ${paginas} · ${lista.length} carreras</span>
      <button type="button" class="btn ghost sm" data-act="paginaCarreras" data-dir="1" ${est.pagina >= paginas - 1 ? "disabled" : ""}>Siguientes${ic("derecha")}</button>
    </nav>` : ""}`;
}

registrar({
  filtrarCarreras(input) { est.filtro = input.value; est.pagina = 0; pintar(); },
  paginaCarreras(btn) {
    est.pagina += Number(btn.dataset.dir);
    pintar();
    const h = $("racesPage");
    if (h) h.scrollIntoView({ block: "start", behavior: "smooth" });
  },
});
