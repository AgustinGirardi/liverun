// Inicio. Sin sesión: buscá tu resultado. Con sesión: tu panel (tus carreras,
// tus números y las carreras nuevas).
import { sesion, carreras, misResultados, perfil } from "../nucleo/api.js";
import { esc, fmtHms, fmtFechaCorta, fmtKm } from "../nucleo/formato.js";
import { registrar } from "../ui/acciones.js";
import { $, tarjetaCarrera, vacio, errorHtml, cargando, toast } from "../ui/componentes.js";
import { ic } from "../ui/iconos.js";
import { ir } from "../ui/navegar.js";
import { waLink } from "../nucleo/contacto.js";
import "../ui/acciones-cuenta.js";

const formBusqueda = (placeholder) => `
  <form class="search-big" role="search" data-submit="buscarInicio">
    <label for="q" class="sr-only">Tu nombre o el de la carrera</label>
    ${ic("buscar")}
    <input id="q" name="q" placeholder="${esc(placeholder)}" autocomplete="off" enterkeyhint="search">
    <button class="btn grad" type="submit">Buscar</button>
  </form>`;

export async function mostrar(ctx) {
  return sesion.token ? panel(ctx) : portada(ctx);
}

// ── Sin sesión ────────────────────────────────────────────────────────────────
function portada(ctx) {
  ctx.app.innerHTML = `
    <section class="home-hero">
      <h1 class="home-title">Encontrá tu tiempo, <span class="accent">seguí tu progreso</span>.</h1>
      <p class="home-lead">Buscá tu nombre y accedé a tus resultados, tu puesto y tu certificado.</p>
      ${formBusqueda("Tu nombre o la carrera")}
      <p class="home-note">También podés escribir el código de la carrera.</p>
    </section>

    <section class="home-section" aria-labelledby="tRecientes">
      <div class="section-head">
        <h2 id="tRecientes">Carreras recientes</h2>
        <a class="lnk" href="#/carreras">Ver todas</a>
      </div>
      <div id="homeRaces">${cargando()}</div>
    </section>

    <div class="home-foot">
      <section class="org-band" aria-labelledby="tOrg">
        <div>
          <p class="dim" style="text-transform:uppercase;letter-spacing:1px;font-weight:700">¿Organizás carreras?</p>
          <h2 class="org-band-t" id="tOrg">Cronometrá tu carrera y publicá los resultados <span class="accent">el mismo día</span>.</h2>
          <p class="muted">Inscripciones, cronómetro de precisión, resultados al instante y certificados para cada corredor.</p>
        </div>
        <div class="org-band-cta">
          <a class="btn grad" href="#/organizadores">Ver cómo funciona</a>
          <a class="btn ghost" href="${waLink()}" target="_blank" rel="noopener noreferrer">${ic("whatsapp")}WhatsApp</a>
        </div>
      </section>
      <section class="card app-note" aria-labelledby="tApp">
        <h2 id="tApp">La app LiveRun</h2>
        <p class="muted">Salí a correr con GPS, splits por km y avisos de voz. Tus entrenamientos y tus carreras, en la misma cuenta.</p>
        <span class="pill">Muy pronto · acceso anticipado</span>
      </section>
    </div>`;
  cargarRecientes(ctx, "homeRaces", 6);
}

async function cargarRecientes(ctx, id, cuantas) {
  try {
    const lista = await carreras();
    if (!ctx.vigente()) return;
    $(id).innerHTML = lista.length
      ? `<div class="races-grid">${lista.slice(0, cuantas).map(tarjetaCarrera).join("")}</div>`
      : vacio({ icono: "bandera", titulo: "Todavía no hay carreras publicadas.",
                detalle: `Mirá las que se vienen en el <a class="lnk" href="#/calendario">calendario</a>.` });
  } catch (e) {
    if (ctx.vigente()) $(id).innerHTML = errorHtml(e.message);
  }
}

// ── Con sesión ────────────────────────────────────────────────────────────────
function panel(ctx) {
  const nombre = ((sesion.usuario && (sesion.usuario.full_name || sesion.usuario.email)) || "").split(" ")[0];
  ctx.app.innerHTML = `
    <h1>Hola${nombre ? `, <span class="accent">${esc(nombre)}</span>` : ""}</h1>
    <p class="sub">Tus carreras, tus mejores marcas y los resultados nuevos.</p>
    <div id="dashAviso"></div>
    <div style="max-width:640px;margin-bottom:24px">${formBusqueda("Buscá tu nombre")}</div>
    <div id="dashMe">${cargando("Cargando tus carreras…")}</div>
    <section class="home-section" style="margin-top:32px" aria-labelledby="tRecientes">
      <div class="section-head">
        <h2 id="tRecientes">Carreras recientes</h2>
        <a class="lnk" href="#/carreras">Ver todas</a>
      </div>
      <div id="dashRaces">${cargando()}</div>
    </section>`;
  cargarMisCarreras(ctx);
  cargarRecientes(ctx, "dashRaces", 3);
  avisoVerificacion(ctx);
}

async function cargarMisCarreras(ctx) {
  const box = () => $("dashMe");
  try {
    const d = await misResultados();
    if (!ctx.vigente()) return;
    if (!d.results.length) {
      box().innerHTML = vacio({
        icono: "pulso", titulo: "Todavía no sumaste resultados a tu perfil.",
        detalle: "Buscá tu nombre arriba, o dejá que los busquemos por el email de tu cuenta.",
        accion: `<button type="button" class="btn ghost sm" data-act="buscarPorEmail">${ic("refrescar")}Buscar mis resultados por email</button>`,
      });
      return;
    }
    const ultimas = d.results.slice(0, 5);
    box().innerHTML = `
      <div class="stats">
        <div class="stat"><div class="v key">${d.total_races}</div><div class="l">${d.total_races === 1 ? "Carrera" : "Carreras"}</div></div>
        <div class="stat"><div class="v">${esc(fmtKm(d.total_km, 0).replace(" km", ""))}</div><div class="l">Km en carrera</div></div>
        <div class="stat"><div class="v">${d.personal_bests.length}</div><div class="l">Mejores marcas</div></div>
      </div>
      <div class="section-head">
        <h2>Tus últimas carreras</h2>
        <a class="lnk" href="#/historial">Ver historial completo</a>
      </div>
      <div class="card table-card"><div class="table-wrap"><table class="dash-table">
        <thead><tr><th scope="col">Carrera</th><th scope="col">Dist.</th><th scope="col">Puesto</th><th scope="col" class="num-r">Tiempo</th></tr></thead>
        <tbody>${ultimas.map((r) => `<tr>
          <td><a class="lnk race-nm" href="#/carrera/${encodeURIComponent(r.race_code)}">${esc(r.race_name)}</a>
              <div class="dim">${esc(fmtFechaCorta(r.race_date))}</div></td>
          <td>${r.distance_km ? `${esc(r.distance_km)} km` : "—"}</td>
          <td>${r.status === "FINISHER" ? (r.position ? `${r.position}º` : "—") : `<span class="pill warn">${esc(r.status)}</span>`}</td>
          <td class="time">${r.status === "FINISHER" ? fmtHms((r.net_time_ns || r.finish_time_ns) / 1e9) : "—"}</td>
        </tr>`).join("")}</tbody></table></div></div>`;
  } catch (e) {
    if (ctx.vigente()) box().innerHTML = errorHtml(e.message);
  }
}

async function avisoVerificacion(ctx) {
  try {
    const p = await perfil();
    if (!ctx.vigente() || !p || p.email_verified !== false) return;
    $("dashAviso").innerHTML = `<div class="card subcard" data-aviso>
      <div><div class="t">Verificá tu email</div>
        <div class="muted">Así vinculamos solos los resultados que salgan con tu email.</div></div>
      <button type="button" class="btn ghost sm" data-act="reenviarVerificacion">${ic("mail")}Reenviar mail</button>
    </div>`;
  } catch { /* sin aviso */ }
}

registrar({
  buscarInicio(form) {
    const q = form.q.value.trim();
    if (q.length < 2) { toast("Escribí al menos 2 letras.", "warn"); form.q.focus(); return; }
    ir(`#/buscar?q=${encodeURIComponent(q)}`);
  }
});
