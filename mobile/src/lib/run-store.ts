/**
 * Cola de sincronización offline-first: la salida terminada se guarda SIEMPRE
 * local primero y después se intenta subir. Si no hay señal queda pendiente y
 * se reintenta al abrir la app o al terminar otra salida. El backend deduplica
 * por client_uuid, así que reintentar nunca duplica.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { api, type NewActivity } from '@/lib/api';

const KEY = 'ct_run_pending_uploads';

async function readQueue(): Promise<NewActivity[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as NewActivity[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(queue: NewActivity[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(queue));
}

/** Guarda la salida local y dispara un intento de subida. */
export async function saveActivity(activity: NewActivity): Promise<{ uploaded: boolean }> {
  const queue = await readQueue();
  await writeQueue([...queue, activity]);
  const { pending } = await syncPending();
  return { uploaded: !pending.some((a) => a.client_uuid === activity.client_uuid) };
}

/** Intenta subir todo lo pendiente. Devuelve lo que quedó sin subir. */
export async function syncPending(): Promise<{ uploaded: number; pending: NewActivity[] }> {
  const queue = await readQueue();
  if (queue.length === 0) return { uploaded: 0, pending: [] };
  const stillPending: NewActivity[] = [];
  let uploaded = 0;
  for (const act of queue) {
    try {
      await api.createActivity(act);
      uploaded += 1;
    } catch {
      stillPending.push(act);
    }
  }
  await writeQueue(stillPending);
  return { uploaded, pending: stillPending };
}

export async function pendingCount(): Promise<number> {
  return (await readQueue()).length;
}
