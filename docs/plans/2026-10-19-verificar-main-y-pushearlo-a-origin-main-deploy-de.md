# Plan: verificar `main` y pushearlo a `origin/main` (deploy del portal en Render)

## Contexto

`main` (`b8a0729`) tiene 9 commits que no están en `origin/main` (`daa1932`, v3.3). Son el merge de `integrar-arreglos` y, adentro, los arreglos de pérdida de datos (escritorio, portal y móvil), el portal reescrito en módulos (`cloud/static/js/...`), el instalador 3.4, el test de respaldo y restauración y el Open Graph (`b906610`). Son 89 archivos, +8113/−2243. Pediste el push sabiendo que despliega el rediseño. Antes hay que verificar todo, y si algo falla no se pushea.

Lo que ya revisé (solo lectura):
- **Working tree limpio.** `origin/main` sigue en `daa1932`, así que el push es fast-forward y no hace falta forzar nada.
- **Cómo se testea:** `.venv` del repo con pytest 9.1.1 y todas las dependencias. El Python del sistema no tiene pytest, así que todo se corre con `.venv/Scripts/python`. `README.md:87` → `python -m pytest cloud/tests backend/tests -q`. Los tests de lógica del escritorio están en `backend/tests/` (`test_arreglos_revision.py`, `test_backup_restore.py` y otros). El frontend del escritorio (`frontend/`, Vite + React) no tiene test runner: se valida con `lint` y `build`. El móvil usa `jest` (`mobile/src/lib/__tests__/`). `frontend/node_modules` y `mobile/node_modules` están instalados.
- **"Build" del portal:** el portal no tiene paso de bundling. Render corre `pip install -r cloud/requirements.txt` y después `uvicorn cloud.main:app`, y sirve `cloud/static/` con `StaticFiles` (`cloud/main.py:1347`). Los imports de `cloud/*.py` son stdlib + `fastapi`, `pydantic` y `sqlalchemy`, todos cubiertos por `cloud/requirements.txt`.
- **`render.yaml` contra el código:** `healthCheckPath: /api/races` existe (`cloud/main.py:741`). `buildFilters` incluye `cloud/**`, así que el push dispara el deploy. Las variables nuevas (`CT_PUBLIC_URL`, `CT_SMTP_*`) están declaradas con `sync: false`. Todas las `CT_*` obligatorias que lee `cloud/` están en el blueprint. Las que faltan tienen default en el código (`CT_PREMIUM_*`, `CT_USD_RATE*`). `CT_ALLOW_EXPO_REDIRECT` no está, y está bien que no esté.
- **`DEPLOY.md` contra el código:** los archivos que cita existen (`backend/core/account.py:21 DEFAULT_PORTAL`, `mobile/src/lib/api.ts`, `mobile/src/app/ranking.tsx`). El callback `/api/run/auth/google/callback` coincide con `cloud/google_auth.py:209`. El warning de SMTP que cita coincide con `cloud/main.py:378`. No encontré incoherencias.
- **El test de Open Graph ya existe:** `cloud/tests/test_portal_estaticos.py:47`.

## Cambios

**No se toca ningún archivo del repo.** La tarea es verificar y pushear:

1. Correr todas las verificaciones de la sección *Verificación* sobre `main` tal como está.
2. Si todo pasa: `git push origin main`, sin `--force` y sin `-u`, porque `main` ya trackea `origin/main`.
3. Si algo falla: **no se pushea**. Te informo qué falló, con la salida, y no lo arreglo en esta tarea.
4. No se tocan `backup/hardening-local-7-commits`, `web-pulido-movil` ni `integrar-arreglos`. Las ramas no se mergean ni se borran.
5. La nota hub del vault la maneja Gira. No la leo ni la edito; en el informe te dejo qué habría que actualizar.

## Tests

No se escriben ni se actualizan tests porque no hay cambios de código. Se corren las suites que existen y no se saltea ninguna:

- **Portal + escritorio (backend):** `.venv/Scripts/python -m pytest cloud/tests backend/tests -q`
- **Escritorio (frontend):** `cd frontend && npm run lint && npm run build`. El `dist/` que genera está en `frontend/.gitignore`; lo confirmo antes de correrlo.
- **Móvil**, porque el push también dispara la OTA de EAS: `cd mobile && npm test && npm run lint && npx tsc --noEmit`

## Riesgos

- **El push despliega dos cosas.** Render redeploya el portal y `.github/workflows/eas-update.yml` publica una OTA, porque el push cambia `mobile/**`. Como `mobile/app.json` pasa a `runtimeVersion` por `fingerprint`, es probable que la OTA no les llegue a los builds ya instalados. Los arreglos móviles necesitan un build nuevo de EAS. No rompe nada, pero conviene que lo sepas.
- **Migraciones sobre la base de producción.** Al arrancar, el portal nuevo corre `_ensure_*` y `_migrar_avatares_a_relativo` (`cloud/main.py:380-390`) sobre `/var/data/cloud.db`. Lo mitigo con la prueba de arranque sobre una base creada por la v3.3 (Verificación, paso 4). Igual te recomiendo un snapshot del disco en Render antes del push (DEPLOY.md, "Respaldo").
- **Variables de Render.** Las `sync: false` nuevas (`CT_SMTP_*`, `CT_PUBLIC_URL`) no las completa Render, en un servicio existente probablemente tampoco las cree, y no las puedo ver desde acá. Sin SMTP el portal arranca, pero no salen los mails de verificación ni los de reset. Si `CT_PUBLIC_URL` apunta a un dominio que todavía no tiene TLS, se rompe el login con Google. No frena el push porque lo pediste explícitamente, pero va en el informe.
- **Dependencias de test en producción.** `cloud/requirements.txt` instala `pytest` y `httpx` en Render. Es inofensivo y no lo cambio ahora; queda anotado como pendiente.
- **Sin vuelta atrás limpia.** Una vez pusheado, revertir significa un commit de revert más un redeploy, no un force-push.

## Verificación

1. `git status` limpio, `git fetch origin` y `git rev-list --count origin/main..main` = 9, `main..origin/main` = 0. Así confirmo que nadie pusheó en el medio. `fetch` solo trae referencias, no toca el working tree.
2. Las tres suites de *Tests* en verde, con el conteo de tests en el informe.
3. **Build tipo Render, aislado:** venv nuevo en un directorio temporal fuera del repo, `pip install -r cloud/requirements.txt` y nada más, y `python -c "import cloud.main"` con `PYTHONPATH` apuntando al repo. Así detecto si falta una dependencia que el `.venv` de desarrollo tapa.
4. **Arranque contra una base vieja:** `git archive daa1932 cloud | tar -x` en un temporal, levantar la v3.3 con `CT_CLOUD_DB` apuntando a un `old.db` temporal y publicar una carrera de prueba. Después levantar el `cloud.main` de `main` sobre esa misma base, con `RENDER=1` y secretos de prueba. Tiene que responder 200 en `/api/races`, `/`, `/js/app.js` y `/r/<código>`, mostrar los `og:` en el HTML y loguear el warning de SMTP. Al terminar borro los temporales.
5. Releer `render.yaml` y `DEPLOY.md` contra el diff final (ya está hecho arriba, sin incoherencias). Si aparece algo nuevo, se frena.
6. `git push origin main` y después `git status`, que tiene que mostrar `up to date with 'origin/main'`.
7. **Después del push, para que lo mires vos o lo miremos juntos:** en Render, el deploy OK y el health check en verde; en el log, la presencia o ausencia del warning de `CT_SMTP_HOST`; en GitHub Actions, el run de "EAS Update (OTA)" (`gh run list --workflow eas-update.yml -L 1`).

## Informe sobre las dos ramas sin mergear

**`web-pulido-movil`** (`1c4b525`, 6/10, 1 commit). Trae menú móvil, accesibilidad y Open Graph sobre el `cloud/static/app.js` monolítico, que ya no existe. `merge-tree` da conflicto en `app.js` (modify/delete), `index.html` y `styles.css`. Su contenido ya está en `main`: el portal nuevo trae el menú con `aria-expanded` y Escape, los `aria-label` y el toast accesible, y el Open Graph se rescató a mano en `b906610`, con su test. Por eso figura como resuelta en el hub: lo resuelto es el contenido, no la rama.
→ **Recomiendo descartarla:** crear el tag `archivo/web-pulido-movil` y borrar la rama, con tu confirmación y en otro paso.

**`backup/hardening-local-7-commits`** (19 y 20/9, 7 commits, 46 archivos, +2632/−965). **El nombre engaña: no trae hardening de seguridad**, porque eso ya entró por el PR #2. `git cherry` marca los 7 commits como no incluidos en `main`:
- `16c31b4` móvil: tema claro, tipografía display y accesibilidad
- `6503c83` móvil: alinear dependencias del SDK 54 / Expo Go
- `7f63c2b` + `4e7e6b0` móvil: target web instalable y preview en Vercel
- `b8d91ff` docs: `PRODUCT.md`, auditoría web y pendientes
- `c36469e` escritorio: Escape en los diálogos y foco visible. Está superado en parte por el `Dialog` nuevo de `App.jsx`.
- `dfefc9b` portal: contraste AA. Apunta al `app.js` viejo; habría que revisar si sigue haciendo falta en `styles.css`.

Un merge directo choca en 5 archivos (`.gitignore`, `cloud/static/app.js`, `styles.css`, `frontend/src/App.jsx` y `mobile/src/app/historial.tsx`).
→ **Recomiendo no mergearla como está, pero tampoco descartarla.** Tiene trabajo móvil y de accesibilidad que no está en ningún otro lado. Propongo renombrarla (`backup/movil-a11y-sept`) y armar un plan propio que haga cherry-pick de `16c31b4`, `6503c83`, `7f63c2b`, `4e7e6b0` y `b8d91ff` sobre el `main` nuevo y que readapte a mano lo que siga faltando de `c36469e` y `dfefc9b`.

Además: `feat/portal-corredor-organizador` ya está mergeada (0 commits fuera de `main`) y se puede borrar. `integrar-arreglos` también se puede borrar después del push.
