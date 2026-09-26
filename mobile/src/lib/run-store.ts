/**
 * Cola de sincronización offline-first: la salida terminada se guarda SIEMPRE
 * local primero y después se intenta subir. Si no hay señal queda pendiente y
 * se reintenta al abrir la app, al volver a primer plano o al terminar otra
 * salida. El backend deduplica por client_uuid, así que reintentar nunca duplica.
 * La cola es por usuario (ver setUsuarioCola).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { api, motivoDeError, type MotivoError, type NewActivity } from '@/lib/api';
import { isValidSnapshot, type SessionSnapshotV1 } from '@/lib/session-snapshot';

/** Clave vieja (global, de antes de separar por usuario). Solo se lee para
 *  migrarla al primer usuario que se identifique en este teléfono. */
const LEGACY_KEY = 'ct_run_pending_uploads';
const SESSION_KEY = 'ct_run_session_v1';

// ── Dueño de la cola ──────────────────────────────────────────────────────────
// La cola va por usuario: si no, al cambiar de cuenta el siguiente subía las
// salidas del anterior a SU cuenta.

let usuarioCola: string | null = null;

/** Clave de la cola del usuario (o la vieja si todavía no se sabe quién es:
 *  así nunca se pierde una salida, y se migra al identificarlo). */
export function claveCola(usuario: string | null): string {
  return usuario ? `${LEGACY_KEY}:${usuario}` : LEGACY_KEY;
}

/** Fija el dueño de la cola (email). Al identificarlo, migra la cola vieja. */
export async function setUsuarioCola(usuario: string | null): Promise<void> {
  usuarioCola = usuario ? usuario.trim().toLowerCase() : null;
  if (usuarioCola) await migrarColaVieja(usuarioCola);
  avisar();
}

export function getUsuarioCola(): string | null {
  return usuarioCola;
}

// ── Mutex ─────────────────────────────────────────────────────────────────────
// Dos operaciones de leer-modificar-escribir en paralelo se pisaban (una salida
// agregada durante una subida desaparecía). Todo cambio a la cola pasa por
// `conLock`; las subidas se serializan aparte con `conLockSync` para no
// bloquear el guardado local mientras se espera la red.

function crearMutex() {
  let cola: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const r = cola.then(fn, fn);
    cola = r.catch(() => {});
    return r;
  };
}

const conLock = crearMutex();
const conLockSync = crearMutex();

// ── Avisos de cambio (para que Salidas refresque los pendientes) ──────────────

const oyentes = new Set<() => void>();

export function onColaCambio(fn: () => void): () => void {
  oyentes.add(fn);
  return () => { oyentes.delete(fn); };
}

function avisar() {
  oyentes.forEach((f) => { try { f(); } catch { /* un oyente roto no frena al resto */ } });
}

// ── Lectura / escritura (siempre dentro de conLock) ──────────────────────────

async function readQueue(key: string): Promise<NewActivity[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as NewActivity[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(key: string, queue: NewActivity[]) {
  if (queue.length === 0) await AsyncStorage.removeItem(key);
  else await AsyncStorage.setItem(key, JSON.stringify(queue));
}

/** Une dos colas sin repetir client_uuid (conserva el orden). */
function unir(a: NewActivity[], b: NewActivity[]): NewActivity[] {
  const vistos = new Set(a.map((x) => x.client_uuid));
  return [...a, ...b.filter((x) => !vistos.has(x.client_uuid))];
}

async function migrarColaVieja(usuario: string): Promise<void> {
  await conLock(async () => {
    const vieja = await readQueue(LEGACY_KEY);
    if (vieja.length === 0) return;
    const key = claveCola(usuario);
    await writeQueue(key, unir(await readQueue(key), vieja));
    await AsyncStorage.removeItem(LEGACY_KEY);
  });
}

// ── API pública de la cola ────────────────────────────────────────────────────

/** Escribe la salida en la cola local (sin red). Idempotente por client_uuid. */
export async function enqueueActivity(activity: NewActivity): Promise<void> {
  const key = claveCola(usuarioCola);
  await conLock(async () => {
    await writeQueue(key, unir(await readQueue(key), [activity]));
  });
  avisar();
}

async function quitarDeCola(key: string, clientUuid: string): Promise<void> {
  await conLock(async () => {
    const q = await readQueue(key);
    await writeQueue(key, q.filter((a) => a.client_uuid !== clientUuid));
  });
}

/** Salida que el servidor rechazó por inválida; se saca de la cola para no
 *  reintentarla para siempre, y se informa el motivo que dio el servidor. */
export type SalidaRechazada = { actividad: NewActivity; detalle: string };

export type ResultadoSync = {
  uploaded: number;
  pending: NewActivity[];
  /** motivo del último fallo (null si no falló nada) */
  motivo: MotivoError | null;
  rechazadas: SalidaRechazada[];
};

/** Guarda la salida local y espera un intento de subida. */
export async function saveActivity(
  activity: NewActivity,
): Promise<{ uploaded: boolean; motivo: MotivoError | null }> {
  await enqueueActivity(activity);
  const { pending, motivo, rechazadas } = await syncPending();
  if (rechazadas.some((r) => r.actividad.client_uuid === activity.client_uuid)) {
    return { uploaded: false, motivo: 'rechazada' };
  }
  const uploaded = !pending.some((a) => a.client_uuid === activity.client_uuid);
  return { uploaded, motivo: uploaded ? null : motivo };
}

/**
 * Intenta subir todo lo pendiente del usuario actual. Una sola subida a la vez
 * (las llamadas concurrentes esperan su turno y releen la cola); cada salida
 * subida se quita por client_uuid, así lo agregado en el medio no se pisa.
 */
export function syncPending(): Promise<ResultadoSync> {
  return conLockSync(async () => {
    // Sin usuario identificado no se sube nada: no sabemos de quién es la cola.
    if (!usuarioCola) {
      return { uploaded: 0, pending: await pendingActivities(), motivo: null, rechazadas: [] };
    }
    const key = claveCola(usuarioCola);
    const queue = await conLock(() => readQueue(key));
    let uploaded = 0;
    let motivo: MotivoError | null = null;
    const rechazadas: SalidaRechazada[] = [];
    for (const act of queue) {
      try {
        await api.createActivity(act);
        await quitarDeCola(key, act.client_uuid);
        uploaded += 1;
      } catch (e) {
        const m = motivoDeError(e);
        if (m === 'rechazada') {
          await quitarDeCola(key, act.client_uuid);
          rechazadas.push({ actividad: act, detalle: e instanceof Error ? e.message : '' });
          continue;
        }
        motivo = m;
        // Sin red o sin sesión van a fallar todas: no tiene sentido seguir.
        if (motivo !== 'servidor') break;
      }
    }
    const pending = await conLock(() => readQueue(key));
    if (uploaded > 0 || rechazadas.length > 0) avisar();
    return { uploaded, pending, motivo: pending.length ? motivo : null, rechazadas };
  });
}

/** Salidas guardadas en el teléfono que todavía no se subieron. */
export async function pendingActivities(): Promise<NewActivity[]> {
  const key = claveCola(usuarioCola);
  return conLock(() => readQueue(key));
}

export async function pendingCount(): Promise<number> {
  return (await pendingActivities()).length;
}

export async function isQueued(clientUuid: string): Promise<boolean> {
  return (await pendingActivities()).some((a) => a.client_uuid === clientUuid);
}

/** Borra la cola del usuario actual (al eliminar la cuenta: ya no hay dónde subirla). */
export async function clearPendingQueue(): Promise<void> {
  const key = claveCola(usuarioCola);
  await conLock(() => AsyncStorage.removeItem(key));
  avisar();
}

// ── Snapshot de la salida en curso (recuperación si el SO mata la app) ────────

export async function saveSessionSnapshot(snap: SessionSnapshotV1): Promise<void> {
  try {
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(snap));
  } catch {
    // sin storage no hay recuperación, pero la salida en memoria sigue
  }
}

export async function loadSessionSnapshot(): Promise<SessionSnapshotV1 | null> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function clearSessionSnapshot(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SESSION_KEY);
  } catch {
    // mejor esfuerzo
  }
}
