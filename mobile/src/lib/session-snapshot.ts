/**
 * Serialización de la salida en curso (lógica pura, testeable sin AsyncStorage).
 *
 * Si el SO mata la app a mitad de una corrida, el snapshot persistido permite
 * recuperar distancia, splits, recorrido y tiempo neto. Al restaurar, el tiempo
 * muerto (entre savedAt y ahora) NO cuenta: la sesión vuelve re-anclada como
 * si estuviera pausada desde el momento del guardado.
 */
import { rebaseTracker, type TrackerState } from '@/lib/tracking';

export type SessionSnapshotV1 = {
  v: 1;
  phase: 'running' | 'paused' | 'autopaused';
  /** inicio real de la salida (ISO), para el registro */
  startedAt: string;
  /** epoch ms del guardado */
  savedAt: number;
  /** tiempo neto corrido (ms, sin pausas) al momento del guardado */
  netElapsedMs: number;
  tracker: TrackerState;
};

export function buildSnapshot(args: {
  phase: 'running' | 'paused' | 'autopaused';
  startedAt: Date;
  netElapsedMs: number;
  tracker: TrackerState;
  now: number;
}): SessionSnapshotV1 {
  return {
    v: 1,
    phase: args.phase,
    startedAt: args.startedAt.toISOString(),
    savedAt: args.now,
    netElapsedMs: Math.max(0, Math.round(args.netElapsedMs)),
    tracker: args.tracker,
  };
}

export type RestoredFields = {
  phase: 'paused';
  startedAt: Date;
  /** re-anclado para que elapsed = netElapsedMs guardado */
  startMs: number;
  pausedAccumMs: 0;
  pauseStartedMs: number;
  tracker: TrackerState;
};

/**
 * Reconstruye los campos de la sesión a partir del snapshot. Siempre vuelve en
 * 'paused': quien restaura decide si reanuda (el usuario, o la tarea de
 * background si el corte fue de segundos).
 */
export function restoreFields(snap: SessionSnapshotV1, now: number): RestoredFields {
  return {
    phase: 'paused',
    startedAt: new Date(snap.startedAt),
    startMs: now - snap.netElapsedMs,
    pausedAccumMs: 0,
    pauseStartedMs: now,
    tracker: rebaseTracker(snap.tracker),
  };
}

/** Valida lo mínimo para no restaurar basura de versiones viejas. */
export function isValidSnapshot(raw: unknown): raw is SessionSnapshotV1 {
  const s = raw as SessionSnapshotV1;
  return (
    !!s &&
    s.v === 1 &&
    (s.phase === 'running' || s.phase === 'paused' || s.phase === 'autopaused') &&
    typeof s.startedAt === 'string' &&
    typeof s.savedAt === 'number' &&
    typeof s.netElapsedMs === 'number' &&
    !!s.tracker &&
    typeof s.tracker.distanceM === 'number' &&
    Array.isArray(s.tracker.splits) &&
    Array.isArray(s.tracker.path)
  );
}
