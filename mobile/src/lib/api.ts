/**
 * Cliente de la API del cloud ChronoTrack (portal + /api/run de la app móvil).
 *
 * El token de sesión se inyecta con setToken() (lo maneja el AuthProvider);
 * acá solo viven las llamadas HTTP tipadas.
 */

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://chronotrack-portal.onrender.com';

/** Base pública de la API (la usa el flujo de login con Google). */
export const API_BASE = BASE;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let authToken: string | null = null;

export function setToken(token: string | null) {
  authToken = token;
}

/** Cuánto esperar una respuesta antes de darla por perdida. Sin esto, con
 *  señal mala el fetch podía quedar colgado minutos. */
export const TIMEOUT_MS = 20_000;

export const MSG_SESION_VENCIDA =
  'Tu sesión venció, volvé a ingresar; tus salidas pendientes se suben cuando entres.';

/** Callback que registra el AuthProvider para cerrar la sesión ante un 401. */
let onSesionVencida: (() => void) | null = null;

export function setOnSesionVencida(fn: (() => void) | null) {
  onSesionVencida = fn;
}

/** Por qué falló una llamada, para elegir el mensaje correcto. */
export type MotivoError = 'sin-red' | 'sesion' | 'servidor' | 'rechazada';

export function motivoDeError(e: unknown): MotivoError {
  if (e instanceof ApiError) {
    if (e.status === 0) return 'sin-red';
    if (e.status === 401) return 'sesion';
    // El servidor la leyó y dijo que no (datos inválidos): reintentar no sirve.
    if (e.status === 400 || e.status === 422) return 'rechazada';
  }
  return 'servidor';
}

/** fetch con timeout (AbortController); timeout o red caída → ApiError(0). */
async function fetchConTimeout(url: string, init: RequestInit, ms = TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch {
    throw new ApiError(
      0,
      ctrl.signal.aborted
        ? 'La conexión tardó demasiado. Revisá tu internet e intentá de nuevo.'
        : 'Sin conexión. Revisá tu internet e intentá de nuevo.',
    );
  } finally {
    clearTimeout(timer);
  }
}

/** 401 con token enviado = sesión vencida/revocada (no un login fallido).
 *  Solo cierra la sesión si ese token sigue siendo el vigente: una respuesta
 *  atrasada de una sesión anterior no debe desloguear a la nueva. */
function chequearSesion(res: Response, tokenUsado: string | null) {
  if (res.status === 401 && tokenUsado) {
    if (tokenUsado === authToken) onSesionVencida?.();
    throw new ApiError(401, MSG_SESION_VENCIDA);
  }
}

async function request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const tokenUsado = authToken;
  if (tokenUsado) headers.Authorization = `Bearer ${tokenUsado}`;
  const res = await fetchConTimeout(`${BASE}${path}`, {
    method: init?.method ?? 'GET',
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  chequearSesion(res, tokenUsado);
  if (!res.ok) {
    let detail = `Error ${res.status}`;
    try {
      const data = await res.json();
      if (typeof data?.detail === 'string') detail = data.detail;
    } catch {
      // cuerpo no-JSON: dejamos el mensaje genérico
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

// ── Tipos (espejo de los responses del cloud) ─────────────────────────────────

export type Session = { token: string; email: string; full_name: string | null; linked: number };

export type Profile = {
  email: string;
  full_name: string | null;
  username: string | null;
  weekly_goal: number;
  avatar_url: string | null;
  is_admin: boolean;
  access: boolean;
  plan: 'admin' | 'premium' | 'trial' | 'expired';
  premium_until: string | null;
  trial_ends_at: string | null;
};

export type Activity = {
  id: number;
  client_uuid: string;
  started_at: string;
  duration_s: number;
  distance_m: number;
  avg_pace_s_per_km: number | null;
};

export type ActivityDetail = Activity & { splits: number[]; polyline: string | null };

export type NewActivity = {
  client_uuid: string;
  started_at: string;
  duration_s: number;
  distance_m: number;
  avg_pace_s_per_km?: number;
  splits?: number[];
  polyline?: string;
};

export type Summary = {
  streak_weeks: number;
  week: { days_run: number; goal: number; km: number };
  month: { km: number; activities: number; days_run: number; run_dates: string[] };
};

export type PublicUser = { username: string | null; full_name: string | null; avatar_url: string | null };
export type SearchedUser = PublicUser & { relation: 'friend' | 'pending' | 'none' };
export type FriendRequest = PublicUser & { friendship_id: number };
export type FriendLists = { friends: PublicUser[]; incoming: FriendRequest[]; outgoing: FriendRequest[] };

export type RankingEntry = PublicUser & {
  is_me: boolean;
  km: number;
  days_run: number;
  activities: number;
  position: number | null;
};
export type RankingScope = 'friends' | 'global';
export type Ranking = { period: 'week' | 'month'; scope: RankingScope; since: string; entries: RankingEntry[] };

// ── Endpoints ─────────────────────────────────────────────────────────────────

export const api = {
  // Auth (compartida con el portal)
  register: (email: string, password: string, fullName?: string) =>
    request<Session>('/api/auth/register', { method: 'POST', body: { email, password, full_name: fullName || null } }),
  login: (email: string, password: string) =>
    request<Session>('/api/auth/login', { method: 'POST', body: { email, password } }),

  // Perfil
  profile: () => request<Profile>('/api/run/profile'),
  updateProfile: (patch: { username?: string; weekly_goal?: number; full_name?: string }) =>
    request<Profile>('/api/run/profile', { method: 'PATCH', body: patch }),

  // Actividades
  createActivity: (activity: NewActivity) =>
    request<Activity & { duplicated: boolean }>('/api/run/activities', { method: 'POST', body: activity }),
  activities: (limit = 30, offset = 0) =>
    request<Activity[]>(`/api/run/activities?limit=${limit}&offset=${offset}`),
  activityDetail: (id: number) => request<ActivityDetail>(`/api/run/activities/${id}`),
  deleteActivity: (id: number) =>
    request<{ deleted: boolean; id: number }>(`/api/run/activities/${id}`, { method: 'DELETE' }),
  summary: () => request<Summary>('/api/run/summary'),

  // Amigos y ranking
  searchFriends: (q: string) => request<SearchedUser[]>(`/api/run/friends/search?q=${encodeURIComponent(q)}`),
  requestFriend: (username: string) =>
    request<{ status: 'pending' | 'accepted'; friend: PublicUser }>('/api/run/friends/request', {
      method: 'POST',
      body: { username },
    }),
  acceptFriend: (friendshipId: number) =>
    request<{ status: 'accepted'; friend: PublicUser }>('/api/run/friends/accept', {
      method: 'POST',
      body: { friendship_id: friendshipId },
    }),
  friends: () => request<FriendLists>('/api/run/friends'),
  ranking: (period: 'week' | 'month', scope: RankingScope = 'friends') =>
    request<Ranking>(`/api/run/ranking?period=${period}&scope=${scope}`),

  redeemCoupon: (code: string) =>
    request<{ message: string; kind: 'free_months' | 'discount'; months?: number; percent_off?: number }>(
      '/api/run/coupons/redeem',
      { method: 'POST', body: { code } },
    ),

  // El pago premium NO se ofrece en la app (reglas de App Store/Play sobre
  // pagos externos): la suscripción vive solo en el portal web.

  deleteAccount: () =>
    request<{ deleted: boolean }>('/api/auth/account', { method: 'DELETE' }),

  /** Sube la foto de perfil (multipart; la imagen ya viene achicada del picker). */
  uploadAvatar: async (uri: string): Promise<Profile> => {
    const form = new FormData();
    // @ts-expect-error — el objeto file de React Native no matchea el tipo DOM
    form.append('file', { uri, name: 'avatar.jpg', type: 'image/jpeg' });
    const headers: Record<string, string> = {};
    const tokenUsado = authToken;
    if (tokenUsado) headers.Authorization = `Bearer ${tokenUsado}`;
    // La foto puede tardar más que un JSON: timeout más largo.
    const res = await fetchConTimeout(`${BASE}/api/run/profile/avatar`, { method: 'POST', headers, body: form }, 60_000);
    chequearSesion(res, tokenUsado);
    if (!res.ok) {
      let detail = `Error ${res.status}`;
      try {
        const data = await res.json();
        if (typeof data?.detail === 'string') detail = data.detail;
      } catch { /* cuerpo no-JSON */ }
      throw new ApiError(res.status, detail);
    }
    return (await res.json()) as Profile;
  },
};
