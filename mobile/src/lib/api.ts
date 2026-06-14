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

async function request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: init?.method ?? 'GET',
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Sin conexión. Revisá tu internet e intentá de nuevo.');
  }
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

  billingInfo: () =>
    request<{ available: boolean; price: number; base_price: number; currency: string; discount_percent: number | null }>(
      '/api/run/billing/info',
    ),
  subscribe: () =>
    request<{ init_point: string; amount: number; currency: string }>('/api/run/billing/subscribe', { method: 'POST' }),

  /** Sube la foto de perfil (multipart; la imagen ya viene achicada del picker). */
  uploadAvatar: async (uri: string): Promise<Profile> => {
    const form = new FormData();
    // @ts-expect-error — el objeto file de React Native no matchea el tipo DOM
    form.append('file', { uri, name: 'avatar.jpg', type: 'image/jpeg' });
    const headers: Record<string, string> = {};
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(`${BASE}/api/run/profile/avatar`, { method: 'POST', headers, body: form });
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
