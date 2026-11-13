# Dejar el deploy de LiveRun en orden

## Contexto

Tres pendientes del hub: (1) revisar el deploy en Render, (2) la OTA de EAS que no llega a los builds, (3) el job `deploy-portal` que se saltea en la CI. El hardening de seguridad tiene su plan aparte y no se toca.

Lo que ya verifiqué (solo lectura, sin cambiar nada):

**Render**
- `render.yaml` ya tiene `healthCheckPath: /api/health`, el disco `chronotrack-data` (1 GB en `/var/data`) y declara `CT_PUBLIC_URL` y `CT_SMTP_HOST/PORT/USER/PASSWORD/FROM` con `sync: false` (el Blueprint las crea vacías: el valor se carga a mano).
- `https://chronotrack-portal.onrender.com/api/health` responde `{"status":"ok"}` hoy.
- Hay tests del endpoint (`cloud/tests/test_health.py`, incluido `test_render_yaml_usa_el_health_check_liviano`) y del arranque sin `CT_PUBLIC_URL` (`test_headers.py`). **No hay ningún test que cubra que `render.yaml` declare `CT_PUBLIC_URL` y `CT_SMTP_*`.**
- Desde el repo no se puede saber: si las variables tienen valor, si el snapshot del disco existe, si el deploy en *Live* es el último commit. Eso es panel de Render.

**EAS**
- `mobile/app.json` ya tiene `runtimeVersion.policy: "fingerprint"`; `eas.json` tiene el perfil `preview` con `channel: "preview"`. La config del repo es consistente.
- El canal `preview` **ya apunta al branch `main`** (se arregló el 22/10); el último update de `main` salió hace ~20 min. `channel:edit` no hace falta repetirlo.
- Los runtimeVersion no coinciden: build Android `preview` del 23/10 (`bfe740d0…`, commit `c1da443`) tiene fingerprint `0377e9e3…`; el último update de `main` (plataforma iOS) tiene `d0d7e13c…`; el fingerprint Android que calcula esta PC hoy es `1b3d2a4e…`. Desde `c1da443` no cambiaron `app.json`, `package.json` ni el lock, así que la diferencia puede ser **espuria** (fingerprint calculado en Windows vs. Linux de la CI, o archivos incluidos) y no un cambio nativo real. Hay que mirar qué fuentes difieren antes de gastar un build.
- La cuenta de Expo está logueada en esta PC (`eas whoami` → `agusgirarfi`), así que correr el build es posible, pero consume cuota/cola de EAS y es una acción externa: la dejo como paso que confirmás vos.

**GitHub Actions**
- Run 43440304622 (commit `3c4ce59`): todo en verde y `Desplegar el portal en Cloud Run` en *skipped*, por `vars.GCP_PROJECT_ID != ''` en el `if` de `ci.yml:100`.
- Hoy el repo tiene **cero variables** y un solo secret (`EXPO_TOKEN`, que usa `eas-update.yml`).
- Para el deploy hacen falta **variables** (Settings → Secrets and variables → Actions → *Variables*, no secretos) y los secretos viven en **Secret Manager de GCP**, no en GitHub. Está documentado en `DEPLOY.md` (tabla de "Variables"), pero no hay una lista de "qué falta" ni una advertencia de que sin `GCP_PROJECT_ID` se saltea.

## Cambios

1. **`cloud/tests/test_despliegue.py`** (o `test_health.py`, donde ya vive el test de `render.yaml`): nuevo test que lee `render.yaml` y exige `CT_PUBLIC_URL` y las cinco `CT_SMTP_*` declaradas con `sync: false` y sin `value:`. Así nadie pone un valor real en el repo ni borra la variable en silencio.
2. **`DEPLOY.md`**: reemplazar el checklist de Render del apéndice por uno con dos bloques: "Lo que garantiza el repo (con tests)" y "Pasos manuales en el panel" (ver abajo), y sumar una sección corta **"Por qué `deploy-portal` se saltea"** con las variables de GitHub necesarias y el orden (Paso 1 → Paso 3 → cargar variables). Sin valores.
3. **`mobile/README.md`** (sección "Que la OTA llegue al teléfono"): agregar los comandos exactos en orden (`channel:view`, `fingerprint:compare`, `build`, `update` manual, verificación) y una nota: el fingerprint calculado en Windows puede diferir del de la CI; la fuente de verdad es el del build instalado vs. el del update del branch.
4. **`PENDIENTES.md`**: marcar los tres pendientes con su estado real y los pasos manuales que quedan para Agustín.
5. **Sin cambios** en `app.json` / `eas.json` a menos que `fingerprint:compare` muestre una fuente no determinista (ver decisión B). `ci.yml` y `render.yaml` no se tocan (salvo decisión C).

### Pasos manuales para Agustín (irán a DEPLOY.md y al hub)

Render (panel):
- Events: el deploy *Live* es el último commit de `main`.
- Settings → Health Check Path = `/api/health`.
- Environment: `CT_PUBLIC_URL` y `CT_SMTP_HOST/PORT/USER/PASSWORD/FROM` con valor real (no los invento).
- Logs de arranque sin `CT_SMTP_HOST no está configurado`; prueba de mail con "¿Olvidaste tu contraseña?".
- Disks: snapshots automáticos activos y un snapshot manual con la fecha anotada.

GitHub (variables del repo, sin valores acá): `GCP_PROJECT_ID`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT`, `GCS_AVATARS_BUCKET`, `CT_PUBLIC_URL`, `CT_ADMIN_EMAILS`. Secretos en Secret Manager de GCP (`ct-cloud-db`, `ct-cloud-secret`, `ct-publish-key`, `ct-mp-*`, `ct-google-client-*`, `ct-smtp-*`) con los mismos valores que hoy tiene Render. Requiere antes el Paso 1 de DEPLOY.md (proyecto GCP, Artifact Registry, bucket, cuentas de servicio, Workload Identity) y el Paso 2 (Neon). Con solo `GCP_PROJECT_ID` cargada el job arranca y falla en la autenticación: conviene cargarlas todas juntas al final.

EAS (cuenta de Expo):
1. `cd mobile && npx eas-cli@latest channel:view preview` (confirmar `preview` → `main`).
2. `npx eas-cli@latest fingerprint:compare` (build instalado vs. update de `main`).
3. Si difieren por algo real: `npx eas-cli@latest build -p android --profile preview` e instalar el APK.
4. GitHub → Actions → *EAS Update (OTA)* → *Run workflow* para publicar un update con el fingerprint del build nuevo.
5. Abrir la app dos veces y comprobar que toma el update.

## Tests

- **Nuevo:** `render.yaml` declara `CT_PUBLIC_URL` y `CT_SMTP_*` con `sync: false` (rojo primero: se escribe antes de tocar nada; hoy ya pasaría, así que se verifica que falla al quitar una variable temporalmente).
- **Ya existentes que cubren el resto:** `test_health.py` (health 200 / 503 y `healthCheckPath`), `test_despliegue.py::test_las_variables_de_ci_que_exige_el_deploy_estan_documentadas` (obliga a que toda `vars.*` del deploy esté en `DEPLOY.md`: protege los cambios de doc), `test_headers.py` (arranque sin `CT_PUBLIC_URL`).
- Los cambios de `README`/`PENDIENTES` son documentación: sin test propio.
- Antes de cerrar: `python -m pytest cloud/tests backend/tests -q`, `ruff check .`, `ruff format --check .`.

## Riesgos

- **Fingerprint espurio:** pedir un build nuevo "por las dudas" gasta cuota de EAS y no arregla nada si la diferencia es de plataforma (Windows vs. Linux). Por eso primero `fingerprint:compare`.
- **Updates solo para una plataforma:** el update visto es iOS; hay que confirmar que también se publica el de Android (el workflow usa `eas update` sin `--platform`, así que debería).
- **No inventar valores:** la doc y los tests no incluyen ningún valor real; los placeholders van como `<…>`.
- **Cargar `GCP_PROJECT_ID` sola** hace que el deploy deje de saltearse y falle (rojo en `main`). Hay que avisarlo en la doc.
- **Render sigue en producción:** ningún cambio de este plan toca `cloud/**`, así que no dispara un deploy de Render (`buildFilters`); solo se toca `render.yaml` si se elige la opción C, y eso sí lo dispararía.

## Verificación

- `curl -s https://chronotrack-portal.onrender.com/api/health` → `{"status":"ok"}` (ya verificado hoy).
- Suite, ruff y formato en verde en local; la CI del commit en verde (`gh run watch`).
- `gh variable list` muestra las variables cargadas (sin valores sensibles) y el job `deploy-portal` deja de saltearse en el siguiente push.
- `eas fingerprint:compare` sin diferencias entre build y update, o build nuevo con el mismo fingerprint que el update de `main`; en el teléfono, la app toma el update tras abrirla dos veces.

## Decisiones abiertas

**A. ¿Quién corre el build de EAS?** 1) Lo corro yo después de `fingerprint:compare` si hay diferencia real (recomendada: la cuenta ya está logueada y es solo cuota de EAS). 2) Solo dejo los comandos documentados y lo corrés vos. 3) Correrlo sin comparar antes. 4) No hacer build hasta migrar a Expo 58 (un solo build para ambas cosas).

**B. Si el fingerprint cambia por Windows vs. Linux:** 1) Documentarlo y comparar siempre contra el de la CI (recomendada). 2) Fijar `runtimeVersion` a un valor manual (`"1.0.0"` o `appVersion`) en vez de `fingerprint`: más simple, pero hay que acordarse de subirlo a mano ante cambios nativos. 3) Publicar los updates desde la PC en vez de la CI. 4) Agregar `.fingerprintignore` para las fuentes que difieren.

**C. `render.yaml` y la CI:** 1) No tocar `render.yaml` (recomendada: se da de baja con el corte a Cloud Run). 2) Pasar a `autoDeployTrigger: checksPass` para que Render espere a la CI (pendiente abierto del 21/10; requiere confirmar el nombre en la doc de Render). 3) Desactivar `autoDeploy` y desplegar a mano.

**D. Cómo documentar lo manual:** 1) Checklist en `DEPLOY.md` + `PENDIENTES.md` (recomendada). 2) Un `docs/deploy-checklist.md` nuevo. 3) Solo en `PENDIENTES.md`. 4) Issue de GitHub con casillas.

**E. Variables de GitHub:** 1) Solo documentar qué falta (recomendada: no hay proyecto GCP todavía). 2) Cargar yo las que no tienen valor sensible vía `gh variable set` cuando me pases los valores. 3) Hacer que el job avise con un mensaje claro cuando se saltea (un paso previo que escribe en el resumen).

Al terminar: actualizar la nota hub `C:\dev\Obsidian Vault\01 - Projects\LiveRun\LiveRun.md` y capturar en `00 - Inbox/` el aprendizaje (fingerprint por plataforma), según el CLAUDE.md de `C:\dev`. Nota: el vault lo gestiona Gira y esas instrucciones chocan con la regla de no leerlo ni modificarlo, así que **no lo toco**; el cierre queda en `PENDIENTES.md`.
