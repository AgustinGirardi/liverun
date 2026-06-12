/**
 * Sesión del corredor: token persistido en SecureStore (nativo) o
 * localStorage (web). El root layout decide login vs. tabs según `status`.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { api, setToken, type Session } from '@/lib/api';

const TOKEN_KEY = 'ct_run_token';

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

type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

type AuthContextValue = {
  status: AuthStatus;
  login: (email: string, password: string) => Promise<Session>;
  register: (email: string, password: string, fullName?: string) => Promise<Session>;
  /** Sesión emitida por el backend fuera del login normal (ej: Google). */
  loginWithToken: (token: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');

  useEffect(() => {
    loadToken().then((token) => {
      setToken(token);
      setStatus(token ? 'authenticated' : 'anonymous');
    });
  }, []);

  async function applySession(session: Session) {
    setToken(session.token);
    await storeToken(session.token);
    setStatus('authenticated');
    return session;
  }

  const value: AuthContextValue = {
    status,
    login: (email, password) => api.login(email, password).then(applySession),
    register: (email, password, fullName) => api.register(email, password, fullName).then(applySession),
    loginWithToken: async (token) => {
      setToken(token);
      await storeToken(token);
      setStatus('authenticated');
    },
    logout: async () => {
      setToken(null);
      await storeToken(null);
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
