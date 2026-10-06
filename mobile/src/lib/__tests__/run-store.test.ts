/** Cola de salidas pendientes: por usuario, sin carreras, quita por client_uuid. */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ApiError, type NewActivity } from '@/lib/api';
import {
  claveCola, enqueueActivity, pendingActivities, saveActivity, setUsuarioCola, syncPending,
} from '../run-store';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const mockCreate = jest.fn();
jest.mock('@/lib/api', () => {
  const real = jest.requireActual('@/lib/api');
  return { ...real, api: { createActivity: (a: unknown) => mockCreate(a) } };
});

const act = (id: string): NewActivity => ({
  client_uuid: id,
  started_at: '2026-09-23T10:00:00.000Z',
  duration_s: 1800,
  distance_m: 5000,
});

beforeEach(async () => {
  await AsyncStorage.clear();
  mockCreate.mockReset();
  await setUsuarioCola('ana@x.com');
});

describe('cola por usuario', () => {
  it('cada usuario ve solo su cola; el siguiente no sube las del anterior', async () => {
    await enqueueActivity(act('a1'));
    await setUsuarioCola('beto@x.com');
    expect(await pendingActivities()).toEqual([]);
    mockCreate.mockResolvedValue({});
    await syncPending();
    expect(mockCreate).not.toHaveBeenCalled();
    await setUsuarioCola('ana@x.com');
    expect((await pendingActivities()).map((a) => a.client_uuid)).toEqual(['a1']);
  });

  it('migra la clave vieja (global) al primer usuario que se identifica', async () => {
    await setUsuarioCola(null);
    await AsyncStorage.setItem('ct_run_pending_uploads', JSON.stringify([act('vieja')]));
    await setUsuarioCola('Ana@X.com'); // normaliza mayúsculas
    expect((await pendingActivities()).map((a) => a.client_uuid)).toEqual(['vieja']);
    expect(await AsyncStorage.getItem('ct_run_pending_uploads')).toBeNull();
    expect(await AsyncStorage.getItem(claveCola('ana@x.com'))).not.toBeNull();
  });

  it('sin usuario identificado no sube nada', async () => {
    await setUsuarioCola(null);
    await enqueueActivity(act('x'));
    await syncPending();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('encolar dos veces la misma salida no la duplica', async () => {
    await enqueueActivity(act('a1'));
    await enqueueActivity(act('a1'));
    expect(await pendingActivities()).toHaveLength(1);
  });
});

describe('syncPending', () => {
  it('una salida agregada durante la subida no se pierde', async () => {
    await enqueueActivity(act('a1'));
    let liberar!: () => void;
    mockCreate.mockImplementationOnce(
      () => new Promise((res) => { liberar = () => res({}); }),
    );
    const sync = syncPending();
    // Mientras a1 está "en vuelo", se termina otra salida.
    await new Promise((r) => setTimeout(r, 0));
    await enqueueActivity(act('a2'));
    liberar();
    const res = await sync;
    expect(res.uploaded).toBe(1);
    expect((await pendingActivities()).map((a) => a.client_uuid)).toEqual(['a2']);
  });

  it('dos syncPending en paralelo no suben dos veces la misma salida', async () => {
    await enqueueActivity(act('a1'));
    mockCreate.mockResolvedValue({});
    await Promise.all([syncPending(), syncPending()]);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(await pendingActivities()).toEqual([]);
  });

  it('distingue sin red / sesión vencida / servidor, y un 401 no borra la cola', async () => {
    await enqueueActivity(act('a1'));
    mockCreate.mockRejectedValueOnce(new ApiError(0, 'sin red'));
    expect((await syncPending()).motivo).toBe('sin-red');
    mockCreate.mockRejectedValueOnce(new ApiError(401, 'vencida'));
    expect((await syncPending()).motivo).toBe('sesion');
    mockCreate.mockRejectedValueOnce(new ApiError(500, 'boom'));
    expect((await syncPending()).motivo).toBe('servidor');
    expect(await pendingActivities()).toHaveLength(1);
  });

  it('una salida rechazada (422) sale de la cola y no frena a las demás', async () => {
    await enqueueActivity(act('mala'));
    await enqueueActivity(act('buena'));
    mockCreate
      .mockRejectedValueOnce(new ApiError(422, 'Ese ritmo no es posible corriendo.'))
      .mockResolvedValueOnce({});
    const res = await syncPending();
    expect(res.uploaded).toBe(1);
    expect(res.rechazadas).toEqual([
      { actividad: expect.objectContaining({ client_uuid: 'mala' }), detalle: 'Ese ritmo no es posible corriendo.' },
    ]);
    expect(await pendingActivities()).toEqual([]);
  });

  it('saveActivity informa si se subió', async () => {
    mockCreate.mockResolvedValueOnce({});
    expect(await saveActivity(act('ok'))).toEqual({ uploaded: true, motivo: null });
    mockCreate.mockRejectedValueOnce(new ApiError(0, 'sin red'));
    expect(await saveActivity(act('no'))).toEqual({ uploaded: false, motivo: 'sin-red' });
  });
});
