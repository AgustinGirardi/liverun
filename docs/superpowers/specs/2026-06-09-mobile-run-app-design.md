# ChronoTrack Run — App móvil de running (diseño)

**Fecha:** 2026-06-09
**Estado:** aprobado por Agustín

## Resumen

Tercera pieza del ecosistema ChronoTrack (junto a la app de escritorio del operador
y el portal cloud de resultados): una app móvil para salir a correr, con tracking GPS,
ranking entre amigos y racha semanal. Misma marca y lenguaje visual (mint→teal).
Cuenta unificada con el portal: el corredor que reclama resultados es el mismo
usuario que registra sus salidas.

**Costo total: $0.** Render ya está pago, Google OAuth es gratis, mapas con
MapLibre + OpenFreeMap (sin tarjeta ni API key), Expo gratis. Sin tiendas por ahora:
se prueba con Expo Go y se distribuye como APK cuando esté madura.

## Decisiones tomadas

| Tema | Decisión |
|------|----------|
| Plataforma | Android primero, sin publicar ni pagar nada por ahora (Expo Go + APK de desarrollo) |
| Stack | React Native + Expo (TypeScript), carpeta `mobile/` en este mismo repo |
| Backend | Extender el cloud existente (FastAPI en Render), endpoints `/api/run/...` |
| Cuentas | Unificadas con `PortalUser` del portal |
| Login | Google Sign-In + email/contraseña (los del portal). Facebook queda para después |
| Amigos | Búsqueda por username → solicitud → aceptación mutua |
| Racha | Semanal flexible: semanas consecutivas cumpliendo tu meta (default 3 días/semana) |
| Extras v1 | Avisos de voz por km, auto-pausa, splits por km, compartir tarjeta de la salida |

## Arquitectura

```
mobile/   (nuevo)  React Native + Expo — la app del corredor
cloud/    (existe) FastAPI en Render — se extiende con /api/run/...
backend/  (existe) app de escritorio del operador — no se toca
frontend/ (existe) UI de escritorio — no se toca
```

- El `render.yaml` no cambia: el deploy del cloud sigue siendo automático al pushear.
- La base sigue siendo SQLite en el disco persistente de Render (migrable a Postgres
  como ya documenta DEPLOY.md).

## Tracking GPS

- `expo-location` con tarea en segundo plano (`expo-task-manager`): graba con la
  pantalla apagada o la app minimizada. **No funciona dentro de Expo Go**; el GPS en
  background se valida con un development build (APK gratis vía EAS o build local).
- Puntos cada ~3 s con filtro de precisión (descartar lecturas con `accuracy` mala,
  típico en los primeros segundos).
- Cálculos en el teléfono, como funciones puras testeables:
  - **Distancia:** haversine acumulada entre puntos filtrados.
  - **Ritmo:** actual (ventana móvil) y promedio.
  - **Splits:** tiempo de cada km completado.
  - **Auto-pausa:** velocidad bajo umbral sostenido → pausa; retoma al moverse.
- **Avisos de voz** cada km con `expo-speech` (es-AR): distancia, tiempo, ritmo.
- **Offline-first:** la salida se guarda primero en el teléfono (SQLite local) y se
  sube al cloud al terminar o cuando haya señal. Sin datos móviles no se pierde nada;
  queda en cola de sincronización.

## Pantallas (5 pestañas)

1. **Inicio** — racha actual, progreso de la semana contra la meta, resumen del mes.
2. **Correr** — botón grande de inicio, mapa en vivo con el recorrido dibujándose,
   métricas grandes (tiempo, km, ritmo). Pausa manual + auto-pausa.
3. **Historial** — lista de salidas; detalle con mapa del recorrido, splits por km y
   botón de compartir tarjeta (imagen con mapa + stats + marca, vía
   `react-native-view-shot` + share sheet).
4. **Ranking** — entre amigos, pestañas Semana/Mes, ordenable por km o por días
   corridos. El propio usuario aparece en la tabla.
5. **Perfil** — datos, meta semanal configurable, búsqueda de amigos y solicitudes
   pendientes, ajustes (voz on/off, unidades).

Mapas: MapLibre GL (`@maplibre/maplibre-react-native`) con tiles de OpenFreeMap.

## Login y cuentas

- **Google:** la app obtiene el `id_token` de Google (`expo-auth-session`), lo manda
  al backend, el backend lo verifica contra Google y emite su token de sesión propio
  (reutilizando la infraestructura de `cloud/security.py`). Si el email ya existe
  como cuenta del portal, se vincula (`google_id` se completa); si no, se crea.
- **Email/contraseña:** mismos endpoints que el portal ya tiene.
- `PortalUser` se extiende: `google_id` (nullable, único), `username` único (para
  búsqueda de amigos), `weekly_goal` (default 3), `avatar_url` (nullable).

## Amigos y ranking

- `Friendship`: `requester_id`, `addressee_id`, `status` (pending/accepted), timestamps.
- Búsqueda por username (mínimo 3 caracteres, rate-limited como el resto del portal).
- Solo amigos mutuos ven tus salidas y comparten ranking (privacidad: un recorrido
  revela dónde vive el usuario).
- Ranking calculado desde las actividades: suma de km y conteo de días con actividad,
  por semana o mes calendario, entre el usuario y sus amigos aceptados.

## Racha semanal

- Meta configurable por usuario (default 3 días/semana, semana lunes–domingo).
- Racha = semanas consecutivas (hacia atrás desde la última semana cerrada) en las
  que la cantidad de días con al menos una salida alcanzó la meta.
- La semana en curso suma pero nunca rompe la racha hasta que termina el domingo.
- Calendario mensual con días corridos marcados en la vista de detalle.
- Se calcula desde las actividades (sin contadores almacenados que se desincronicen).

## Datos nuevos en el cloud

- `Activity`: `user_id`, `started_at`, `duration_s` (neto, sin pausas),
  `distance_m`, `avg_pace_s_per_km`, `splits` (JSON), `polyline` (encoded polyline,
  ~2 KB por salida), `created_at`. Identificador de cliente (`client_uuid` único)
  para que la cola de sincronización no duplique salidas al reintentar.
- `Friendship` (descrita arriba).
- Endpoints nuevos bajo `/api/run/`: auth Google, CRUD de actividades (crear/listar
  propias/detalle), amigos (buscar/solicitar/aceptar/listar), ranking, perfil
  (meta semanal, username).

## Manejo de errores

- GPS sin señal o permiso denegado: la pantalla Correr lo indica claramente y no
  arranca hasta tener fix; permisos de background se piden con explicación previa.
- Subida fallida: la salida queda local marcada «pendiente de sincronizar», con
  reintento automático al abrir la app; el `client_uuid` evita duplicados.
- Token vencido: re-login silencioso con Google si es posible; si no, vuelta al login
  sin perder datos locales.

## Plan de pruebas

- **Unitarias móvil (Jest):** haversine/distancia, splits, auto-pausa, formateo de
  ritmo, lógica de cola de sincronización.
- **Unitarias backend (pytest, en `cloud/tests/`):** racha semanal, ranking,
  amistades (estados y permisos), dedupe por `client_uuid`, vinculación de cuenta
  Google con cuenta de portal existente.
- **Manual:** pantallas con Expo Go; GPS en background con development build,
  saliendo a correr de verdad.

## Fuera de alcance (v1)

- iOS (el stack lo permite después sin reescribir).
- Facebook login.
- Publicación en Play Store.
- Feed social / comentarios / likes.
- Integración con relojes (Garmin, etc.).
- Mostrar en la app los resultados de carreras del portal (queda para v2; la cuenta
  unificada deja la puerta abierta).
