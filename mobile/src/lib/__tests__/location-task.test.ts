/** La tarea de background no debe reanudar sola una pausa manual. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as TaskManager from 'expo-task-manager';

import '../location-task';
import { runSession } from '../run-session';
import { buildSnapshot } from '../session-snapshot';
import { newTracker } from '../tracking';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-speech', () => ({ speak: jest.fn() }));
jest.mock('expo-location', () => ({
  hasStartedLocationUpdatesAsync: jest.fn(async () => false),
  stopLocationUpdatesAsync: jest.fn(async () => {}),
}));

jest.mock('expo-task-manager', () => ({
  isTaskDefined: () => false,
  defineTask: jest.fn(),
}));

type TaskFn = (body: { data: unknown; error: unknown }) => Promise<void>;
/** El callback que location-task registró al importarse. */
const tarea = (TaskManager.defineTask as jest.Mock).mock.calls[0][1] as TaskFn;

async function guardarSnapshot(phase: 'running' | 'paused' | 'autopaused') {
  const now = Date.now();
  const snap = buildSnapshot({
    phase,
    startedAt: new Date(now - 600_000),
    netElapsedMs: 300_000,
    tracker: { ...newTracker(), distanceM: 1500 },
    now,
    clientUuid: 'uuid-x',
  });
  await AsyncStorage.setItem('ct_run_session_v1', JSON.stringify(snap));
}

const lectura = () => ({
  locations: [{ coords: { latitude: -31.4, longitude: -64.18, accuracy: 5, speed: 3 }, timestamp: Date.now() }],
});

beforeEach(async () => {
  runSession.reset();
  await AsyncStorage.clear();
});

describe('tarea de ubicación tras un relanzado del proceso', () => {
  it('snapshot en pausa manual: se restaura pero sigue en pausa', async () => {
    await guardarSnapshot('paused');
    await tarea({ data: lectura(), error: null });
    expect(runSession.snapshot().phase).toBe('paused');
    expect(runSession.snapshot().distanceM).toBe(1500);
  });

  it('snapshot corriendo: retoma sola', async () => {
    await guardarSnapshot('running');
    await tarea({ data: lectura(), error: null });
    expect(runSession.snapshot().phase).toBe('running');
    expect(runSession.finishData().clientUuid).toBe('uuid-x');
  });
});
