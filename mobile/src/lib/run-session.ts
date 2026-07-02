/**
 * Sesión de salida (singleton, sin React). Acumula el tracking y lo mantiene
 * vivo cuando la pantalla está apagada/bloqueada: tanto el watcher de primer
 * plano como la tarea de ubicación en background le inyectan puntos por
 * `ingest()`. El tiempo se calcula con reloj de pared (Date.now), así no se
 * "congela" si el runtime suspende los timers de JS con el teléfono bloqueado.
 */
import * as Speech from 'expo-speech';

import { formatDuration, formatPace } from '@/lib/format';
import { clearSessionSnapshot, saveSessionSnapshot } from '@/lib/run-store';
import { buildSnapshot, restoreFields, type SessionSnapshotV1 } from '@/lib/session-snapshot';
import {
  addPoint, autoPauseStep, avgPaceSPerKm, currentPaceSPerKm, newTracker, rebaseTracker,
  type AutoPauseState, type GeoPoint, type TrackerState,
} from '@/lib/tracking';

/** Cada cuánto persistir el snapshot durante la salida (ms). */
const PERSIST_EVERY_MS = 10_000;

export type Phase = 'idle' | 'running' | 'paused' | 'autopaused' | 'saving';

export type Snapshot = {
  phase: Phase;
  elapsedS: number;
  distanceM: number;
  splits: number[];
  speedMps: number;
  avgPaceSPerKm: number | null;
  curPaceSPerKm: number | null;
  /** recorrido aceptado hasta ahora (para el mapa en vivo) */
  path: { lat: number; lon: number }[];
};

export type FinishData = {
  startedAt: Date;
  durationS: number;
  distanceM: number;
  splits: number[];
  path: { lat: number; lon: number }[];
  avgPaceSPerKm: number | null;
};

type RawLoc = {
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    /** velocidad Doppler (m/s); -1/null si el GPS no la informa */
    speed?: number | null;
  };
  timestamp: number;
};

class RunSession {
  phase: Phase = 'idle';
  private tracker: TrackerState = newTracker();
  private autoPause: AutoPauseState = { paused: false, stillSince: null };
  private startedAt: Date | null = null;
  private startMs = 0;
  private pausedAccumMs = 0;
  private pauseStartedMs = 0;
  private voiceEnabled = false;
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };
  private emit() { this.listeners.forEach((f) => f()); }

  setVoice(enabled: boolean) { this.voiceEnabled = enabled; }

  start() {
    this.tracker = newTracker();
    this.autoPause = { paused: false, stillSince: null };
    this.startedAt = new Date();
    this.startMs = Date.now();
    this.pausedAccumMs = 0;
    this.pauseStartedMs = 0;
    this.phase = 'running';
    this.persist(true);
    if (this.voiceEnabled) Speech.speak('Salida iniciada. ¡Vamos!', { language: 'es' });
    this.emit();
  }

  /** ms netos corriendo (descontando pausas) en el instante `now`. */
  private elapsedMs(now = Date.now()): number {
    if (!this.startMs) return 0;
    let paused = this.pausedAccumMs;
    if ((this.phase === 'paused' || this.phase === 'autopaused') && this.pauseStartedMs) {
      paused += now - this.pauseStartedMs;
    }
    return Math.max(0, now - this.startMs - paused);
  }

  private setPhase(next: Phase) {
    if (next === this.phase) return;
    const now = Date.now();
    const wasPaused = this.phase === 'paused' || this.phase === 'autopaused';
    const willPause = next === 'paused' || next === 'autopaused';
    if (!wasPaused && willPause) this.pauseStartedMs = now;
    if (wasPaused && !willPause && this.pauseStartedMs) {
      this.pausedAccumMs += now - this.pauseStartedMs;
      this.pauseStartedMs = 0;
    }
    this.phase = next;
    this.persist(true);
    this.emit();
  }

  pause() {
    if (this.phase === 'running' || this.phase === 'autopaused') {
      this.autoPause = { paused: false, stillSince: null };
      this.setPhase('paused');
    }
  }
  resume() {
    if (this.phase !== 'paused') return;
    // Lo caminado durante la pausa manual no cuenta: se re-ancla el GPS.
    this.tracker = rebaseTracker(this.tracker);
    this.setPhase('running');
  }

  private announce(km: number, splits: number[]) {
    if (!this.voiceEnabled) return;
    const splitS = splits[splits.length - 1];
    const total = formatDuration(Math.floor(this.elapsedMs() / 1000)).replace(':', ' minutos ') + ' segundos';
    const pace = formatPace(splitS).replace(':', ' ').replace(' /km', ' por kilómetro');
    Speech.speak(`Kilómetro ${km}. Tiempo ${total}. Último kilómetro a ${pace}.`, { language: 'es' });
  }

  /** Inyecta lecturas del GPS (de primer plano o de la tarea en background). */
  ingest(locations: RawLoc[]) {
    if (this.phase !== 'running' && this.phase !== 'autopaused') return;
    for (const loc of locations) {
      const p: GeoPoint = {
        lat: loc.coords.latitude,
        lon: loc.coords.longitude,
        t: loc.timestamp,
        accuracy: loc.coords.accuracy,
        speedMps: loc.coords.speed,
      };
      const elapsedS = this.elapsedMs(loc.timestamp) / 1000;
      const res = addPoint(this.tracker, p, elapsedS);
      // Velocidad para la auto-pausa: del tracker si aceptó; si la lectura se
      // descartó (mala precisión) pero trae Doppler, usamos esa — así la
      // pausa también funciona cuando el GPS se degrada al frenar.
      let speedForPause: number | null = null;
      if (res.accepted) {
        this.tracker = res.state;
        if (res.completedKm) this.announce(res.completedKm, res.state.splits);
        speedForPause = res.state.speedMps;
      } else if (p.speedMps != null && p.speedMps >= 0) {
        speedForPause = p.speedMps;
      }
      if (speedForPause != null) {
        const ap = autoPauseStep(this.autoPause, speedForPause, loc.timestamp);
        if (ap.paused !== this.autoPause.paused) this.setPhase(ap.paused ? 'autopaused' : 'running');
        this.autoPause = ap;
      }
    }
    this.persist();
    this.emit();
  }

  markSaving() { this.phase = 'saving'; this.emit(); }

  /** El guardado falló: la salida vuelve a pausa en vez de perderse. */
  abortSaving() {
    if (this.phase !== 'saving') return;
    this.pauseStartedMs = Date.now();
    this.phase = 'paused';
    this.persist(true);
    this.emit();
  }

  // ── Persistencia (recuperación si el SO mata la app) ────────────────────────

  private lastPersistMs = 0;

  /** Guarda el snapshot de la salida en curso (throttled; fire-and-forget). */
  private persist(force = false) {
    if (this.phase !== 'running' && this.phase !== 'paused' && this.phase !== 'autopaused') return;
    if (!this.startedAt) return;
    const now = Date.now();
    if (!force && now - this.lastPersistMs < PERSIST_EVERY_MS) return;
    this.lastPersistMs = now;
    void saveSessionSnapshot(buildSnapshot({
      phase: this.phase,
      startedAt: this.startedAt,
      netElapsedMs: this.elapsedMs(now),
      tracker: this.tracker,
      now,
    }));
  }

  /**
   * Restaura una salida guardada (tras un cierre de la app). Queda en 'paused'
   * con el tiempo neto congelado en el momento del guardado; con `autoResume`
   * retoma sola (lo usa la tarea de background cuando el corte fue breve).
   */
  restoreFrom(snap: SessionSnapshotV1, opts?: { autoResume?: boolean }) {
    if (this.phase !== 'idle') return;
    const f = restoreFields(snap, Date.now());
    this.startedAt = f.startedAt;
    this.startMs = f.startMs;
    this.pausedAccumMs = f.pausedAccumMs;
    this.pauseStartedMs = f.pauseStartedMs;
    this.tracker = f.tracker;
    this.autoPause = { paused: false, stillSince: null };
    this.phase = f.phase;
    if (opts?.autoResume) {
      this.resume();
    } else {
      this.persist(true);
      this.emit();
    }
  }

  snapshot(): Snapshot {
    const elapsedS = Math.floor(this.elapsedMs() / 1000);
    return {
      phase: this.phase,
      elapsedS,
      distanceM: this.tracker.distanceM,
      splits: this.tracker.splits,
      speedMps: this.tracker.speedMps,
      avgPaceSPerKm: avgPaceSPerKm(this.tracker.distanceM, elapsedS),
      curPaceSPerKm: this.phase === 'running' ? currentPaceSPerKm(this.tracker.speedMps) : null,
      path: this.tracker.path,
    };
  }

  finishData(): FinishData {
    const durationS = Math.max(1, Math.round(this.elapsedMs() / 1000));
    return {
      startedAt: this.startedAt ?? new Date(),
      durationS,
      distanceM: this.tracker.distanceM,
      splits: this.tracker.splits,
      path: this.tracker.path,
      avgPaceSPerKm: avgPaceSPerKm(this.tracker.distanceM, durationS),
    };
  }

  reset() {
    this.phase = 'idle';
    this.tracker = newTracker();
    this.autoPause = { paused: false, stillSince: null };
    this.startedAt = null;
    this.startMs = 0;
    this.pausedAccumMs = 0;
    this.pauseStartedMs = 0;
    this.lastPersistMs = 0;
    void clearSessionSnapshot();
    this.emit();
  }
}

export const runSession = new RunSession();
