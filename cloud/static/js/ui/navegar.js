// Navegación entre vistas (#/…). Separado de app.js para que las pantallas lo
// usen sin importar el arranque.

let _navegaciones = 0;

/** Va a una vista. Si ya está ahí, la vuelve a dibujar. */
export function ir(hash) {
  if (location.hash === hash) redibujar();
  else location.hash = hash;
}

/** Vuelve a dibujar la vista actual (después de guardar algo, por ejemplo). */
export function redibujar() {
  window.dispatchEvent(new CustomEvent("redibujar"));
}

export function contarNavegacion() { _navegaciones++; }

/** "Volver": atrás en el historial si se llegó navegando por el portal; si se
    entró directo con un link, a `alternativa`. */
export function volver(alternativa = "#/") {
  if (_navegaciones > 0) history.back();
  else location.hash = alternativa;
}
