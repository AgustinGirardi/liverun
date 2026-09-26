// Calendario: carreras anunciadas que todavía no se corrieron.
import { api } from "../nucleo/api.js";
import { esc, mesCorto, fmtFecha } from "../nucleo/formato.js";
import { $, vacio, errorHtml, cargando } from "../ui/componentes.js";
import { ic } from "../ui/iconos.js";

function diasHasta(iso) {
  if (!iso) return null;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  return Math.round((new Date(iso + "T00:00:00") - hoy) / 86400000);
}

function cuentaRegresiva(iso) {
  const d = diasHasta(iso);
  if (d == null || d < 0) return "";
  if (d === 0) return "Es hoy";
  if (d === 1) return "Mañana";
  if (d < 7) return `En ${d} días`;
  if (d < 14) return "La semana que viene";
  return `En ${Math.round(d / 7)} semanas`;
}

function tarjetaEvento(e) {
  const inscriptos = e.registered_count || 0;
  const lleno = !!e.capacity && inscriptos >= e.capacity;
  let cupo = "";
  if (e.capacity) {
    const pct = Math.min(100, Math.round((inscriptos / e.capacity) * 100));
    cupo = `<div class="ev-cupo">
      <div class="ev-cupo-top"><span>${inscriptos} de ${e.capacity} inscriptos</span><span>${lleno ? "Sin lugares" : `${pct}%`}</span></div>
      <div class="ev-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${e.capacity}" aria-valuenow="${inscriptos}"
        aria-label="Cupo"><i class="${lleno ? "full" : ""}" style="width:${pct}%"></i></div>
    </div>`;
  } else if (e.registered_count != null) {
    cupo = `<div class="ev-cupo"><div class="ev-cupo-top"><span>${inscriptos} inscriptos</span><span>Sin cupo límite</span></div></div>`;
  }
  // Solo links web: un "javascript:" cargado por error no puede quedar clickeable.
  const url = /^https?:\/\//i.test(e.registration_url || "") ? e.registration_url : null;
  const accion = url
    ? (lleno ? `<span class="pill warn">Cupo completo</span>`
             : `<a class="btn sm grad ev-cta" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Inscribirme${ic("derecha")}</a>`)
    : `<span class="pill plain">Inscripción con el organizador</span>`;
  const falta = cuentaRegresiva(e.race_date);
  const dia = e.race_date ? +e.race_date.slice(8, 10) : "—";
  return `<article class="card ev-card">
    <div class="ev-date" aria-hidden="true"><div class="ev-d">${dia}</div><div class="ev-m">${mesCorto(e.race_date)}</div></div>
    <div class="ev-body">
      <h2 class="ev-title" style="margin:0">${esc(e.name)}</h2>
      <div class="meta">
        ${e.race_date ? `<span class="sr-only">${esc(fmtFecha(e.race_date))}</span>` : ""}
        ${e.location ? `<span class="meta-i">${ic("pin")}${esc(e.location)}</span>` : ""}
        ${falta ? `<span class="pill green">${falta}</span>` : ""}
        ${(e.distances || []).map((d) => `<span class="pill plain">${esc(d)} km</span>`).join("")}
      </div>
      ${cupo}
    </div>
    <div class="ev-action">${accion}</div>
  </article>`;
}

export async function mostrar(ctx) {
  ctx.app.innerHTML = `
    <h1>Próximas <span class="accent">carreras</span></h1>
    <p class="sub">Las carreras que se vienen. Inscribite y después encontrá tu resultado acá mismo.</p>
    <div id="evBody">${cargando("Cargando el calendario…")}</div>`;
  try {
    const eventos = await api("GET", "/api/events");
    if (!ctx.vigente()) return;
    $("evBody").innerHTML = eventos.length
      ? eventos.map(tarjetaEvento).join("")
      : vacio({ icono: "calendario", titulo: "No hay carreras anunciadas por ahora.",
                detalle: "Volvé a mirar pronto.",
                accion: `<a class="btn ghost sm" href="#/carreras">${ic("bandera")}Ver resultados publicados</a>` });
  } catch (e) {
    if (ctx.vigente()) $("evBody").innerHTML = errorHtml(e.message);
  }
}
