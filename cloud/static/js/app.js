// Arranque del portal: rutas (#/…), navegación, tema y regreso de Google /
// Mercado Pago / links de mail. Cada pantalla vive en pantallas/ y se carga
// recién cuando se abre (la portada no baja el código de historial o admin).
import { sesion, pendiente, iniciarSesion, cerrarSesion, siExpiraLaSesion, perfil,
         actualizarUsuario, olvidarPerfil } from "./nucleo/api.js";
import { esc } from "./nucleo/formato.js";
import { registrar, iniciarAcciones } from "./ui/acciones.js";
import { $, toast, iniciarHoja, cerrarHoja, errorHtml } from "./ui/componentes.js";
import { ic } from "./ui/iconos.js";
import { ir, contarNavegacion } from "./ui/navegar.js";

// ── Rutas ─────────────────────────────────────────────────────────────────────
// clave = primer tramo del hash. `cuenta: true` pide sesión. `menu` = qué ítem
// del menú queda marcado.
const RUTAS = {
  "":                 { titulo: "Resultados", carga: () => import("./pantallas/inicio.js"), menu: "" },
  "buscar":           { titulo: "Buscar", carga: () => import("./pantallas/buscar.js") },
  "carreras":         { titulo: "Carreras", carga: () => import("./pantallas/carreras.js"), menu: "carreras" },
  "carrera":          { titulo: "Carrera", carga: () => import("./pantallas/carrera.js"), menu: "carreras" },
  "calendario":       { titulo: "Calendario", carga: () => import("./pantallas/calendario.js"), menu: "calendario" },
  "organizadores":    { titulo: "Para organizadores", carga: () => import("./pantallas/organizadores.js"), menu: "organizadores" },
  "historial":        { titulo: "Mi historial", carga: () => import("./pantallas/historial.js"), menu: "historial", cuenta: true },
  "progreso":         { titulo: "Mi progreso", carga: () => import("./pantallas/progreso.js"), menu: "progreso", cuenta: true },
  "cuenta":           { titulo: "Mi cuenta", carga: () => import("./pantallas/cuenta.js"), menu: "cuenta", cuenta: true },
  "admin":            { titulo: "Administración", carga: () => import("./pantallas/admin.js"), menu: "admin", cuenta: true },
  "ingresar":         { titulo: "Ingresar", carga: () => import("./pantallas/ingreso.js"), menu: "ingresar" },
  "crear-cuenta":     { titulo: "Crear cuenta", carga: () => import("./pantallas/ingreso.js"), menu: "crear-cuenta" },
  "olvide":           { titulo: "Recuperar contraseña", carga: () => import("./pantallas/ingreso.js") },
  "nueva-contrasena": { titulo: "Contraseña nueva", carga: () => import("./pantallas/ingreso.js") },
  "verificar":        { titulo: "Verificar email", carga: () => import("./pantallas/ingreso.js") },
};

/** "#/carrera/ABC?d=21" → { clave:"carrera", partes:["ABC"], query } */
function leerHash() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
  const [camino, qs = ""] = h.split("?");
  const partes = camino.split("/").filter(Boolean);
  return { clave: partes[0] || "", partes: partes.slice(1), query: new URLSearchParams(qs) };
}

let _turno = 0, _primera = true;

async function render() {
  const turno = ++_turno;
  const { clave, partes, query } = leerHash();
  const ruta = RUTAS[clave];
  cerrarMas();
  cerrarHoja();
  pintarMenu(ruta ? ruta.menu : null);

  const app = $("app");
  if (!ruta) {
    document.title = "Página no encontrada · LiveRun";
    app.innerHTML = `<h1>No encontramos esta página</h1>
      <p class="sub">Puede que el link esté mal copiado.</p>
      <a class="btn grad" style="width:auto" href="#/">Ir al inicio</a>`;
    return;
  }
  if (ruta.cuenta && !sesion.token) {
    location.replace(`#/ingresar?volver=${encodeURIComponent(clave)}`);
    return;
  }

  document.title = `${ruta.titulo} · LiveRun`;
  const hq = $("hq");
  if (hq) hq.value = clave === "buscar" ? (query.get("q") || "") : "";
  if (!_primera) window.scrollTo(0, 0);

  let modulo;
  try {
    modulo = await ruta.carga();
  } catch {
    if (turno !== _turno) return;
    // Suele pasar justo después de publicar una versión nueva.
    app.innerHTML = errorHtml("No se pudo cargar esta sección. Recargá la página.", false) +
      `<button type="button" class="btn grad" style="width:auto" data-act="recargarPagina">Recargar</button>`;
    return;
  }
  if (turno !== _turno) return;

  const ctx = {
    app, clave, partes, query,
    vigente: () => turno === _turno,
    titulo: (t) => { document.title = `${t} · LiveRun`; },
  };
  await modulo.mostrar(ctx);

  // Con teclado o lector de pantalla, el foco va al título de la vista nueva.
  if (!_primera && turno === _turno) {
    const h1 = app.querySelector("h1");
    if (h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
  }
  _primera = false;
}

// ── Navegación: barra lateral, pestañas de abajo y menú "Más" ─────────────────
function itemsMenu() {
  const logueado = !!sesion.token;
  const items = [
    { clave: "", txt: "Inicio", ic: "casa" },
    { clave: "carreras", txt: "Carreras", ic: "bandera" },
    { clave: "calendario", txt: "Calendario", ic: "calendario" },
  ];
  if (logueado) {
    items.push({ clave: "historial", txt: "Mi historial", ic: "grafico" },
               { clave: "progreso", txt: "Mi progreso", ic: "pulso" });
    if (sesion.usuario && sesion.usuario.is_admin) items.push({ clave: "admin", txt: "Administración", ic: "ajustes" });
  }
  return items;
}

const enlace = (it, actual, extra = "") =>
  `<a href="#/${it.clave}"${it.clave === actual ? ' aria-current="page"' : ""}${extra}>${ic(it.ic)}<span>${esc(it.txt)}</span></a>`;

function pintarMenu(actual) {
  const logueado = !!sesion.token;
  const items = itemsMenu();
  const org = { clave: "organizadores", txt: "Para organizadores", ic: "monitor" };

  $("nav").innerHTML = items.map((it) => enlace(it, actual)).join("") +
    `<div class="nav-sep" role="presentation"></div>` + enlace(org, actual);

  const nombre = sesion.usuario && (sesion.usuario.full_name || sesion.usuario.email || "");
  $("account").innerHTML = logueado
    ? `<div class="who">${esc(nombre.split(" ")[0])}</div>
       <a class="btn ghost sm" href="#/cuenta"${actual === "cuenta" ? ' aria-current="page"' : ""}>${ic("usuario")}Mi cuenta</a>
       <button type="button" class="btn ghost sm" data-act="salir">${ic("salir")}Salir</button>`
    : `<a class="btn ghost sm" href="#/ingresar">Ingresar</a>
       <a class="btn sm grad" href="#/crear-cuenta">Crear cuenta</a>`;

  // Abajo entran 5: las 4 más usadas + "Más". El resto va al menú.
  const abajo = logueado
    ? [items[0], items[1], items[3], items[4]]
    : [items[0], items[1], items[2], { clave: "ingresar", txt: "Ingresar", ic: "usuario" }];
  const enMenu = logueado
    ? [items[2], { clave: "cuenta", txt: "Mi cuenta", ic: "usuario" }, org, ...items.slice(5)]
    : [{ clave: "crear-cuenta", txt: "Crear cuenta", ic: "usuario" }, org];
  const masActivo = enMenu.some((it) => it.clave === actual);
  $("tabnav").innerHTML = abajo.map((it) => enlace(it, actual)).join("") +
    `<button type="button" data-act="mas" aria-expanded="false" aria-controls="moreMenu"${
      masActivo ? ' aria-current="page"' : ""}>${ic("mas")}<span>Más</span></button>`;
  $("moreMenu").innerHTML = enMenu.map((it) => enlace(it, actual)).join("") +
    `<hr>${botonTema("button")}${logueado ? `<button type="button" data-act="salir">${ic("salir")}Salir</button>` : ""}`;

  pintarTema();
}

function botonTema(tag) {
  const oscuro = document.documentElement.getAttribute("data-theme") !== "light";
  return `<${tag} type="button" data-act="cambiarTema">${ic(oscuro ? "sol" : "luna")}<span>${oscuro ? "Tema claro" : "Tema oscuro"}</span></${tag}>`;
}

function pintarTema() {
  const oscuro = document.documentElement.getAttribute("data-theme") !== "light";
  const b = $("themeBtn");
  if (b) b.innerHTML = `${ic(oscuro ? "sol" : "luna")}<span>${oscuro ? "Tema claro" : "Tema oscuro"}</span>`;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = oscuro ? "#0d0f10" : "#F5F7F8";
}

function abrirMas(btn) {
  const menu = $("moreMenu");
  const abrir = menu.hidden;
  menu.hidden = !abrir;
  btn.setAttribute("aria-expanded", String(abrir));
  if (abrir) { const primero = menu.querySelector("a,button"); if (primero) primero.focus(); }
}

function cerrarMas() {
  const menu = $("moreMenu");
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  const b = document.querySelector('#tabnav [data-act="mas"]');
  if (b) b.setAttribute("aria-expanded", "false");
}

registrar({
  mas: abrirMas,
  skip() { const a = $("app"); a.focus(); a.scrollIntoView(); },
  recargarPagina: () => location.reload(),
  cambiarTema() {
    const nuevo = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", nuevo);
    try { localStorage.setItem("ct_theme", nuevo); } catch { /* modo privado */ }
    cerrarMas();
    pintarMenu(RUTAS[leerHash().clave] ? RUTAS[leerHash().clave].menu : null);
    document.dispatchEvent(new CustomEvent("tema-cambiado"));
  },
  salir() {
    cerrarSesion();
    toast("Cerraste sesión.");
    ir("#/");
  },
  buscarLateral(form) {
    const q = form.q.value.trim();
    if (q.length >= 2) ir(`#/buscar?q=${encodeURIComponent(q)}`);
    else form.q.focus();
  },
});

// ── Regresos a la página con datos en la URL ─────────────────────────────────
/** Deja la URL limpia (sin tokens en el historial) y conserva el hash. */
function limpiarUrl(hash) {
  history.replaceState(null, "", location.pathname + (hash || location.hash || ""));
}

async function volverDeGoogle(p) {
  const token = p.get("token"), error = p.get("error");
  if (!token && !error) return false;
  limpiarUrl();
  if (error) {
    toast(error === "cancelado" ? "Cancelaste el ingreso con Google." : "No se pudo ingresar con Google. Probá de nuevo.", "warn");
    return true;
  }
  iniciarSesion({ token, email: p.get("email") || "" });
  try {
    const pr = await perfil();
    actualizarUsuario({ email: pr.email, full_name: pr.full_name, is_admin: !!pr.is_admin });
  } catch { /* el perfil se reintenta al abrir cada vista */ }
  const nombre = (sesion.usuario.full_name || "").split(" ")[0];
  toast(nombre ? `¡Hola, ${nombre}!` : "Ingresaste con Google.");
  return true;
}

function linksDeMail(p) {
  const ver = p.get("verificar"), rst = p.get("reset"), olv = p.get("olvide"), sub = p.get("sub");
  if (ver) { pendiente.verificar = ver; limpiarUrl("#/verificar"); return true; }
  if (rst) { pendiente.reset = rst; limpiarUrl("#/nueva-contrasena"); return true; }
  if (olv) { limpiarUrl("#/olvide"); return true; }
  if (sub) {
    // Vuelta de Mercado Pago: el premium lo confirma el aviso del pago, que
    // puede tardar unos segundos.
    olvidarPerfil();
    limpiarUrl("#/cuenta");
    toast("Estamos confirmando tu pago con Mercado Pago. Puede tardar unos minutos.");
    return true;
  }
  return false;
}

// ── Inicio ────────────────────────────────────────────────────────────────────
async function iniciar() {
  iniciarAcciones();
  iniciarHoja();
  siExpiraLaSesion(() => {
    toast("Tu sesión se cerró. Volvé a ingresar.", "warn");
    pintarMenu(null);
    location.replace(`#/ingresar?volver=${encodeURIComponent(leerHash().clave)}`);
  });

  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") cerrarMas(); });
  document.addEventListener("click", (ev) => {
    const menu = $("moreMenu");
    if (!menu.hidden && !ev.target.closest("#moreMenu, [data-act='mas']")) cerrarMas();
  });
  // Al iniciar o cerrar sesión cambia el menú.
  document.addEventListener("sesion-cambiada", () => pintarMenu(RUTAS[leerHash().clave]?.menu ?? null));

  const p = new URLSearchParams(location.search);
  if (!(await volverDeGoogle(p))) linksDeMail(p);

  // El flag de admin puede cambiar del lado del servidor: se actualiza sin
  // esperar (una sola vez por carga; el resto de la app usa el mismo pedido).
  if (sesion.token) {
    perfil().then((pr) => {
      if (!pr) return;
      const antes = !!(sesion.usuario && sesion.usuario.is_admin);
      actualizarUsuario({ email: pr.email, full_name: pr.full_name, is_admin: !!pr.is_admin });
      if (antes !== !!pr.is_admin) pintarMenu(RUTAS[leerHash().clave]?.menu ?? null);
    }).catch(() => {});
  }

  window.addEventListener("hashchange", () => { contarNavegacion(); render(); });
  window.addEventListener("redibujar", () => render());
  await render();
}

iniciar();
