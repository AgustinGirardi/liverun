// Llamadas a la API y estado de la sesión. No toca el DOM: las pantallas
// deciden cómo mostrar cada error.

const K_TOKEN = "ct_token", K_USUARIO = "ct_user";

function leer(k) { try { return localStorage.getItem(k); } catch { return null; } }
function guardar(k, v) {
  try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* modo privado */ }
}

function usuarioGuardado() {
  try { return JSON.parse(leer(K_USUARIO) || "null"); } catch { return null; }
}

/** Sesión actual. `usuario` = { email, full_name, is_admin }. */
export const sesion = { token: leer(K_TOKEN), usuario: null };
sesion.usuario = sesion.token ? (usuarioGuardado() || { email: "", full_name: null }) : null;

/** Tokens de los links de mail (?reset= / ?verificar=). Viven en memoria para
    que no queden en el historial ni en la barra de direcciones. */
export const pendiente = { reset: null, verificar: null };

let alExpirar = () => {};
/** Qué hacer cuando el servidor rechaza la sesión (se cambió la contraseña en
    otro dispositivo, se borró la cuenta…). Lo define app.js. */
export function siExpiraLaSesion(fn) { alExpirar = fn; }

export function iniciarSesion(d) {
  sesion.token = d.token;
  sesion.usuario = { email: d.email || "", full_name: d.full_name || null, is_admin: !!d.is_admin };
  guardar(K_TOKEN, sesion.token);
  guardar(K_USUARIO, JSON.stringify(sesion.usuario));
  olvidarDatosDeCuenta();
}

export function cerrarSesion() {
  sesion.token = null;
  sesion.usuario = null;
  guardar(K_TOKEN, null);
  guardar(K_USUARIO, null);
  olvidarDatosDeCuenta();
}

/** El cambio de contraseña devuelve un token nuevo (los demás quedan afuera). */
export function reemplazarToken(token) {
  sesion.token = token;
  guardar(K_TOKEN, token);
}

export function actualizarUsuario(parcial) {
  if (!sesion.usuario) return;
  Object.assign(sesion.usuario, parcial);
  guardar(K_USUARIO, JSON.stringify(sesion.usuario));
}

function mensajeDeError(detail, status) {
  if (Array.isArray(detail)) return detail.map((d) => (d && d.msg) || String(d)).join(" · ");
  if (typeof detail === "string" && detail) return detail;
  if (status === 404) return "No encontramos lo que buscabas.";
  if (status === 429) return "Hiciste muchos pedidos seguidos. Esperá un minuto y probá de nuevo.";
  if (status >= 500) return "El servidor tuvo un problema. Probá de nuevo en un rato.";
  return `Algo salió mal (error ${status}). Probá de nuevo.`;
}

/**
 * Pedido a la API del mismo origen.
 * opciones.auth: manda el token. opciones.expira (por defecto = auth): un 401
 * cierra la sesión. /api/auth/verify responde 401 para pedir la contraseña, y
 * ahí no hay que echar a nadie.
 */
export async function api(metodo, ruta, cuerpo = null, opciones = {}) {
  const { auth = false, expira = auth } = opciones;
  const headers = { Accept: "application/json" };
  if (cuerpo != null) headers["Content-Type"] = "application/json";
  if (auth && sesion.token) headers.Authorization = "Bearer " + sesion.token;
  let res;
  try {
    res = await fetch(ruta, { method: metodo, headers, body: cuerpo != null ? JSON.stringify(cuerpo) : undefined });
  } catch {
    throw new Error("No se pudo conectar con el servidor. Revisá tu conexión y probá de nuevo.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && expira && sesion.token) {
      cerrarSesion();
      alExpirar();
    }
    const err = new Error(mensajeDeError(data && data.detail, res.status));
    err.status = res.status;
    throw err;
  }
  return data;
}

// ── Datos que se piden desde varias pantallas: una sola vez por sesión ────────
// Antes el perfil se pedía dos veces al entrar y la lista de carreras cada vez
// que se volvía al inicio.

let _perfil = null, _misResultados = null, _carreras = null, _carrerasAl = 0;
const VIDA_CARRERAS_MS = 60_000;

function recordar(promesa, limpiar) {
  return promesa.catch((e) => { limpiar(); throw e; });
}

/** Perfil de la cuenta (plan, verificación, has_password…). */
export function perfil({ fresco = false } = {}) {
  if (!sesion.token) return Promise.resolve(null);
  if (fresco || !_perfil) {
    _perfil = recordar(api("GET", "/api/run/profile", null, { auth: true }), () => { _perfil = null; });
  }
  return _perfil;
}

/** Resultados guardados en el perfil del corredor. */
export function misResultados({ fresco = false } = {}) {
  if (!sesion.token) return Promise.resolve(null);
  if (fresco || !_misResultados) {
    _misResultados = recordar(api("GET", "/api/me/results", null, { auth: true }), () => { _misResultados = null; });
  }
  return _misResultados;
}

/** Carreras publicadas (se vuelven a pedir pasado un minuto). */
export function carreras() {
  if (!_carreras || Date.now() - _carrerasAl > VIDA_CARRERAS_MS) {
    _carrerasAl = Date.now();
    _carreras = recordar(api("GET", "/api/races"), () => { _carreras = null; });
  }
  return _carreras;
}

export function olvidarPerfil() { _perfil = null; }
export function olvidarMisResultados() { _misResultados = null; }
function olvidarDatosDeCuenta() { _perfil = null; _misResultados = null; }

/** Guarda un resultado en el perfil. El server pide el apellido como prueba de
    identidad: se manda el del nombre de la cuenta. */
export async function guardarResultado(resultId) {
  const partes = ((sesion.usuario && sesion.usuario.full_name) || "").trim().split(/\s+/);
  const apellido = partes.length > 1 ? partes[partes.length - 1] : "";
  const d = await api("POST", "/api/me/claim", { result_id: resultId, last_name: apellido }, { auth: true });
  olvidarMisResultados();
  return d;
}
