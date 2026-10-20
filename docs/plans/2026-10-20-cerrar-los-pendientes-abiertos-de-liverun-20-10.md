# Cerrar los pendientes abiertos de LiveRun (20/10)

## Contexto

`main` tiene **13 commits sin pushear**, no 4. El hub del vault cuenta solo los 4 últimos. Los otros 9 son el rescate `rescate/movil-a11y`, mergeado el 19/10 y nunca subido. Lo que encontré al analizar el repo:

| Commit | Qué es | ¿Va? |
|---|---|---|
| `2d4175d` | API key de publicación por organizador (`cloud/organizadores.py`, tabla `publish_keys`, pestaña Claves) | Sí: crea una tabla nueva al arrancar → **snapshot antes** |
| `fba03b4` | Rate limit con backend intercambiable (`cloud/deps.py`, `CT_RATE_LIMIT_BACKEND`) | Sí |
| `8190203` | CSP sin `unsafe-inline` en estilos (42 `style=""` → clases y `data-*`) | Sí. Riesgo visual, no lo cubren los tests |
| `78b2c44` | `/api/health` y `render.yaml` apuntado a él | Sí |
| `4ce3799` | Merge del rescate | Sí |
| `af187c2` | docs: PRODUCT.md, PENDIENTES.md y planes en `docs/plans/` | Sí (el repo es público: los revisé y no tienen secretos) |
| `d525296`, `0b18d9f` | contraste en el portal; teclado en las sugerencias del escritorio | Sí |
| `11400e7`, `ec15199` | tema claro móvil, a11y, test de contraste | Sí. **No corrieron en un dispositivo** |
| `b3f7d4c`, `e7b41b7` | target web móvil y preview en Vercel (`vercel.json`, `.bat`) | Sí. Se despliega a mano con el `.bat`, el push no lo dispara |
| `7413d99` | bump de deps a SDK 54 (`expo-updates` ~29.0.20) | Sí. Cambia el fingerprint (ver Etapa 4) |

Busqué secretos en todo el diff (`token|secret|password|api_key|lr_pub_|APP_USR`…) y no hay nada. Tampoco se suben `.db`, `.env*` ni `chronotrack_cloud.json`.

**Qué dispara el push:** (a) un deploy del portal en Render, porque cambió `cloud/**` y `render.yaml`; (b) el workflow `.github/workflows/eas-update.yml`, porque cambió `mobile/**`. Ese workflow publica una OTA al branch `main` de EAS. Hoy ningún canal apunta a ese branch, así que no llega a ningún dispositivo: es inofensivo.

**Hallazgos que cambian el pedido original:**
- **Etapa 2:** el escritorio ya tiene dónde cargar la clave. Está en la barra lateral → **☁ Portal en la nube** (`frontend/src/App.jsx:3635`, `CloudControls`). Hace `PUT /cloud/config` (`backend/api/routes.py:840`) y se guarda en `chronotrack_cloud.json`, junto a la base (`backend/core/cloud_config.py`). La clave nunca llega al navegador, solo enmascarada. El único punto ciego es que si existe la variable de entorno `CT_PUBLISH_KEY` en la PC, pisa sin avisar la clave guardada. En tu PC no está definida (lo chequeé en User y Machine).
- **Etapa 2, orden de la rotación:** si creás una clave nueva con "Crear clave", tus carreras ya publicadas quedan a nombre de la global. Al republicarlas, el portal responde **403** (`_check_race_owner`, `cloud/main.py:614`). Para el organizador original lo correcto es **Rotar la fila "Organizador original"**: la clave nueva hereda las carreras y la global deja de valer en el mismo acto (`cloud/organizadores.py:106`, ya cubierto por `test_rotar_la_legacy_…`). Ojo: esa fila se crea recién la primera vez que se publica con la global después del deploy. **Hasta que exista, la global sigue valiendo.**
- **Etapa 3:** `render.yaml` ya declara `CT_PUBLIC_URL` y `CT_SMTP_*` con `sync: false`, y `/api/health` ya tiene sus tests. Desde el repo no falta código: falta el checklist manual.
- **Etapa 4:** `mobile/app.json` ya usa `runtimeVersion.policy: "fingerprint"`, así que la config del repo está bien. Lo que falla está del lado de EAS: el canal `preview` apunta al branch vacío `preview`, y los builds instalados son viejos (`exposdk:54.0.0`). La solución es el canal más un build nuevo, sin cambiar la política.
- **Etapa 5:** la abstracción ya existe (`Limitador`, `LimitadorEnMemoria`, `_BACKENDS` y `crear_limitador` en `cloud/deps.py`, con tests en `test_rate_limit.py`). **Recomiendo no escribir el backend Redis**: hoy hay un solo worker, sumaría una dependencia y código sin uso. Agrego solo una alarma: un aviso en el log si el portal arranca con más de un worker usando el backend en memoria. uvicorn lee `WEB_CONCURRENCY` del entorno, así que alguien podría escalar sin darse cuenta.

Tests: `python -m pytest cloud/tests backend/tests -q`, `cd mobile && npm test && npx tsc --noEmit && npm run lint`, `cd frontend && npm run lint && npm run build`. Los conftest crean bases temporales, y el portal y el escritorio tienen fixtures `client` separados.

## Cambios

### Etapa 1: Push (Claude Code, con dos frenos)
1. Corro todos los tests, lints, `tsc` y `vite build`. Si algo falla, no hay push y lo reporto.
2. **Freno:** Agustín saca el snapshot del disco en Render y me confirma.
3. `git push origin main`. Después, `curl https://chronotrack-portal.onrender.com/api/health` hasta ver `{"status":"ok"}` (es un GET de solo lectura).
4. **Freno:** borrar `origin/arreglos-revision` (ya está mergeada en `main`, lo verifiqué con `git branch -r --merged`). Lo pregunto antes de hacerlo.
5. Pregunta aparte: los tags `archivo/backup-hardening-local` y `archivo/web-pulido-movil` existen **solo en local**. Si se pierde la PC, se pierden. ¿Pushearlos? El repo es público y quedarían visibles.

### Etapa 2: Claves por organizador
- `backend/core/cloud_config.py`: `load_config()` agrega `key_from_env: bool`.
- `backend/api/routes.py`: `GET` y `PUT /cloud/config` devuelven `key_from_env`.
- `frontend/src/App.jsx` (`CloudControls`): si `key_from_env`, muestra un aviso en el modal ("La variable CT_PUBLISH_KEY de este equipo pisa la clave que guardes acá"). El placeholder pasa a `lr_pub_…`. Para que esto llegue a la app instalada hay que regenerar el instalador (`build.bat`). **No bloquea:** la app instalada ya permite pegar la clave.
- `DEPLOY.md`, Paso 3: se reescribe con el procedimiento correcto (rotar la legacy, no crear una nueva, para el organizador original) y la advertencia de la fila perezosa.

### Etapa 3: Render
- `DEPLOY.md`: nueva sección **"Checklist después de cada deploy"** con los ítems manuales (abajo). No hay cambios de código.

### Etapa 4: OTA de EAS
- `.github/workflows/eas-update.yml`: se actualiza el comentario. El canal `preview` apunta a `main` y se agrega la nota de que un build con runtime viejo no toma OTA.
- `mobile/README.md` (o `DEPLOY.md`): una sección corta "OTA", con el mapeo canal → branch, la política fingerprint y cuándo hace falta un build nuevo (cambio nativo o de deps).

### Etapa 5: Rate limit
- `cloud/deps.py`: `aviso_multiworker(backend, workers) -> Optional[str]`, una función pura que devuelve el texto del aviso si `workers > 1` y el backend es `memoria`.
- `cloud/main.py` (`_startup`): la llama con `os.environ.get("WEB_CONCURRENCY")` y loguea un warning, igual que el aviso de SMTP. No frena el arranque.
- `README.md` (Deuda conocida) y `PENDIENTES.md`: se deja dicho que Redis se escribe recién al escalar, y que el aviso lo detecta.

### Al cierre
- `PENDIENTES.md`: tachar lo resuelto y dejar lo manual. Commits chicos, uno por etapa, y un segundo push (redeploya el portal por `cloud/deps.py` y `cloud/main.py`).
- No toco el vault: lo maneja Gira, aunque el `C:\dev\CLAUDE.md` lo pida.

## Lo que hace Agustín a mano

**Render (antes del push):**
- [ ] Dashboard → servicio → Disks → **Create snapshot**. Avisarme.

**Render (después del push), checklist que queda en DEPLOY.md:**
- [ ] El deploy llega a **Live** y Settings → Health Check Path dice `/api/health`. El Blueprint sincroniza el yaml, pero hay que confirmarlo.
- [ ] Environment: `CT_PUBLIC_URL`, `CT_SMTP_HOST/PORT/USER/PASSWORD/FROM` con valor.
- [ ] Logs de arranque: **sin** `CT_SMTP_HOST no está configurado`, **sin** el aviso nuevo de multiworker, y **un solo** `Started server process`.
- [ ] Prueba de mail: Ingresar → ¿Olvidaste tu contraseña? → llega el mail.
- [ ] Portal en un navegador, tema claro y oscuro (inicio, buscar, calendario, progreso, cuenta, admin → Claves), con la consola **sin violaciones de CSP**.
- [ ] Disks → snapshots automáticos activos (Render los hace a diario en planes pagos), y anotar la fecha del manual.

**Clave personal (en este orden):**
1. Desde el escritorio, publicar o republicar una carrera con la config actual (la global). Así se crea la fila **"Organizador original"** en el portal.
2. Portal → Administración → **Claves** → en "Organizador original", **Rotar**. Copiar la clave `lr_pub_…`: se muestra una sola vez. Desde este momento la global ya no vale.
3. Escritorio → **☁ Portal en la nube** → pegar la clave → Guardar.
4. Republicar una carrera. En Claves, "Organizador original" muestra el `last_used_at` recién actualizado, y la carrera sigue siendo tuya (si fuera de otro, daría 403).
5. Si el paso 3 sale mal, no quedás afuera: desde el portal se puede volver a **Rotar** tantas veces como haga falta.
6. Para otro organizador: **Crear clave** con su nombre y pasársela por un canal privado.
7. Opcional, como cinturón y tirantes: en Render → Environment, regenerar `CT_PUBLISH_KEY` con un valor nuevo. No se puede borrar, porque `_startup` exige un valor que no sea el de desarrollo. Ya no la usa nadie.

**EAS:**
1. `cd mobile && npx eas-cli@latest channel:edit preview --branch main`
2. `npx eas-cli@latest build -p android --profile preview` → instalar el APK nuevo en el teléfono, reemplazando el viejo.
3. Comprobar en expo.dev que el runtime del build (fingerprint) coincide con el del último update del branch `main`. Si no coincide, `npx eas-cli@latest fingerprint:compare` dice qué difiere.
4. Prueba: un cambio JS trivial en `mobile/` → push → el workflow publica → al reabrir la app dos veces, aparece.
5. Antes de la tienda: `channel:edit production --branch main` (ya está anotado en el workflow).

## Tests
- **Nuevo** `backend/tests/test_cloud_config.py`: con `CT_PUBLISH_KEY` en el entorno (vía monkeypatch), `GET /cloud/config` devuelve `key_from_env: true`; sin la variable, `false`; y el `PUT` con la clave guardada no la expone en claro. Rojo → verde.
- **Actualizado** `cloud/tests/test_rate_limit.py`: `aviso_multiworker("memoria", 2)` devuelve texto que nombra `CT_RATE_LIMIT_BACKEND`; con `1`, `None` o un valor no numérico devuelve `None`. Más un test con `caplog` de que `_startup` loguea el warning con `WEB_CONCURRENCY=2`.
- La rotación de la legacy ya está cubierta (`test_publish_keys.py:164`, `:174`, `:183`); no la duplico.
- El frontend no tiene tests (el repo no los configura). El aviso se verifica con lint, build y a ojo.

## Riesgos
- **Push = deploy a producción** con una tabla nueva (`publish_keys`, creada por `create_all`, aditiva) y la CSP de estilos cambiada. Mitigación: snapshot antes y revisar el portal en el navegador después. Si se ve roto, `git revert` del commit de la CSP y push.
- **Código móvil sin probar en un dispositivo:** el push solo publica una OTA que nadie recibe, pero el **build nuevo de la Etapa 4 sí lo instala**. Conviene hacer los chequeos de dispositivo de PENDIENTES §1 con ese APK.
- **La global sigue viva hasta que exista la fila legacy.** Si nunca se publica con ella, nunca se registra y sigue sirviendo. El procedimiento la fuerza en el paso 1.
- **Crear una clave en vez de rotar** deja las carreras viejas en 403. Lo dejo explícito en DEPLOY.md.
- **Fingerprint distinto entre EAS Build y el CI** (Linux con `npm ci`): la OTA se publicaría con otro runtime. Se detecta en el paso 3 de EAS.
- **Repo público:** los planes de `docs/plans/` y PENDIENTES quedan visibles. Los revisé y no tienen secretos ni datos de terceros.

## Verificación
1. Antes de cada push: `python -m pytest cloud/tests backend/tests -q`, `cd mobile && npm test && npx tsc --noEmit && npm run lint`, `cd frontend && npm run lint && npm run build`. Todo en verde; los avisos de lint preexistentes (28 en móvil, 2 en el escritorio) no pueden aumentar.
2. Después del push: `curl -s https://chronotrack-portal.onrender.com/api/health` → `{"status":"ok"}`, y `git status -sb` → `main...origin/main` sin "ahead".
3. Escritorio local (`python launcher.py`): el modal ☁ muestra el aviso con `CT_PUBLISH_KEY` exportada y no lo muestra sin ella.
4. Los checklists manuales de Render, la clave y EAS quedan en DEPLOY.md, y lo que siga abierto, en PENDIENTES.md.
