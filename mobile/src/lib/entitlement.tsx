/**
 * Acceso premium del usuario, compartido por las pantallas que aplican el muro.
 * `access` es true durante la prueba gratis o con premium pagado (o admin);
 * cuando vence sin pagar, las funciones premium quedan tras el muro suave.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { api, type Profile } from '@/lib/api';

type EntitlementValue = {
  profile: Profile | null;
  /** Puede usar funciones premium (prueba vigente, premium o admin). */
  access: boolean;
  refresh: () => void;
};

const EntitlementContext = createContext<EntitlementValue | null>(null);

export function EntitlementProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);

  const refresh = useCallback(() => {
    api.profile().then(setProfile).catch(() => {});
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Mientras carga, asumimos acceso para no parpadear un muro que no corresponde.
  const access = profile ? profile.access : true;

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
