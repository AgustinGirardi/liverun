import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { LoginScreen } from '@/components/login-screen';
import { AuthProvider, useAuth } from '@/lib/auth';
import { syncPending } from '@/lib/run-store';

function Gate() {
  const { status } = useAuth();

  // Al abrir la app con sesión, reintenta subir salidas pendientes (offline-first).
  useEffect(() => {
    if (status === 'authenticated') syncPending().catch(() => {});
  }, [status]);

  if (status === 'loading') return null; // el splash sigue visible
  return status === 'authenticated' ? <AppTabs /> : <LoginScreen />;
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
