# Plan: rescatar `backup/hardening-local-7-commits` sobre `main` por cherry-pick

## Contexto

`main` = `origin/main` = `c55b2b2`. La rama backup sale de `67b6253` y trae 7 commits del 19 y 20/9 con UI móvil, accesibilidad, docs y un preview web. No trae hardening. Desde entonces `main` sumó 18 commits: el portal reescrito en módulos (`cloud/static/js/...`, con el viejo `app.js` borrado), el rediseño "Pista nocturna" en escritorio y portal, y los arreglos móviles de pérdida de datos (cola de pendientes en `historial.tsx`, `AppState` en `_layout.tsx`).

Simulé cada cherry-pick con `git merge-tree` sin tocar nada. Este es el veredicto por commit:

| Commit | Qué trae | Choque con main | Decisión |
|---|---|---|---|
| `16c31b4` móvil: tema claro, display, a11y | Tokens `accent/accentSurface/onAccent/warning/danger` por apariencia, `line()`, roles y labels, Reduce Motion, íconos SVG (`icon.tsx`), FAB contenido, Predictive Back, **fuente Barlow Condensed** | `historial.tsx`: conflicto en `styles`. Además el `PendientesBlock` nuevo de main usa `BrandAccent`, que el commit saca del import, así que `tsc` rompería | **Se adapta.** Cherry-pick con `-n`. Se resuelve `historial.tsx` y **se deja afuera Barlow Condensed** (ver abajo) |
| `6503c83` móvil: deps SDK 54 | Parches `expo 54.0.37`, `expo-constants`, `expo-updates`, `jest-expo`; fallback de fuente; `iniciar-metro.bat` (Expo Go); `abrir-firewall.bat` | `_layout.tsx`, solo porque depende del `useFonts` de Barlow | **Se adapta.** Entran los bumps y el lockfile. Se descartan el hunk de la fuente (sin Barlow no hace falta) e `iniciar-metro.bat`, porque el propio `7f63c2b` dice que Expo Go ya no sirve. `abrir-firewall.bat` queda porque lo usa `ver-en-navegador.bat` |
| `7f63c2b` móvil: target web PWA | `+html.tsx`, `manifest.json`, íconos, `vercel.json` (proxy `/api`), scripts `.bat`, devDependency `@expo/ngrok` | Solo `package-lock.json`, por el orden de los commits | **Se adapta.** Se saca `@expo/ngrok`: no lo usa nada (ningún `--tunnel`) y el estándar pide dependencias mínimas. Con eso se van sus 510 líneas de lock. En el viewport se sacan `maximum-scale=1, user-scalable=no`, porque bloquear el zoom contradice el objetivo de accesibilidad (WCAG 1.4.4) |
| `4e7e6b0` móvil: deploy a Vercel | Dominio fijo `liverun-ochre.vercel.app`, copia `vercel.json` a `dist` | Ninguno sobre `7f63c2b` | **Se aplica** tal cual |
| `c36469e` escritorio: Escape y foco | `useEscape` en 3 modales, `onFocus`/`onBlur` que copian el hover, nav con `role`/`tabIndex` | `App.jsx`: conflicto | **Se adapta a mano, en un commit nuevo.** Main ya lo cubre casi todo: `useEscape` (`frontend/src/App.jsx:3255`) en `EmailControls`, `AccountControls` (con `!waiting`), `CloudControls` y `DialogHost`; la nav, el logo y las filas del inicio ya son `<button>`; y hay `button:focus-visible` global (`frontend/src/index.css`). Faltan dos superficies que siguen siendo `<div onClick>` sin teclado: `RaceResultCard` (`App.jsx:3186`) y las sugerencias de corredor de `InscriptosView` (`App.jsx:1135`). Pasan a `<button>`, con el mismo patrón que las tarjetas de carreras (`App.jsx:2840`). Los `onFocus` sobre `div` del commit original se descartan: sin `tabIndex` no hacen nada |
| `dfefc9b` portal: contraste AA | `--acc-txt`, `--mut`/`--dim`, `.grad-text` sólido, sobre el `app.js` viejo; `.impeccable/config.json` | `app.js` (modify/delete), `styles.css`, `.gitignore` | **Se adapta a mano, en un commit nuevo.** Main ya resolvió el texto con los tokens `--acc-ink` (`--mut #56626B`, `--dim #5F6B74`, sin texto en degradado). Falta una sola cosa: las marcas gráficas con datos siguen en `var(--acc)`, que en claro es `#54BFA3` y da unos 2.2:1 cuando WCAG 1.4.11 pide 3:1. Son `.bar.cur` (`styles.css:362`), la línea y los puntos de `js/pantallas/historial.js:128,143` y el anillo de `js/pantallas/progreso.js:85`, y pasan a `var(--acc-ink)`. En oscuro no cambia nada (`--acc-ink` = `--acc`). Se descartan `.impeccable/config.json` y su `.gitignore`: ya está en `.git/info/exclude` y sus supresiones apuntan al `app.js` borrado |
| `b8d91ff` docs | `PRODUCT.md`, `AUDITORIA-WEB.md`, `PENDIENTES.md` | Ninguno (archivos nuevos) | **Se adapta.** `AUDITORIA-WEB.md` se descarta porque audita el portal y el escritorio viejos: el `:focus-visible` y los íconos SVG que pedía ya están en main (`cloud/static/js/ui/iconos.js`, `Icon` en `App.jsx:528`). `PRODUCT.md` entra, sin la referencia a Barlow ni a `/impeccable`. `PENDIENTES.md` entra recortado a lo que sigue abierto, sobre todo la verificación en dispositivo de lo rescatado |

**Por qué Barlow Condensed queda afuera.** El brief de "Pista nocturna" (`HANDOFF.md`, sección 1) fija la tipografía de display en `ui-rounded, "SF Pro Rounded"` con peso 800, y así la usan el escritorio (`FONT_DISPLAY`, `App.jsx:467`) y el portal (`--font-display`). Meter una condensada solo en el móvil rompe la marca compartida que pediste respetar. Cada `fontFamily: Display.x` vuelve al `fontWeight` que reemplazaba (el diff del commit los muestra uno por uno). No se agregan los `.ttf` ni `OFL.txt`, y en `_layout.tsx` no entra `useFonts`. Si preferís conservarla, es volver a meter esos hunks. El original sigue intacto en la rama backup.

## Cambios

Todo en una rama nueva **`rescate/movil-a11y`** desde `main` (`c55b2b2`). Uso `git cherry-pick -x` para que cada commit apunte a su original. La rama backup no se toca, no se renombra y no se borra. No hay push ni merge.

1. **`16c31b4`** → `cherry-pick -x -n`, y antes de commitear:
   - `mobile/src/app/historial.tsx`: en `styles` se queda lo de main (`pendWrap`, `pendBlock`, `pendBadge`) con `deleteText: {}` del commit. En `PendientesBlock`, `BrandAccent` → `theme.accent` en los dos usos. El copy de main no se toca.
   - Sin Barlow: se sacan `mobile/assets/fonts/*`, `Display` en `mobile/src/constants/theme.ts`, `useFonts` en `_layout.tsx`, y cada `Display.*` vuelve a su `fontWeight` en `correr.tsx`, `perfil.tsx`, `index.tsx`, `ranking.tsx`, `story-card.tsx`, `themed-text.tsx` y `login-screen.tsx`.
   - Se revisan con `grep` los archivos que main tocó y git mergeó solo (`correr.tsx`, `perfil.tsx`, `login-screen.tsx`, `_layout.tsx`), buscando `BrandAccent` o hex sueltos que hayan quedado sin token.
   - El commit lleva el mensaje original más una línea que explica qué se dejó afuera y por qué.
2. **`6503c83`** → `-n`: entran `package.json`, `package-lock.json` y `abrir-firewall.bat`. Se descartan el hunk de `_layout.tsx` e `iniciar-metro.bat`. Después `npm ci` en `mobile/`, que además prueba que el lock y el `package.json` coinciden.
3. **`7f63c2b`** → `-n`: sin `@expo/ngrok` en `package.json` y con el `package-lock.json` restaurado al del paso 2, más el viewport sin bloqueo de zoom en `mobile/src/app/+html.tsx`. En el comentario de `ver-en-navegador.bat`, la IP fija pasa a "la IP de tu PC".
4. **`4e7e6b0`** → `cherry-pick -x` directo.
5. **Escritorio** (commit nuevo, referencia `c36469e`): `RaceResultCard` y las sugerencias de `InscriptosView` pasan a `<button>` con `textAlign: "left"`, `width: "100%"` y `color: C.fg`, igual que las tarjetas de carreras. Así heredan el `:focus-visible` global y Enter/Espacio sin código extra.
6. **Portal** (commit nuevo, referencia `dfefc9b`): las marcas gráficas pasan a `--acc-ink` en `styles.css`, `historial.js` y `progreso.js`.
7. **Docs** (commit nuevo, referencia `b8d91ff`): `PRODUCT.md` y `PENDIENTES.md` adaptados, en la raíz como `DEPLOY.md` y `HANDOFF.md`.

## Tests

Primero corro las suites sobre `main`, para tener el conteo de base.

**Nuevos** (cada uno se ve fallar antes del cambio que cubre):
- `mobile/src/constants/__tests__/theme.test.ts` (jest-expo): contraste WCAG calculado en el test.
  - En las dos apariencias, `text`, `textSecondary`, `accent`, `danger` y `warning` dan ≥ 4.5:1 contra `background` y `backgroundElement`.
  - `onAccent` da ≥ 4.5:1 sobre `accentSurface`.
  - `line()` escala con `PixelRatio.getFontScale` (mockeado a 2).
  - Hay una excepción: el `warning` oscuro (`#f5a524`) se usa como relleno o acento, así que el umbral ahí es ≥ 3.
  - Si jest no puede importar el `@/global.css` que importa `theme.ts`, lo mockeo dentro del test (`jest.mock(..., { virtual: true })`), sin tocar la config.
- `cloud/tests/test_portal_estaticos.py`, con el mismo estilo que `test_index_no_tiene_handlers_en_linea`:
  - `test_marcas_de_datos_usan_acento_con_contraste`: `/styles.css` (`.bar.cur`), `/js/pantallas/historial.js` y `/js/pantallas/progreso.js` no pintan datos con `var(--acc)` sino con `var(--acc-ink)`.
  - `test_tokens_de_texto_pasan_aa_en_los_dos_temas`: parsea `:root` y `[data-theme="dark"]` y verifica que `--txt`, `--mut`, `--dim` y `--acc-ink` den ≥ 4.5:1 contra `--bg` y `--panel`. Es un guard para que el contraste no se pierda de nuevo.

**Escritorio:** `frontend/` no tiene runner de tests y no sumo vitest para dos `<div>` → `<button>`. Ya se decidió así en el plan del 18/10: sería una dependencia nueva fuera de alcance. Se cubre con lint, build y una prueba manual de teclado (Verificación). Lo dejo dicho, como piden los estándares.

No se borra ni se saltea ningún test, y no hay tests existentes que actualizar.

## Riesgos

- **El push futuro dispara la OTA de EAS** (`.github/workflows/eas-update.yml`, `paths: mobile/**`). Los bumps de deps y el cambio en `app.json` (Predictive Back) cambian el *fingerprint*, así que esa OTA no le llega a los builds instalados: hace falta un build nuevo. Hoy no aplica, porque no pusheo, pero tiene que estar en la revisión.
- **Predictive Back, FAB, `line()` y Reduce Motion** pasan tsc, lint y jest, pero solo se validan en un dispositivo. Van como bloqueantes en `PENDIENTES.md`.
- **Lockfile:** `6503c83` reescribe unas 2.500 líneas de `package-lock.json`. Lo mitigo con `npm ci` más las tres verificaciones móviles. Si `npm ci` falla, freno y lo reporto.
- **Proxy de Vercel:** todo el tráfico del PWA llega al backend desde IPs de Vercel. `cloud/deps.py` llavea el rate limit por la última IP de `X-Forwarded-For`, así que todos los usuarios del preview comparten un mismo balde. Como es para revisión personal, alcanza, pero queda anotado. El login con Google desde ese dominio no está verificado.
- **Sacar Barlow es una decisión de diseño:** si no coincide con lo que querés, lo decís en la revisión y se revierte sin costo.
- `npm ci` deja `mobile/node_modules` con las versiones de la rama nueva. Al volver a `main` hay que correr `npm ci` otra vez.

## Verificación

1. `git status` limpio en `main`, crear la rama y correr las suites de base.
2. Después de **cada** commit en móvil: `cd mobile && npx tsc --noEmit && npm run lint && npm test`. Así un error queda pegado al commit que lo trajo.
3. Al final, todas las suites:
   - Portal y backend: `.venv/Scripts/python -m pytest cloud/tests backend/tests -q`
   - Móvil: `cd mobile && npm ci && npm test && npm run lint && npx tsc --noEmit`, más `npx expo export --platform web` para validar `+html.tsx` y el target web (sale a `dist/`, que está ignorado).
   - Escritorio: `cd frontend && npm run lint && npm run build`
4. Revisiones con `grep` en el árbol final: que no quede `BarlowCondensed`, `Display.` ni `@expo/ngrok`, ni ningún `BrandAccent` fuera de la tarjeta para compartir, el mapa y el FAB.
5. Manual, opcional: en el escritorio, `npm run dev`, recorrer con Tab el Historial y las sugerencias de corredor y confirmar el anillo de foco y que Enter abre. En el portal, el tema claro en `/` → "Mi progreso", con la barra, la línea y el anillo visibles.
6. `git log --oneline main..rescate/movil-a11y`: 7 commits o menos, cada uno con `(cherry picked from …)` o con la referencia al original. `git branch` sigue mostrando `backup/hardening-local-7-commits` en `4e7e6b0`.
7. Informe final: qué pasó con cada commit (aplicado, adaptado o descartado y por qué), los conteos de tests contra la base, y la salida si algo falló. El vault lo maneja Gira, así que no toco notas.
