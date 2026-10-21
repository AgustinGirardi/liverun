# RESUME — ChronoTrack Run (app móvil)

> Documento para retomar el trabajo en una próxima sesión.
> Última actualización: 2026-06-10

## Estado en una línea

**Backend `/api/run` en producción (43 tests). App con las 5 pantallas
funcionando: login + Inicio/Historial/Ranking/Perfil conectadas a la API, y
Correr con GPS foreground, splits con voz, auto-pausa y cola offline
(15 tests Jest).** OJO: el proyecto se bajó a **Expo SDK 54** (2026-06-11)
porque Expo Go del App Store de iOS no soporta SDK 56 aún y el usuario prueba
en un iPhone 13 Pro Max — ver nota en `mobile/AGENTS.md`.

- **Spec aprobada:** `docs/superpowers/specs/2026-06-09-mobile-run-app-design.md`
- **Backend:** `cloud/run.py` (router), `cloud/deps.py` (rate_limit/current_user
  compartidos), modelos `Activity` y `Friendship` en `cloud/models.py`,
  migración suave `_ensure_run_columns()` en `cloud/main.py`. Tests en
  `cloud/tests/test_run_*.py`. Correr con `.venv\Scripts\python.exe -m pytest cloud/tests -q`.
- **Móvil:** `mobile/` (Expo SDK 56, TypeScript, expo-router con NativeTabs).
  API client en `src/lib/api.ts` (base URL: `EXPO_PUBLIC_API_URL` o el portal de
  Render). Sesión en `src/lib/auth.tsx` (SecureStore). `npx tsc --noEmit` limpio.

## Próximos pasos (en orden)

1. **Detalle de salida** en Historial (splits por km; el polyline ya se sube,
   el mapa espera al development build).
2. **Login con Google** — endpoint backend que verifica el id_token + vincula
   por email (campo `google_id` ya existe), `expo-auth-session` en la app.
3. **Tarjeta compartible** de la salida (`react-native-view-shot` + share sheet).
4. **Development build** (Android primero): GPS en background con
   `expo-task-manager` + mapa en vivo con MapLibre (no funcionan en Expo Go).
5. Ajustes en Perfil: voz on/off, unidades.

La lógica de tracking vive en `src/lib/tracking.ts` (pura, 15 tests en
`src/lib/__tests__/tracking.test.ts`; `npm test` corre Jest con preset
jest-expo). Cola offline en `src/lib/run-store.ts` (AsyncStorage; se
sincroniza al abrir la app y al guardar).

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
