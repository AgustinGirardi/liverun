/** Tests del formateo y del parseo de fechas del servidor. */
import { formatPace, parseFechaServidor } from '../format';

describe('parseFechaServidor', () => {
  const utc = Date.UTC(2026, 8, 23, 1, 0, 0); // 2026-09-23 01:00 UTC

  it('ISO sin zona (servidor viejo) se toma como UTC, no como hora local', () => {
    expect(parseFechaServidor('2026-09-23T01:00:00').getTime()).toBe(utc);
  });

  it('ISO con "Z" (servidor nuevo) da el mismo instante', () => {
    expect(parseFechaServidor('2026-09-23T01:00:00Z').getTime()).toBe(utc);
    expect(parseFechaServidor('2026-09-23T01:00:00.000Z').getTime()).toBe(utc);
  });

  it('respeta un offset explícito', () => {
    expect(parseFechaServidor('2026-09-22T22:00:00-03:00').getTime()).toBe(utc);
    expect(parseFechaServidor('2026-09-23T01:00:00+00:00').getTime()).toBe(utc);
  });

  it('tolera microsegundos de Python y separador con espacio', () => {
    expect(parseFechaServidor('2026-09-23T01:00:00.123456').getTime()).toBe(utc + 123);
    expect(parseFechaServidor('2026-09-23 01:00:00').getTime()).toBe(utc);
  });

  it('lo que genera la app (toISOString) vuelve igual', () => {
    const d = new Date(utc + 4567);
    expect(parseFechaServidor(d.toISOString()).getTime()).toBe(d.getTime());
  });
});

describe('formatPace', () => {
  it('formato normal', () => {
    expect(formatPace(300)).toBe('5:00 /km');
    expect(formatPace(305.4)).toBe('5:05 /km');
  });

  it('nunca devuelve ":60" cuando los segundos redondean para arriba', () => {
    expect(formatPace(299.6)).toBe('5:00 /km');
    expect(formatPace(359.5)).toBe('6:00 /km');
    expect(formatPace(59.7)).toBe('1:00 /km');
  });

  it('sin dato → guiones', () => {
    expect(formatPace(null)).toBe('--:-- /km');
    expect(formatPace(Infinity)).toBe('--:-- /km');
  });
});
