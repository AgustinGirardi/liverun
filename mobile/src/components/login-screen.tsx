import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BrandAccent, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/** Login / registro con email y contraseña (cuenta unificada con el portal). */
export function LoginScreen() {
  const { login, register } = useAuth();
  const theme = useTheme();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const inputStyle = [styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }];
  const canSubmit = email.trim().length > 3 && password.length >= 8 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(email.trim(), password);
      else await register(email.trim(), password, fullName.trim() || undefined);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Algo salió mal. Intentá de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          style={styles.form}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ThemedText style={styles.brand}>
            CHRONO<ThemedText style={[styles.brand, { color: BrandAccent }]}>TRACK</ThemedText> RUN
          </ThemedText>
          <ThemedText type="subtitle" style={styles.title}>
            {mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
            Misma cuenta que el portal de resultados.
          </ThemedText>

          {mode === 'register' && (
            <TextInput
              style={inputStyle}
              placeholder="Nombre y apellido"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="words"
              value={fullName}
              onChangeText={setFullName}
            />
          )}
          <TextInput
            style={inputStyle}
            placeholder="Email"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={inputStyle}
            placeholder="Contraseña (mínimo 8 caracteres)"
            placeholderTextColor={theme.textSecondary}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={submit}
          />

          {error && (
            <ThemedText type="small" style={styles.error}>
              {error}
            </ThemedText>
          )}

          <Pressable
            style={[styles.button, !canSubmit && styles.buttonDisabled]}
            onPress={submit}
            disabled={!canSubmit}>
            {busy ? (
              <ActivityIndicator color="#000" />
            ) : (
              <ThemedText style={styles.buttonText}>
                {mode === 'login' ? 'Entrar' : 'Crear cuenta'}
              </ThemedText>
            )}
          </Pressable>

          <Pressable onPress={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}>
            <ThemedText type="link" themeColor="textSecondary" style={styles.switch}>
              {mode === 'login' ? '¿No tenés cuenta? Crear una' : '¿Ya tenés cuenta? Iniciar sesión'}
            </ThemedText>
          </Pressable>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    justifyContent: 'center',
  },
  form: {
    gap: Spacing.two,
  },
  brand: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 3,
    textAlign: 'center',
  },
  title: {
    textAlign: 'center',
  },
  hint: {
    textAlign: 'center',
    marginBottom: Spacing.three,
  },
  input: {
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: 14,
    fontSize: 16,
  },
  error: {
    color: '#ff6b6b',
    textAlign: 'center',
  },
  button: {
    backgroundColor: BrandAccent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#000',
    fontWeight: '800',
  },
  switch: {
    textAlign: 'center',
    marginTop: Spacing.two,
  },
});
