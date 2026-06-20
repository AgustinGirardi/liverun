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

import { runSession } from '@/lib/run-session';

export const LOCATION_TASK = 'chronotrack-run-location';

type LocationTaskData = { locations?: Location.LocationObject[] };

if (!TaskManager.isTaskDefined(LOCATION_TASK)) {
  TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
    if (error) return;
    const { locations } = (data ?? {}) as LocationTaskData;
    if (locations && locations.length) {
      runSession.ingest(
        locations.map((l) => ({
          coords: {
            latitude: l.coords.latitude,
            longitude: l.coords.longitude,
            accuracy: l.coords.accuracy,
          },
          timestamp: l.timestamp,
        })),
      );
    }
  });
}
