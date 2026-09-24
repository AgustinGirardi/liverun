/** Tests del reloj de la sesión: pausas, guardado y guardado fallido. */
import { runSession } from '../run-session';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-speech', () => ({ speak: jest.fn() }));

const T0 = 1_750_000_000_000;
let ahora = T0;
const en = (s: number) => { ahora = T0 + s * 1000; };

beforeEach(() => {
  ahora = T0;
  jest.spyOn(Date, 'now').mockImplementation(() => ahora);
  runSession.reset();
});

afterEach(() => {
  runSession.reset();
  jest.restoreAllMocks();
});

describe('markSaving / abortSaving', () => {
  it('pausa manual → guardado fallido → reanudar: no se pierde ni se suma la pausa', () => {
    runSession.start('uuid-1');
    en(10); runSession.pause(); // 10 s corridos
    en(20); runSession.markSaving();
    expect(runSession.snapshot().elapsedS).toBe(10);
    en(30); runSession.abortSaving();
    expect(runSession.snapshot().phase).toBe('paused');
    expect(runSession.snapshot().elapsedS).toBe(10);
    en(40); runSession.resume();
    en(50);
    expect(runSession.snapshot().elapsedS).toBe(20); // 10 + 10, sin los 30 s de pausa
  });

  it('corriendo → guardando: el reloj se congela mientras guarda', () => {
    runSession.start('uuid-2');
    en(10); runSession.markSaving();
    en(25);
    expect(runSession.snapshot().phase).toBe('saving');
    expect(runSession.snapshot().elapsedS).toBe(10);
    en(30); runSession.abortSaving();
    en(40);
    expect(runSession.snapshot().elapsedS).toBe(10); // sigue en pausa
    runSession.resume();
    en(45);
    expect(runSession.snapshot().elapsedS).toBe(15);
  });

  it('el client_uuid fijado al iniciar llega a finishData', () => {
    runSession.start('uuid-fijo');
    en(5);
    expect(runSession.finishData().clientUuid).toBe('uuid-fijo');
    runSession.reset();
    expect(runSession.finishData().clientUuid).toBeNull();
  });
});
