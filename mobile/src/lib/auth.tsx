/**
 * Sesión del corredor: token persistido en SecureStore (nativo) o
 * localStorage (web). El root layout decide login vs. tabs según `status`.
 *
 * También sabe QUIÉN es el usuario (email), para que la cola de salidas
 * pendientes sea de cada uno y no se suba a la cuenta equivocada.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { api, MSG_SESION_VENCIDA, setOnSesionVencida, setToken, type Session } from '@/lib/api';
import { detenerTareaUbicacion } from '@/lib/location-task';
import { runSession } from '@/lib/run-session';
import { clearSessionSnapshot, setUsuarioCola } from '@/lib/run-store';

const TOKEN_KEY = 'ct_run_token';
/** Email del usuario logueado (no es secreto: solo identifica su cola local). */
const USER_KEY = 'ct_run_user';

async function loadToken(): Promise<string | null> {
  if (Platform.OS === 'web') return globalThis.localStorage?.getItem(TOKEN_KEY) ?? null;
  return SecureStore.getItemAsync(TOKEN_KEY);
}

async function storeToken(token: string | null) {
  if (Platform.OS === 'web') {
    if (token) globalThis.localStorage?.setItem(TOKEN_KEY, token);
    else globalThis.localStorage?.removeItem(TOKEN_KEY);
    return;
  }
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

async function loadUser(): Promise<string | null> {
  try { return await AsyncStorage.getItem(USER_KEY); } catch { return null; }
}

async function storeUser(email: string | null) {
  try {
    if (email) await AsyncStorage.setItem(USER_KEY, email);
    else await AsyncStorage.removeItem(USER_KEY);
  } catch {
    // mejor esfuerzo: sin esto la cola queda en la clave genérica hasta identificarlo
  }
}

type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

type AuthContextValue = {
  status: AuthStatus;
  /** email del usuario (null mientras no se pudo identificar, ej. sin red) */
  usuario: string | null;
  login: (email: string, password: string) => Promise<Session>;
  register: (email: string, password: string, fullName?: string) => Promise<Session>;
  /** Sesión emitida por el backend fuera del login normal (ej: Google). */
  loginWithToken: (token: string) => Promise<void>;
  /** Cierre de sesión manual: además descarta la salida en curso de este
   *  usuario (snapshot y GPS). Su cola de pendientes queda guardada a su nombre. */
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [usuario, setUsuario] = useState<string | null>(null);
  const vencidaRef = useRef(false);

  const fijarUsuario = useCallback(async (email: string | null) => {
    const norm = email ? email.trim().toLowerCase() : null;
    await storeUser(norm);
    await setUsuarioCola(norm);
    setUsuario(norm);
  }, []);

  useEffect(() => {
    (async () => {
      const [token, user] = await Promise.all([loadToken(), loadUser()]);
      setToken(token);
      if (token && user) {
        await setUsuarioCola(user);
        setUsuario(user);
      }
      setStatus(token ? 'authenticated' : 'anonymous');
    })();
  }, []);

  // Sesión sin usuario conocido (login con Google, o versión vieja que no lo
  // guardaba): preguntarle al backend quién es. Si falla (sin red), se
  // reintenta al volver la app a primer plano; mientras, la cola no se sube.
  useEffect(() => {
    if (status !== 'authenticated' || usuario) return;
    let alive = true;
    const identificar = () => {
      api.profile()
        .then((p) => { if (alive) return fijarUsuario(p.email); })
        .catch(() => {});
    };
    identificar();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') identificar(); });
    return () => { alive = false; sub.remove(); };
  }, [status, usuario, fijarUsuario]);

  // 401 con token: la sesión venció. Se cierra SIN tocar la cola ni la salida
  // en curso (siguen ahí cuando vuelva a entrar).
  useEffect(() => {
    setOnSesionVencida(() => {
      if (vencidaRef.current) return;
      vencidaRef.current = true;
      setToken(null);
      void storeToken(null);
      setStatus('anonymous');
      Alert.alert('Tu sesión venció', MSG_SESION_VENCIDA);
    });
    return () => setOnSesionVencida(null);
  }, []);

  async function applySession(session: Session) {
    vencidaRef.current = false;
    setToken(session.token);
    await storeToken(session.token);
    await fijarUsuario(session.email);
    setStatus('authenticated');
    return session;
  }

  const value: AuthContextValue = {
    status,
    usuario,
    login: (email, password) => api.login(email, password).then(applySession),
    register: (email, password, fullName) => api.register(email, password, fullName).then(applySession),
    loginWithToken: async (token) => {
      vencidaRef.current = false;
      setToken(token);
      await storeToken(token);
      // El email lo resuelve el efecto de arriba con /profile.
      await storeUser(null);
      await setUsuarioCola(null);
      setUsuario(null);
      setStatus('authenticated');
    },
    logout: async () => {
      setToken(null);
      await storeToken(null);
      // La salida en curso es de este usuario: no debe quedar para el próximo.
      await detenerTareaUbicacion();
      runSession.reset();
      await clearSessionSnapshot();
      await storeUser(null);
      await setUsuarioCola(null);
      setUsuario(null);
      setStatus('anonymous');
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
