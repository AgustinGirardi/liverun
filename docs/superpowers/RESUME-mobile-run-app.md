# RESUME — ChronoTrack Run (app móvil)

> Documento para retomar el trabajo en una próxima sesión de Claude Code.
> Última actualización: 2026-06-10 (sesión de kickoff)

## Estado en una línea

**Esqueleto creado y commiteado:** Expo SDK 56 + TypeScript en `mobile/`, con las 5
pestañas de la spec como placeholders y typecheck limpio. Falta TODO el contenido
(GPS, auth, backend `/api/run/...`).

## Lo que se hizo (2026-06-10)

- `npx create-expo-app` (template default SDK 56, expo-router con NativeTabs) en `mobile/`.
- 5 rutas: `index` (Inicio), `correr`, `historial`, `ranking`, `perfil` — cada una usa
  `PlaceholderScreen` (`src/components/placeholder-screen.tsx`) con la marca.
- `src/components/app-tabs.tsx`: las 5 pestañas; iconos provisorios del template
  (home/explore) hasta el pase de diseño.
- `src/constants/theme.ts`: agregados `BrandAccent` (#00e5a0) y `BrandGradient`
  (['#00bf85','#00e5a0']).
- `app.json`: name "ChronoTrack Run", slug `chronotrack-run`, scheme `chronotrackrun`.
- `src/types/css.d.ts`: declaraciones para que `npx tsc --noEmit` pase (los imports de
  CSS del template los resuelve Metro, no tsc).

## Cómo correr

- `cd mobile; npm install` (ya hecho en la PC de Agustín) y `npx expo start` → probar
  con **Expo Go** en el teléfono (misma WiFi). OJO: el GPS en background NO funciona en
  Expo Go; para eso hace falta un development build (ver spec).
- Typecheck: `cd mobile; npx tsc --noEmit`.

## Próximos pasos (en orden sugerido por la spec)

1. **Backend primero:** extender `cloud/` con `PortalUser.google_id/username/weekly_goal`,
   modelos `Activity` y `Friendship`, endpoints `/api/run/...` + tests pytest en
   `cloud/tests/`. (Deploy automático al pushear `cloud/**`.)
2. **Auth en la app:** login email/contraseña contra el portal (ya existe), luego Google.
3. **Pantalla Correr:** `expo-location` + funciones puras (haversine, splits, auto-pausa)
   con tests Jest; primero foreground, después background con dev build.
4. Historial + sync offline-first (SQLite local + `client_uuid`).
5. Racha/Inicio, Ranking/amigos, Perfil.

## Referencias

- **Spec aprobada (leer antes de codear):** `docs/superpowers/specs/2026-06-09-mobile-run-app-design.md`
- Expo SDK 56 cambió mucho: leer https://docs.expo.dev/versions/v56.0.0/ antes de
  escribir código (lo advierte `mobile/AGENTS.md`).
- El portal de producción es https://chronotrack-portal.onrender.com (cuenta unificada
  con `PortalUser`).
