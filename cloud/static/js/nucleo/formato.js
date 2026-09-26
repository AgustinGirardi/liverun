// Formatos de texto: tiempos, fechas, ritmos. Funciones puras, sin DOM.

const MESES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
const p2 = (n) => String(n).padStart(2, "0");

/** Escapa texto para meterlo en HTML (también en atributos). */
export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Tiempo oficial con centésimas, truncadas como en cronometraje:
    "42:13.51" o "1:02:03.40". */
export function fmtTiempo(ns) {
  if (!ns) return "—";
  const cs = Math.floor(ns / 1e7);
  const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, s = Math.floor(cs / 100) % 60;
  const c = cs % 100;
  return h ? `${h}:${p2(m)}:${p2(s)}.${p2(c)}` : `${m}:${p2(s)}.${p2(c)}`;
}

/** Tiempo corto en segundos, para ejes y marcas: "42:13" o "1:02:03". */
export function fmtHms(sec) {
  if (sec == null) return "—";
  const t = Math.round(sec);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `${h}:${p2(m)}:${p2(s)}` : `${m}:${p2(s)}`;
}

/** Ritmo en min/km: "4:52/km". */
export function fmtRitmo(sPorKm, conUnidad = true) {
  if (!sPorKm || sPorKm <= 0) return "—";
  const t = Math.round(sPorKm);
  return `${Math.floor(t / 60)}:${p2(t % 60)}${conUnidad ? "/km" : ""}`;
}

/** Ritmo de un resultado a partir del tiempo y la distancia. */
export function ritmoDe(r) {
  const ns = r.net_time_ns || r.finish_time_ns;
  return ns && r.distance_km ? ns / 1e9 / r.distance_km : null;
}

/** "1 de mayo de 2026". Las fechas vienen como "AAAA-MM-DD" (sin hora). */
export function fmtFecha(iso) {
  if (!iso) return "";
  const d = new Date(String(iso).slice(0, 10) + "T12:00:00");
  if (isNaN(d)) return String(iso);
  return d.toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });
}

/** "23 ago" (con año si no es el actual: "23 ago ’25"). */
export function fmtFechaCorta(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  const anio = (+y === new Date().getFullYear()) ? "" : ` ’${y.slice(2)}`;
  return `${+d} ${MESES[+m - 1] || ""}${anio}`;
}

export function mesCorto(iso) {
  const m = +String(iso || "").slice(5, 7);
  return MESES[m - 1] || "";
}

export function fmtKm(km, dec = 1) {
  return `${Number(km || 0).toFixed(dec).replace(".", ",")} km`;
}

export function plural(n, uno, varios) {
  return `${n} ${n === 1 ? uno : varios}`;
}

/** Tiempo para ordenar: los que no tienen tiempo van al final. */
export const tiempoOrden = (r) => r.net_time_ns || r.finish_time_ns || 9e18;

/** Para comparar textos: sin acentos ni mayúsculas ("Pérez" → "perez"). */
export const normalizar = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
