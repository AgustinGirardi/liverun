// Piezas de interfaz que usan varias pantallas: avisos, vacíos, tarjetas,
// campos de contraseña y la hoja (<dialog>).
import { esc, fmtFecha } from "../nucleo/formato.js";
import { ic } from "./iconos.js";
import { registrar } from "./acciones.js";
import { redibujar } from "./navegar.js";

export const $ = (id) => document.getElementById(id);

// ── Aviso flotante ────────────────────────────────────────────────────────────
let _toastT = 0;
export function toast(msg, tipo) {
  const t = $("ctToast");
  if (!t) return;
  t.textContent = msg;
  t.className = "toast show" + (tipo === "warn" ? " warn" : "");
  clearTimeout(_toastT);
  _toastT = setTimeout(() => { t.className = "toast"; }, 4000);
}

// ── Estados de una zona de la pantalla ───────────────────────────────────────
export function cargando(texto = "Cargando…") {
  return `<div class="empty" aria-busy="true"><div class="waiting" style="justify-content:center"><span class="spinner"></span>${esc(texto)}</div></div>`;
}

export function vacio({ icono = "bandera", titulo, detalle = "", accion = "" }) {
  return `<div class="empty">${ic(icono, "ic-big")}<p>${esc(titulo)}</p>${
    detalle ? `<p class="dim" style="margin-top:4px">${detalle}</p>` : ""}${accion}</div>`;
}

export function errorHtml(msg, reintentar = true) {
  return `<div class="err" role="alert">${esc(msg)}${
    reintentar ? ` <button type="button" class="btn-link" data-act="recargar">Reintentar</button>` : ""}</div>`;
}

/** Botón ocupado mientras dura un pedido. Devuelve la función que lo restaura. */
export function ocupado(btn, texto) {
  if (!btn) return () => {};
  const antes = btn.innerHTML;
  btn.disabled = true;
  btn.setAttribute("aria-busy", "true");
  if (texto) btn.textContent = texto;
  return () => { btn.disabled = false; btn.removeAttribute("aria-busy"); btn.innerHTML = antes; };
}

// ── Tarjeta de carrera (lista, inicio, búsqueda) ─────────────────────────────
export function tarjetaCarrera(r) {
  const meta = [
    r.race_date ? `<span class="meta-i">${ic("calendario")}${esc(fmtFecha(r.race_date))}</span>` : "",
    r.location ? `<span class="meta-i">${ic("pin")}${esc(r.location)}</span>` : "",
  ].join("");
  const pills = [
    r.finishers != null ? `<span class="pill green">${r.finishers} ${r.finishers === 1 ? "finisher" : "finishers"}</span>` : "",
    ...(r.distances || []).map((d) => `<span class="pill plain">${esc(d)} km</span>`),
  ].join("");
  return `<a class="card" href="#/carrera/${encodeURIComponent(r.code)}">
    <div class="race-card-top"><div class="race-card-name">${esc(r.name)}</div><span class="bib">${esc(r.code)}</span></div>
    ${meta ? `<div class="meta">${meta}</div>` : ""}
    ${pills ? `<div class="meta">${pills}</div>` : ""}
  </a>`;
}

// ── Campos de contraseña ─────────────────────────────────────────────────────
/** Campo con botón para mostrarla y, si `medidor`, barra de fuerza. */
export function campoContrasena({ id, etiqueta, autocomplete, placeholder = "", medidor = false, pista = "" }) {
  return `<div class="field"><label for="${id}">${esc(etiqueta)}</label>
    <div class="pw-wrap">
      <input type="password" id="${id}" name="${id}" autocomplete="${autocomplete}" placeholder="${esc(placeholder)}"
        ${medidor ? `data-input="medirContrasena" aria-describedby="${id}Lbl"` : ""} required>
      <button type="button" class="pw-eye" data-act="verContrasena" data-campo="${id}"
        aria-label="Mostrar la contraseña" aria-pressed="false">${ic("ojo")}</button>
    </div>
    ${medidor ? `<div class="pw-meter"><div class="pw-bar"><i data-n="0"></i></div><span class="pw-lbl" id="${id}Lbl" aria-live="polite"></span></div>` : ""}
    ${pista}
  </div>`;
}

function puntajeContrasena(pw) {
  if (pw.length < 8) return 0;           // por debajo del mínimo: siempre "muy débil"
  let s = 1;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(s, 4);
}

// ── Hoja (<dialog class="sheet">) ────────────────────────────────────────────
let _alCerrar = null;

/** Abre la hoja con este contenido. El primer <h2> tiene que llevar
    id="sheetTitle" (el dialog lo usa de nombre accesible). */
export function abrirHoja(html, { alCerrar } = {}) {
  const d = $("sheet");
  d.innerHTML = html;
  _alCerrar = alCerrar || null;
  if (!d.open) d.showModal();
  const foco = d.querySelector("[autofocus]");
  if (foco) foco.focus();
  return d;
}

export function cerrarHoja() {
  const d = $("sheet");
  if (d && d.open) d.close();
}

export function encabezadoHoja(titulo) {
  return `<div class="sheet-head"><h2 id="sheetTitle">${titulo}</h2>
    <button type="button" class="sheet-close" data-act="cerrarHoja" aria-label="Cerrar">${ic("cerrar")}</button></div>`;
}

export function iniciarHoja() {
  const d = $("sheet");
  if (!d) return;
  // Click en el fondo (fuera del contenido) cierra.
  d.addEventListener("click", (ev) => { if (ev.target === d) d.close(); });
  d.addEventListener("close", () => {
    const fn = _alCerrar; _alCerrar = null;
    d.innerHTML = "";
    if (fn) fn();
  });
}

registrar({
  cerrarHoja,
  recargar: redibujar,
  verContrasena(btn) {
    const campo = $(btn.dataset.campo);
    if (!campo) return;
    const mostrar = campo.type === "password";
    campo.type = mostrar ? "text" : "password";
    btn.innerHTML = ic(mostrar ? "ojoNo" : "ojo");
    btn.setAttribute("aria-pressed", String(mostrar));
    btn.setAttribute("aria-label", mostrar ? "Ocultar la contraseña" : "Mostrar la contraseña");
    campo.focus();
  },
  medirContrasena(campo) {
    const wrap = campo.closest(".field");
    const barra = wrap.querySelector(".pw-bar i"), lbl = wrap.querySelector(".pw-lbl");
    const pw = campo.value;
    if (!pw) { barra.style.width = "0"; lbl.textContent = ""; return; }
    const n = puntajeContrasena(pw);
    barra.dataset.n = String(n);
    barra.style.width = ["20%", "40%", "65%", "85%", "100%"][n];
    lbl.textContent = ["Muy débil", "Débil", "Media", "Buena", "Fuerte"][n];
  },
});
