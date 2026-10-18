import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useEffect } from 'react';
import { AppState, useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { LoginScreen } from '@/components/login-screen';
import { AuthProvider, useAuth } from '@/lib/auth';
import { EntitlementProvider } from '@/lib/entitlement';
import '@/lib/location-task'; // registra la tarea de ubicación en background
import { syncPending } from '@/lib/run-store';

function Gate() {
  const { status, usuario } = useAuth();

  // Con sesión y usuario identificado, reintenta subir salidas pendientes
  // (offline-first): al abrir y cada vez que la app vuelve a primer plano.
  useEffect(() => {
    if (status !== 'authenticated' || !usuario) return;
    syncPending().catch(() => {});
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') syncPending().catch(() => {});
    });
    return () => sub.remove();
  }, [status, usuario]);

  if (status === 'loading') return null; // el splash sigue visible
  if (status !== 'authenticated') return <LoginScreen />;
  return (
    <EntitlementProvider>
      <AppTabs />
    </EntitlementProvider>
  );
}

export default function TabLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <AnimatedSplashOverlay />
        <Gate />
      </AuthProvider>
    </ThemeProvider>
  );
}
