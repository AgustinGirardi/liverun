// Acciones de la interfaz, enganchadas por delegación: un solo listener por
// tipo de evento en todo el documento. El HTML nombra la acción con
//   data-act="nombre"      → click (botones y links)
//   data-submit="nombre"   → envío de un <form> (Enter incluido)
//   data-input="nombre"    → cada tecla en un campo
// Así no hay onclick="" en el HTML y la CSP puede prohibir scripts en línea.

const ACCIONES = Object.create(null);

/** Registra acciones: { nombre(elemento, evento) }. */
export function registrar(mapa) {
  for (const [nombre, fn] of Object.entries(mapa)) ACCIONES[nombre] = fn;
}

function correr(nombre, el, ev) {
  const fn = ACCIONES[nombre];
  if (!fn) { console.warn(`Acción sin registrar: ${nombre}`); return; }
  try {
    const r = fn(el, ev);
    if (r && typeof r.catch === "function") r.catch((e) => console.error(e));
  } catch (e) { console.error(e); }
}

export function iniciarAcciones() {
  document.addEventListener("click", (ev) => {
    const el = ev.target.closest("[data-act]");
    if (!el || el.disabled) return;
    // Un <a data-act> es una acción, no una navegación (el href queda para
    // abrir en otra pestaña o sin JavaScript).
    if (el.tagName === "A" && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) ev.preventDefault();
    else if (el.tagName === "A") return;
    correr(el.dataset.act, el, ev);
  });
  document.addEventListener("submit", (ev) => {
    const form = ev.target.closest("form[data-submit]");
    if (!form) return;
    ev.preventDefault();
    correr(form.dataset.submit, form, ev);
  });
  document.addEventListener("input", (ev) => {
    const el = ev.target.closest("[data-input]");
    if (el) correr(el.dataset.input, el, ev);
  });
}
