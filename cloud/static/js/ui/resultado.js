// Ficha de un resultado (hoja): tiempo, ritmo, puestos, certificado y
// "guardar en mi perfil". La abren la carrera, la búsqueda y el historial.
import { sesion, guardarResultado } from "../nucleo/api.js";
import { esc, fmtTiempo, fmtRitmo, ritmoDe, fmtFecha } from "../nucleo/formato.js";
import { abrirHoja, encabezadoHoja, ocupado, toast } from "./componentes.js";
import { imprimirCertificado } from "./certificado.js";
import { registrar } from "./acciones.js";
import { ic } from "./iconos.js";

const ESTADOS = { DNF: "No finalizó", DNS: "No largó", DQ: "Descalificado" };
export const nombreEstado = (s) => ESTADOS[s] || s;

let _actual = null;   // { r, carrera } de la ficha abierta

/**
 * r: resultado (con result_id si se puede guardar).
 * carrera: { code, name, race_date, location }.
 * extra: { puesto, total } si la pantalla ya los calculó; `guardado` si es suyo.
 */
export function abrirResultado(r, carrera, extra = {}) {
  _actual = { r, carrera };
  const fin = r.status === "FINISHER";
  const ritmo = ritmoDe(r);
  const puesto = extra.puesto || r.position;
  const total = extra.total || r.distance_finishers;
  const datos = [
    ["Tiempo oficial", fin ? `<span class="time">${fmtTiempo(r.net_time_ns || r.finish_time_ns)}</span>`
                          : `<span class="pill warn">${esc(nombreEstado(r.status))}</span>`],
    ["Ritmo", fin && ritmo ? fmtRitmo(ritmo) : "—"],
    ["Puesto general", fin && puesto ? `${puesto}º${total ? `<span class="dim"> de ${total}</span>` : ""}` : "—"],
    ["Categoría", r.category ? `${esc(r.category)}${r.category_position ? ` · ${r.category_position}º` : ""}${
      r.category_total ? `<span class="dim"> de ${r.category_total}</span>` : ""}` : "—"],
    ["Distancia", r.distance_km ? `${esc(r.distance_km)} km` : "—"],
    ["Dorsal", `<span class="bib">${esc(r.bib_number)}</span>`],
  ];
  if (r.club) datos.push(["Club", esc(r.club)]);

  let guardar = "";
  if (r.result_id != null && !extra.guardado) {
    guardar = sesion.token
      ? `<button type="button" class="btn ghost" data-act="guardarEnPerfil" data-id="${r.result_id}">${ic("check")}Guardar en mi perfil</button>`
      : `<a class="btn ghost" href="#/crear-cuenta">Creá tu cuenta para guardarlo</a>`;
  }

  abrirHoja(`${encabezadoHoja(esc(r.full_name))}
    <p class="muted">${esc(carrera.name)}${carrera.race_date ? ` · ${esc(fmtFecha(carrera.race_date))}` : ""}</p>
    <dl class="kv">${datos.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
    <div class="sheet-actions">
      ${fin ? `<button type="button" class="btn grad" data-act="certificado" autofocus>${ic("descargar")}Descargar certificado</button>` : ""}
      ${guardar}
      ${extra.guardado ? `<p class="dim" style="text-align:center">${ic("check")} Está en tu perfil.</p>` : ""}
    </div>`);
}

registrar({
  certificado() {
    if (_actual) imprimirCertificado(_actual.r, _actual.carrera);
  },
  async guardarEnPerfil(btn) {
    const restaurar = ocupado(btn, "Guardando…");
    try {
      await guardarResultado(Number(btn.dataset.id));
      btn.outerHTML = `<p class="ok" style="margin:0">${ic("check")} Guardado en tu perfil.</p>`;
      document.dispatchEvent(new CustomEvent("resultado-guardado"));
    } catch (e) {
      restaurar();
      toast(e.message, "warn");
    }
  },
});
