/** Cliente HTTP: timeout y sesión vencida (401). */
import { api, ApiError, motivoDeError, setOnSesionVencida, setToken, TIMEOUT_MS } from '../api';

const respuesta = (status: number, body: unknown = {}) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

afterEach(() => {
  setToken(null);
  setOnSesionVencida(null);
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('401', () => {
  it('con token: dispara el callback de sesión vencida', async () => {
    const vencida = jest.fn();
    setOnSesionVencida(vencida);
    setToken('tok');
    global.fetch = jest.fn(async () => respuesta(401, { detail: 'x' })) as unknown as typeof fetch;
    await expect(api.profile()).rejects.toMatchObject({ status: 401 });
    expect(vencida).toHaveBeenCalledTimes(1);
  });

  it('sin token (login con clave mala): NO cierra ninguna sesión', async () => {
    const vencida = jest.fn();
    setOnSesionVencida(vencida);
    global.fetch = jest.fn(async () => respuesta(401, { detail: 'Credenciales inválidas' })) as unknown as typeof fetch;
    await expect(api.login('a@b.c', 'x')).rejects.toThrow('Credenciales inválidas');
    expect(vencida).not.toHaveBeenCalled();
  });
});

describe('timeout', () => {
  it('aborta el fetch colgado y lo informa como sin red', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_res, rej) => { init.signal.addEventListener('abort', () => rej(new Error('aborted'))); }),
    ) as unknown as typeof fetch;
    const p = api.summary();
    jest.advanceTimersByTime(TIMEOUT_MS + 1);
    const err = await p.catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(motivoDeError(err)).toBe('sin-red');
  });
});
