# RESUME — ChronoTrack Run (app móvil)

> Documento para retomar el trabajo en una próxima sesión.
> Última actualización: 2026-06-10

## Estado en una línea

**Backend `/api/run` completo, testeado (43 passed) y en producción en Render.
App Expo con login + 4 pantallas conectadas a la API real (Inicio, Historial,
Ranking, Perfil), commiteado y pusheado.** Falta: pantalla **Correr** (tracking
GPS), que es el corazón de la app.

- **Spec aprobada:** `docs/superpowers/specs/2026-06-09-mobile-run-app-design.md`
- **Backend:** `cloud/run.py` (router), `cloud/deps.py` (rate_limit/current_user
  compartidos), modelos `Activity` y `Friendship` en `cloud/models.py`,
  migración suave `_ensure_run_columns()` en `cloud/main.py`. Tests en
  `cloud/tests/test_run_*.py`. Correr con `.venv\Scripts\python.exe -m pytest cloud/tests -q`.
- **Móvil:** `mobile/` (Expo SDK 56, TypeScript, expo-router con NativeTabs).
  API client en `src/lib/api.ts` (base URL: `EXPO_PUBLIC_API_URL` o el portal de
  Render). Sesión en `src/lib/auth.tsx` (SecureStore). `npx tsc --noEmit` limpio.

## Próximos pasos (en orden)

1. **Pantalla Correr** — tracking GPS con `expo-location` foreground primero
   (funciona en Expo Go); luego background con `expo-task-manager` (requiere
   development build, NO funciona en Expo Go). Lógica pura en `src/lib/tracking.ts`:
   haversine, splits, auto-pausa — con tests Jest según la spec.
2. **Cola de sincronización offline** — guardar la salida local primero
   (expo-sqlite), subir con `client_uuid` (el backend ya deduplica).
3. **Detalle de salida** en Historial (splits; mapa cuando haya tracking).
4. **Login con Google** — endpoint backend que verifica el id_token + vincula
   por email (campo `google_id` ya existe), `expo-auth-session` en la app.
5. **Avisos de voz** por km (`expo-speech`, es-AR) y tarjeta compartible.

## Cómo probar hoy

- App: `cd mobile; npx expo start` → Expo Go en el teléfono (mismo WiFi), o `w`
  para web. Login/registro funciona contra producción.
- Para apuntar a un backend local: `EXPO_PUBLIC_API_URL=http://<ip-pc>:8002`
  y correr `python -m uvicorn cloud.main:app --port 8002` desde la raíz.

## Notas

- `mobile/AGENTS.md`: leer los docs versionados de Expo v56 antes de escribir
  código nuevo (las APIs cambiaron).
- El push a `main` auto-deploya **solo** `cloud/**` en Render; `mobile/` no
  deploya nada.
- Los usernames son únicos, lowercase (`^[a-z0-9_.]{3,30}$`); el ranking solo
  incluye amigos `accepted` (privacidad de recorridos).
