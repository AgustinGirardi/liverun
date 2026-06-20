/**
 * Sesión de salida (singleton, sin React). Acumula el tracking y lo mantiene
 * vivo cuando la pantalla está apagada/bloqueada: tanto el watcher de primer
 * plano como la tarea de ubicación en background le inyectan puntos por
 * `ingest()`. El tiempo se calcula con reloj de pared (Date.now), así no se
 * "congela" si el runtime suspende los timers de JS con el teléfono bloqueado.
 */
import * as Speech from 'expo-speech';

import { formatDuration, formatPace } from '@/lib/format';
import {
  addPoint, autoPauseStep, avgPaceSPerKm, currentPaceSPerKm, newTracker,
  type AutoPauseState, type GeoPoint, type TrackerState,
} from '@/lib/tracking';

export type Phase = 'idle' | 'running' | 'paused' | 'autopaused' | 'saving';

export type Snapshot = {
  phase: Phase;
  elapsedS: number;
  distanceM: number;
  splits: number[];
  speedMps: number;
  avgPaceSPerKm: number | null;
  curPaceSPerKm: number | null;
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
  coords: { latitude: number; longitude: number; accuracy: number | null };
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
    this.emit();
  }

  pause() {
    if (this.phase === 'running' || this.phase === 'autopaused') {
      this.autoPause = { paused: false, stillSince: null };
      this.setPhase('paused');
    }
  }
  resume() { if (this.phase === 'paused') this.setPhase('running'); }

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
      };
      const elapsedS = this.elapsedMs(loc.timestamp) / 1000;
      const res = addPoint(this.tracker, p, elapsedS);
      if (!res.accepted) continue;
      this.tracker = res.state;
      if (res.completedKm) this.announce(res.completedKm, res.state.splits);
      const ap = autoPauseStep(this.autoPause, res.state.speedMps, loc.timestamp);
      if (ap.paused !== this.autoPause.paused) this.setPhase(ap.paused ? 'autopaused' : 'running');
      this.autoPause = ap;
    }
    this.emit();
  }

  markSaving() { this.phase = 'saving'; this.emit(); }

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
    this.emit();
  }
}

export const runSession = new RunSession();
