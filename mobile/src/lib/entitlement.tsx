/**
 * Acceso premium del usuario, compartido por las pantallas que aplican el muro.
 * `access` es true durante la prueba gratis o con premium pagado (o admin);
 * cuando vence sin pagar, las funciones premium quedan tras el muro suave.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { api, type Profile } from '@/lib/api';

type EntitlementValue = {
  profile: Profile | null;
  /** Puede usar funciones premium (prueba vigente, premium o admin). */
  access: boolean;
  refresh: () => void;
};

const EntitlementContext = createContext<EntitlementValue | null>(null);

/** Reintento de la carga del perfil si falló (sin red, servidor caído). */
const REINTENTO_MS = 30_000;

export function EntitlementProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fallo, setFallo] = useState(false);

  const refresh = useCallback(() => {
    api.profile()
      .then((p) => { setProfile(p); setFallo(false); })
      // Se conserva el último perfil conocido; se marca el fallo para reintentar.
      .catch(() => setFallo(true));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Si falló, reintentar cada tanto y al volver a primer plano.
  useEffect(() => {
    if (!fallo) return;
    const id = setInterval(refresh, REINTENTO_MS);
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') refresh(); });
    return () => { clearInterval(id); sub.remove(); };
  }, [fallo, refresh]);

  // Mientras carga la primera vez, asumimos acceso para no parpadear un muro
  // que no corresponde. Si la carga falló sin ningún valor previo, NO se deja
  // acceso para siempre: false hasta que un reintento lo confirme.
  const access = profile ? profile.access : !fallo;

  return (
    <EntitlementContext.Provider value={{ profile, access, refresh }}>
      {children}
    </EntitlementContext.Provider>
  );
}

export function useEntitlement(): EntitlementValue {
  const ctx = useContext(EntitlementContext);
  if (!ctx) throw new Error('useEntitlement debe usarse dentro de <EntitlementProvider>');
  return ctx;
}
