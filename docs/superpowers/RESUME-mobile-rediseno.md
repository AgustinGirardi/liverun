# RESUME — Rediseño móvil + sección web del corredor (ChronoTrack)

> Para retomar en la próxima sesión exactamente en este punto.
> Última actualización: 2026-06-27.

## Estado en una línea

Rediseño integral de la **app móvil** (Ranking, Perfil, Inicio, tarjeta de historia, fluidez) +
**nueva sección web "Mi entrenamiento"** en el portal, todo sobre la **cuenta compartida** móvil↔web.
**Todo lo móvil (hasta fluidez) y la web están DESPLEGADOS** (OTA EAS + Render). Único código sin
desplegar: el commit del **kit de UI** (refactor puro, sin cambio visual).

## Rama, commits y deploy

- **Rama de trabajo:** `feat/mobile-correr-central` · HEAD local **`1f365c8`** (kit de UI).
- **`origin/main` = `7c6dea7`** → **esto es lo desplegado** (Render web + última OTA).
- **Sólo `1f365c8` (kit) está local**, NO en main, NO en OTA. Es un refactor sin cambio visual →
  shipear cuando quieras (no urge).
- **Commits de la sesión** (más nuevo arriba):
  - `1f365c8` refactor(mobile): kit de UI compartido (Card, SectionTitle, StatTile, Segmented) — *local*
  - `7c6dea7` feat(web): sección "Mi entrenamiento" en el portal — *desplegado*
  - `f6b61b1` feat(mobile): fluidez (anillo animado, aparición escalonada, feedback al tocar)
  - `83ddb28` feat(mobile): Inicio minimalista (hero meta+mes, más aire)
  - `d240ec4` feat(mobile): StoryCard unificada 9:16 (foto al terminar + compartir historial)
  - `7c1cd1a` feat(mobile): solicitudes agrupadas + Ranking con scope en tabs
  - (antes, tarea previa: `5fd9dbe`…`3b81720` — script publish, perfil/ranking iniciales, workflow OTA, eslint)

## Qué está desplegado y cómo verlo

- **App móvil = OTA EAS** (branch EAS `main`, runtime `exposdk:54.0.0`, iOS+Android). Últimos updates
  publicados a mano esta sesión (grupos `bb92f2de` rediseño y `2109e72e` fluidez). **Para verlo:
  cerrar del todo y reabrir la app** (Expo Go SDK 54). No incluye el kit (1f365c8).
- **Portal web = Render**, auto-deploy al pushear `cloud/**` a `main` (ya pusheado). Ir a
  https://chronotrack-portal.onrender.com → login con la cuenta del móvil → nav **🏃 Mi progreso**
  (racha, km del mes, anillo de meta, gráfico km/semana, récords, ranking de amigos).
- **Pipeline OTA:** secret `EXPO_TOKEN` seteado; workflow `.github/workflows/eas-update.yml` probado
  **en verde**. Ojo footgun: dispara en push de `mobile/**` en CUALQUIER rama y publica a prod.

## Decisiones tomadas (para no re-litigar)

- **Ranking — barra superior = opción B:** scope (Amigos / 🌎 Mundial) como **tabs subrayadas** +
  fila chica con período (Semana/Mes, `Segmented`) y orden (chip `por km ⇅` que togglea km/días).
- **Solicitudes de amistad:** Ranking es el hub social (buscador + lista + solicitudes); Perfil queda
  "vos" + un **botón agrupado desplegable** de solicitudes. Ambos usan `FriendRequests` (compartido).
- **StoryCard:** una sola tarjeta 9:16, **esquinas rectas**, stats ancladas abajo sobre velo
  (km nunca tapado); con o sin foto (cámara/galería). Unifica `run-photo-card` + `share-card` (borrados).
- **Fluidez:** se usó el **Animated nativo de RN** (no Reanimated worklets) por robustez — no hay
  `babel.config.js` y no pude verificar el plugin de worklets. `FadeIn` (aparición), `Ring` animado,
  feedback de presión en botones de Correr; en web: fade de vistas + hover + barras animadas (CSS).
- **Web (#9):** sin backend nuevo — la app móvil ya pega al backend del portal
  (`mobile/src/lib/api.ts` BASE = portal, `/api/auth/*` + `/api/run/*`), así que la sección web lee
  los mismos endpoints con el mismo token.

## Pendiente / próximos pasos

1. **Shipear el kit `1f365c8`** si se quiere (OTA + merge a main). Refactor sin cambio visual → sin apuro.
2. **Barrido de cortes (#3):** sólo se arregló el confirmado (foto). Falta que el usuario pruebe la OTA
   y reporte qué pantalla se ve cortada/mal dimensionada; atacar puntual (no hay preview móvil sin login).
3. **Footgun del workflow:** si molesta que push de feature branch mande OTA a prod, acotar el trigger a
   `branches: [main]` en `.github/workflows/eas-update.yml`.
4. **Nit CI:** el workflow usa Node 20 (deprecado en runners de GitHub) → bump a 22.

## Archivos clave (de esta sesión)

- **Kit:** `mobile/src/components/ui.tsx` (`Card`, `useCardStyle`, `SectionTitle`, `StatTile`, `Segmented`).
- **Componentes nuevos:** `friend-requests.tsx`, `story-card.tsx`, `fade-in.tsx`; `ring.tsx` (animado).
- **Pantallas tocadas:** `app/{index,perfil,ranking,correr,historial}.tsx`.
- **Web:** `cloud/static/app.js` (`viewRun`/`renderRun` + `kmByWeekRun`/`recordsRun` + nav/route) y
  `cloud/static/styles.css` (sección "Mi entrenamiento" + fluidez `#app > *` rise, `.bar` growbar).

## Cómo verificar (lo que se usó esta sesión)

- **Portal local:** `.venv/Scripts/python -m uvicorn cloud.main:app --port 8002` desde la raíz; abrir
  http://127.0.0.1:8002. Para ver `viewRun` sin una cuenta con datos: inyectar datos mock en la consola
  y llamar `renderRun(summary, acts, ranking)` (se hizo así y renderizó bien — ring, gráfico, ranking).
- **Móvil:** no hay preview en vivo sin login/datos → publicar OTA y mirar en el teléfono. Publish:
  `npx eas-cli update --branch main --message "..."` desde `mobile/` (el script `npm run publish` falla:
  llama a `eas` global no instalado).

## Memoria relacionada

`deploy-pipeline.md` (OTA/Render + footgun), `mobile-design-preview.md` (gotchas de preview/Expo Go).
