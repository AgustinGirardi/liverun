/**
 * Tarea de ubicación en background. Se registra al cargar la app (import en el
 * layout raíz). Cuando la salida corre con la pantalla bloqueada, el SO sigue
 * entregando lecturas acá y las inyectamos en la sesión.
 *
 * Nota: el tracking en background sólo funciona en un build de desarrollo o de
 * producción (no en Expo Go). En Expo Go la pantalla Correr usa el watcher de
 * primer plano como fallback.
 */
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { loadSessionSnapshot } from '@/lib/run-store';
import { runSession } from '@/lib/run-session';

export const LOCATION_TASK = 'chronotrack-run-location';

/** Si el SO mató el proceso hace menos que esto, la tarea retoma sola la
 *  salida guardada (el corredor ni se entera). Cortes más largos los decide
 *  el usuario al reabrir la app. */
const AUTO_RESUME_MAX_GAP_MS = 10 * 60 * 1000;

type LocationTaskData = { locations?: Location.LocationObject[] };

if (!TaskManager.isTaskDefined(LOCATION_TASK)) {
  TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
    if (error) return;
    const { locations } = (data ?? {}) as LocationTaskData;
    if (!locations || !locations.length) return;

    // Proceso reiniciado en background (Android mató la app a mitad de la
    // salida): restaurar el snapshot y seguir midiendo sin intervención.
    if (runSession.snapshot().phase === 'idle') {
      const snap = await loadSessionSnapshot();
      if (!snap || Date.now() - snap.savedAt > AUTO_RESUME_MAX_GAP_MS) return;
      runSession.restoreFrom(snap, { autoResume: true });
    }

    runSession.ingest(
      locations.map((l) => ({
        coords: {
          latitude: l.coords.latitude,
          longitude: l.coords.longitude,
          accuracy: l.coords.accuracy,
          speed: l.coords.speed,
        },
        timestamp: l.timestamp,
      })),
    );
  });
}
