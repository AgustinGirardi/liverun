# Plan: cerrar el estado de ramas de LiveRun y dejar `main` listo para producción

## Contexto

`main` (= `origin/main`, `daa1932`, v3.3) quedó atrás de `integrar-arreglos`, que trae los arreglos de pérdida de datos (escritorio, portal, móvil), el portal reescrito en módulos (`cloud/static/js/...`), el instalador 3.4 y el test de respaldo y restauración. Además hay dos ramas viejas sin mergear y un directorio sin trackear. La idea es dejar todo eso resuelto, con los tests en verde, y llegar a un `main` que se pueda pushear. El push queda frenado hasta que estén cargadas las variables de Render.

Lo que encontré:

| Rama / cambio | Estado real | Decisión |
|---|---|---|
| `?? .impeccable/` | No es código. Son 2 informes de la herramienta de crítica de diseño "impeccable" (`critique/2026-09-28…frontend-src-app-jsx.md` y `2026-09-29…cloud-static-app-js.md`, este último sobre un archivo que ya no existe) y `hook.cache.json`, que ya está en `.git/info/exclude`. | **No se commitea.** Agrego `.impeccable/` a `.git/info/exclude`: es local, no toca el repo y los informes no se borran. |
| `integrar-arreglos` | 7 commits por delante de `main`. `main` es ancestro directo, así que no hay conflictos. 88 archivos. Sin upstream. | Se mergea a `main`. |
| `backup/hardening-local-7-commits` | **El nombre engaña: no trae hardening de seguridad.** Ese hardening entró por el PR #2 `hardening-pagos-y-seguridad`, que ya está en main. Son 7 commits del 19 y 20/9 de diseño, accesibilidad, móvil y docs. `git cherry` marca los 7 como **no incluidos**, y ningún archivo nuevo que agregan existe en `integrar-arreglos` (`PRODUCT.md`, `PENDIENTES.md`, `AUDITORIA-WEB.md`, `icon.tsx`, `use-reduced-motion.ts`, `vercel.json`, fuente Barlow). Un merge simulado (`git merge-tree`) da 5 conflictos: `.gitignore`, `cloud/static/app.js` (borrado en la nueva), `styles.css`, `frontend/src/App.jsx` y `mobile/src/app/historial.tsx`. | **No entra en esta release** (detalle abajo). La rama se conserva para un plan propio de rescate. |
| `web-pulido-movil` | 1 commit (`1c4b525`) sobre el `app.js` monolítico viejo. Choca con la reescritura en `app.js` (modify/delete), `index.html` y `styles.css`. El portal nuevo ya tiene casi todo lo que agregaba: menú "más" con `aria-expanded` que cierra con Escape (`js/app.js:140-174, 251`), `meta description`, `theme-color`, toast con `role="status"`/`aria-live`, `aria-label` en navegación y búsqueda, y botones reales. **Le falta solo Open Graph** (`og:title`, `og:description`, `og:type`, `og:site_name`). | **Queda obsoleta.** Lo único que se rescata a mano son los meta de Open Graph. No hago cherry-pick ni rebase: el archivo de destino ya no existe. |
| `feat/portal-corredor-organizador` | 0 commits fuera de `main` (ya está mergeada). | Se puede borrar al final. |

**Por qué el backup no entra ahora.** Lo de valor que tiene es UI móvil (808 líneas en 27 archivos), bumps de Expo, la devDependency `@expo/ngrok`, el preview web en Vercel y Escape/foco en los diálogos del escritorio. Nada de eso es un arreglo de seguridad ni de pérdida de datos. Mezclarlo en esta release suma riesgo: el push a `main` además dispara la OTA de EAS para `mobile/**`. Hay otra razón: la parte de escritorio (`c36469e`) quedó superada en parte porque el `Dialog` propio de `integrar-arreglos` ya tiene Escape y trampa de foco (`frontend/src/App.jsx:3258`, `:3337`). Lo que sigue faltando (Escape en los modales de `InscriptosView`/`AccountControls`, foco visible en las tarjetas y navegación de pestañas con teclado) se adapta mejor en una rama nueva sobre el `main` nuevo. El commit de contraste del portal (`dfefc9b`) apunta al `app.js` viejo y queda obsoleto.

## Cambios

Todo sobre `integrar-arreglos`, antes del merge:

1. **`.git/info/exclude`** (local, no versionado): agregar `.impeccable/`. Con eso el working tree queda limpio.
2. **`cloud/static/index.html`**: agregar los 4 `<meta property="og:…">` de `web-pulido-movil`, pasados al texto actual del `meta description` ("Buscá tu resultado en carreras de calle de Argentina…"). Es el único rescate de esa rama. Commit: `feat(portal): Open Graph para que los links de resultados se vean bien al compartirlos`.
3. **Merge a `main`**: `git switch main && git merge --no-ff integrar-arreglos`, con un mensaje que explique qué entra (arreglos de pérdida de datos + portal reescrito + instalador 3.4). Uso `--no-ff` para seguir la convención del repo (`d9cdf72`, `e4fff4f` son merges). Como `main` es ancestro, el árbol resultante es idéntico al de `integrar-arreglos` ya testeado.
4. **Ramas** (cada borrado lo confirmo antes, porque no se puede deshacer fácil):
   - `web-pulido-movil`: tag `archivo/web-pulido-movil` y después `git branch -D`.
   - `feat/portal-corredor-organizador`: `git branch -d` (ya mergeada).
   - `integrar-arreglos`: `git branch -d` después del push.
   - `backup/hardening-local-7-commits`: **se conserva**. Propongo renombrarla a `backup/movil-a11y-sept` para que el nombre no confunda, y un plan aparte que cherry-pickee `16c31b4`, `6503c83`, `7f63c2b`, `4e7e6b0` y `b8d91ff` sobre `main`, resuelva `historial.tsx` y re-aplique a mano lo que falte de `c36469e`.
5. **Push (último paso, condicionado):** `git push origin main` **solo** cuando confirmes que las variables de abajo están cargadas en Render.

### Variables de entorno del portal en Render

Sale de `render.yaml`, `.env.example`, `DEPLOY.md` (paso 6) y de los `os.environ` de `cloud/*.py`:

**Cargar a mano antes del push** (en `render.yaml` tienen `sync: false`, así que Render no las completa):
- `CT_SMTP_HOST`: sin esta variable el portal arranca, pero en Render deja un warning (`cloud/main.py:374`) y **no salen los mails de verificación ni de "olvidé mi contraseña"**. El portal nuevo los usa.
- `CT_SMTP_PORT`: `587` (STARTTLS) o `465` (SSL).
- `CT_SMTP_USER`
- `CT_SMTP_PASSWORD`
- `CT_SMTP_FROM`: opcional. Si queda vacía se usa `CT_SMTP_USER`, y Gmail solo deja la propia cuenta o un alias.
- `CT_PUBLIC_URL`: arma los links de los mails, el CORS, el `redirect_uri` de Google, la `back_url` de Mercado Pago y las URLs de avatar. **Hasta que el dominio propio resuelva con certificado, va `https://chronotrack-portal.onrender.com`**: cambiarla antes rompe el login con Google (DEPLOY.md, paso 5).

**Tienen que estar (ya deberían, por el deploy actual):**
- `CT_CLOUD_SECRET` y `CT_PUBLISH_KEY`: las genera el blueprint. Si en Render quedan los valores por defecto, el arranque falla a propósito (`cloud/main.py:365-372`).
- `CT_CLOUD_DB=sqlite:////var/data/cloud.db` y `PYTHON_VERSION=3.12.7`: fijas en el blueprint.
- `CT_MP_ACCESS_TOKEN` y `CT_MP_WEBHOOK_SECRET`: el secret es obligatoria si se cobra, porque sin ella se descartan todos los avisos de pago.
- `CT_GOOGLE_CLIENT_ID` y `CT_GOOGLE_CLIENT_SECRET`: sin ellas el login con Google devuelve 503.
- `CT_ADMIN_EMAILS`

**Opcionales, con default en el código:** `CT_PREMIUM_PRICE_USD` (1.99), `CT_PREMIUM_PRICE`, `CT_PREMIUM_CURRENCY` (ARS), `CT_USD_RATE_SOURCE` (oficial), `CT_USD_RATE`, `CT_USD_RATE_FALLBACK` (1100) y los límites antitrampa de `cloud/run.py`: `CT_MAX_KM`, `CT_MAX_HORAS`, `CT_MIN_DURACION_S`, `CT_RITMO_MIN_S_KM`, `CT_TOLERANCIA_FUTURO`, `CT_ANTIGUEDAD_MAX`, `CT_TOPE_DIARIO_KM`.

**Nunca en producción:** `CT_ALLOW_EXPO_REDIRECT` (permite robar la cuenta vía `exp://`). `RENDER` la define Render sola.

## Tests

- **Nuevo (rojo → verde)** en `cloud/tests/test_portal_estaticos.py`: `test_index_tiene_open_graph`. Hace `client.get("/")` y verifica que estén `og:title`, `og:description`, `og:type` y `og:site_name`, con el mismo estilo que `test_index_no_tiene_handlers_en_linea`. Primero lo corro sin el cambio en `index.html` y tiene que fallar.
- No se borra ni se saltea ningún test. No hay tests que actualizar: lo demás es integración de ramas.
- Suites completas, en `integrar-arreglos` antes del merge y otra vez en `main` después:
  - Portal + backend: `python -m pytest cloud/tests backend/tests -q` (el README dice 150; espero 150 + los agregados en la rama + 1).
  - Móvil: `cd mobile && npm test && npm run lint && npx tsc --noEmit`.
  - Escritorio (frontend): `cd frontend && npm run lint && npm run build`. No tiene test runner; sus tests de lógica están en `backend/tests`, por ejemplo `test_backup_restore.py` y `test_arreglos_revision.py`. Lo aclaro y no sumo vitest: sería una dependencia nueva fuera del alcance.

## Riesgos

- **El push despliega dos cosas, no una.** Render redeploya el portal (`autoDeploy` + `buildFilters cloud/**`) y **también corre `.github/workflows/eas-update.yml`**, que publica una OTA porque cambia `mobile/**`. Ojo: `integrar-arreglos` cambia `runtimeVersion.policy` de `sdkVersion` a `fingerprint` (`mobile/app.json`). Esa OTA probablemente **no le llegue** a los builds instalados: los arreglos móviles (`6d186c5`) necesitan un build nuevo de EAS. No rompe nada, pero lo tenés que saber.
- **Variables de Render:** las que tienen `sync: false` y son nuevas en `render.yaml` no se crean solas. Si falta SMTP, el portal anda pero los usuarios nuevos no pueden verificar el mail. Si `CT_PUBLIC_URL` apunta a un dominio sin TLS, se rompe Google.
- **Base de datos del portal:** el portal nuevo agrega columnas al arrancar (`_ensure_email_hash_column`, `_ensure_name_norm_column`). Antes del push conviene un snapshot del disco de Render (DEPLOY.md, "Respaldo").
- **Backup sin integrar:** el trabajo móvil y de accesibilidad del 19 y 20/9 sigue fuera de `main`. Mitigación: la rama se conserva y queda pendiente su plan de rescate.
- **Borrado de ramas:** solo con confirmación y con tag de archivo antes.
- El escritorio 3.4 no se publica con el push: el instalador se genera aparte con `build.bat`.

## Verificación

1. `git status` limpio en `integrar-arreglos` después de excluir `.impeccable/`.
2. El test de Open Graph en rojo, después en verde. Las tres suites en verde en `integrar-arreglos`.
3. Merge: `git diff integrar-arreglos main` vacío y `git log main..integrar-arreglos` vacío. Las tres suites en verde de nuevo en `main`.
4. Opcional, local: `uvicorn cloud.main:app --port 8002` con `.env` de prueba, y en el navegador revisar `/`, el menú móvil y una carrera publicada.
5. **Freno:** te paso el checklist de variables y espero tu confirmación explícita ("variables cargadas, pusheá").
6. Después del push: en Render, deploy OK y health check `/api/races`; el log sin el warning de `CT_SMTP_HOST`; crear una cuenta de prueba y que llegue el mail de verificación; revisar el run de "EAS Update" en GitHub Actions.
