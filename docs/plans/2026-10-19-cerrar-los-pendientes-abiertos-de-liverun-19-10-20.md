# Plan: cerrar los pendientes abiertos de LiveRun (19/10/2026)

## Contexto

Después del rescate de `backup/hardening-local-7-commits` quedaron abiertos la integración a `main`, la limpieza de ramas, revisar el deploy y la OTA, y tres deudas del portal. Esto es lo que encontré al revisar el repo, y en algunos puntos cambia el pedido original:

- **Git.** `main` (= `origin/main`, c55b2b2) es el merge-base de `rescate/movil-a11y`, que le suma 8 commits. Se puede hacer fast-forward, pero el repo usa merges explícitos ("Merge integrar-arreglos: …"), así que va `--no-ff`. `integrar-arreglos`, `feat/portal-corredor-organizador` y `origin/arreglos-revision` ya están en `main`, sin commits sueltos. Ninguna rama local tiene remoto.
- **`backup/hardening-local-7-commits` nunca va a quedar "vacía" en `git log main..`.** `git cherry` da 6 de 7 commits como `+`, porque se rescataron con cambios (cada uno dice "rescate de <sha>"). Solo 4e7e6b0 es idéntico. Además `PENDIENTES.md` dice que la tipografía Barlow Condensed "está en la rama backup": si se borra la rama, se pierde. Por eso la propuesta es **archivarla con un tag** antes de borrarla.
- **`web-pulido-movil`** tiene 1 commit (1c4b525, del 06/10) que no está en `main` ni en ningún remoto. Borrarla requiere `-D`; dejo anotado el sha en el informe.
- **CSP: el `script-src` ya no tiene `unsafe-inline`.** Los `onclick` ya pasaron a `data-act`/`data-submit` con delegación (`cloud/static/js/ui/acciones.js`), y ya lo cubre `test_csp_no_permite_scripts_en_linea`. El `unsafe-inline` que queda está en **`style-src`**: hay 42 `style="…"` en 14 archivos de `cloud/static/js/`, de los cuales 4 son dinámicos (ancho del cupo, alto y delay de las barras, anillo conic-gradient, margin-top). La deuda real es esa.
- **Rate limit** (`cloud/deps.py`): es un dict en memoria (`_RATE`), y `test_rate_limit.py`, `test_run_billing.py` y `conftest.py` lo tocan directo.
- **Publicación**: una sola `CT_PUBLISH_KEY` global. Ya existe `PublishedRace.owner_key_hash` (sha256 de la key) y `_check_race_owner`. Escritorio (`backend/core/cloud_config.py`, `backend/api/routes.py`) ya manda `X-API-Key` desde su config, así que **no cambia**. Hay un **bug**: `POST /api/events` (`publish_event`) no llama a `_check_race_owner`, entonces con keys por organizador uno podría pisar el evento de otro.
- **Render**: `GET https://chronotrack-portal.onrender.com/api/races` → 200 en 0,7 s, y la CSP en vivo coincide con el código. `healthCheckPath` es `/api/races`, que lista todas las carreras y crece con los datos. Las `CT_SMTP_*` y `CT_PUBLIC_URL` son `sync:false` en `render.yaml`: solo se ven en el panel. No hay CLI de Render instalada.
- **EAS**: `app.json` usa `runtimeVersion.policy: fingerprint`. `eas.json` define builds con canales `development`, `preview` y `production`, y el workflow publica en el **branch `main`**. Si no se corrió `eas channel:edit <canal> --branch main`, ningún build instalado mira el branch `main`. Además, el rescate cambia `package.json`, `package-lock.json` y `app.json`, o sea que cambia el fingerprint. La última corrida del workflow (hoy 22:45, éxito) es anterior al merge del rescate. `eas` no está instalado; se usa `npx eas-cli@latest`.
- **Tests**: pytest (`.venv/Scripts/python -m pytest cloud/tests backend/tests -q`), y en móvil `npm test`, `npm run lint` y `npx tsc --noEmit`. El escritorio (`frontend/`) tiene `npm run lint` + `npm run build`. El portal no tiene tests JS: sus estáticos se testean desde pytest (`test_portal_estaticos.py`).
- **Vault**: no se toca (Gira se encarga), aunque `C:\dev\CLAUDE.md` lo pida.

## Cambios

Cada etapa termina con las suites en verde y su propio commit (o merge). Nada se pushea hasta la etapa final.

### Etapa 0: línea de base
Correr todas las suites en `main` y en `rescate/movil-a11y` y anotar los conteos.

### Etapa 1: integrar `rescate/movil-a11y`
1. Mapear los 7 commits de backup contra el rescate, por el "rescate de <sha>" y por diff de contenido. Lo que quedó afuera a propósito (Barlow, `@expo/ngrok`, 4e7e6b0 equivalente) ya está explicado en `PENDIENTES.md`.
2. `git checkout main && git merge --no-ff rescate/movil-a11y` con un mensaje que diga el porqué. Suites completas.

### Etapa 2: limpieza de ramas (local; lo remoto, en la etapa final)
Para cada rama, primero `git log main..<rama>` y `git log main..origin/<rama>` si existe:
- `integrar-arreglos`, `feat/portal-corredor-organizador`, `rescate/movil-a11y`: vacías → `git branch -d` (el `-d` común se niega si hubiera algo sin mergear).
- `backup/hardening-local-7-commits`: `git tag archivo/backup-hardening-local 4e7e6b0` y después `git branch -D`. En `PENDIENTES.md`, "la rama backup" pasa a apuntar al tag.
- `web-pulido-movil`: `git tag archivo/web-pulido-movil 1c4b525` (no cuesta nada y es reversible) y después `git branch -D`.
- `origin/arreglos-revision`: ya está en main → `git push origin --delete arreglos-revision`, en la etapa final.

### Etapa 3: deploy en Render
- `cloud/main.py`: nuevo `GET /api/health` que hace `SELECT 1` y devuelve `{"status":"ok"}` (503 si la base falla). No expone la configuración.
- `render.yaml`: `healthCheckPath: /api/health`.
- Informe: checklist manual del panel (ver Verificación).

### Etapa 4: OTA de EAS (diagnóstico, sin cambios outward)
Solo lectura: `npx eas-cli@latest whoami`, `channel:list`, `build:list --platform android --limit 5` (canal y runtimeVersion de cada build) y `update:list --branch main --limit 5` (runtimeVersion de cada update). Comparo canal→branch y fingerprint. Lo que haga falta (`eas channel:edit preview --branch main` o un build nuevo `eas build -p android --profile preview`) queda como recomendación y te lo confirmo antes de correrlo. Hoy la respuesta probable es que **no llega**: por el canal, si no se mapeó, y por el fingerprint después del rescate.

### Etapa 5a: `style-src` sin `unsafe-inline`
- `cloud/static/styles.css`: clases semánticas para los 38 estilos fijos (por ejemplo `.btn.auto`, `.form-angosto`, `.nota-previa`).
- Valores dinámicos: el HTML lleva `data-pct` / `data-i`, y un helper `aplicarMedidas(raiz)` en `cloud/static/js/ui/componentes.js` los vuelca a custom properties con `el.style.setProperty("--pct", …)`. CSSOM está permitido por la CSP. El CSS usa `calc(var(--pct) * 1%)`, `calc(var(--pct) * 3.6deg)` y `calc(var(--i) * 60ms)`. Lo llaman `calendario.js` y `progreso.js` después de pintar. El margin-top de `buscar.js` pasa a una clase condicional.
- Archivos: `app.js`, `pantallas/{admin,buscar,calendario,carrera,carreras,cuenta,historial,ingreso,inicio,organizadores,progreso}.js`, `ui/{componentes,resultado}.js`.
- `cloud/main.py`: `style-src 'self'` y actualizar el comentario de `_CSP`.

### Etapa 5b: rate limit con backend intercambiable
- `cloud/deps.py`: un `Protocol` `Limitador` con `registrar(clave, limite, ventana) -> bool`, `LimitadorEnMemoria` (la lógica actual, con su barrido, y usando el mismo `_RATE` para que los tests existentes sigan iguales) y `crear_limitador(nombre)`, elegido por `CT_RATE_LIMIT_BACKEND` (default `memoria`). Un valor desconocido falla al arrancar con un mensaje claro. `rate_limit_key` delega en el limitador.
- **No escribo un backend Redis.** Sería código sin tests o sumaría `redis`/`fakeredis`. El README documenta el contrato y qué implementar (INCR+EXPIRE o sorted set) cuando haya más de un worker.
- `.env.example` y README: la variable nueva.

### Etapa 5c: API key de publicación por organizador
- `cloud/models.py`: tabla `organizer_keys` con `id`, `name`, `key_hash` (sha256, único), `key_prefix` (para mostrar), `is_legacy`, `created_at`, `rotated_at`, `revoked_at` y `last_used_at`. Columna `published_races.owner_org_key_id` (FK, nullable).
- Migración en `cloud/main.py`: siguiendo el patrón de `_ensure_run_columns`, `ALTER TABLE` idempotente para la columna nueva. La tabla nueva la crea `create_all`.
- Módulo nuevo `cloud/organizadores.py`:
  - `resolver_key(x_api_key, db)`: busca por hash entre las no revocadas. Si coincide con `CT_PUBLISH_KEY` y todavía no hay fila `is_legacy`, la crea ("Organizador original") de forma perezosa. Así el escritorio ya instalado sigue publicando, y una vez rotada o revocada, la key global deja de valer.
  - Router admin: `GET/POST /api/run/admin/publish-keys`, `POST …/{id}/rotate` y `POST …/{id}/revoke`. Reusa la guarda admin de `cloud/run.py`. El texto plano (`lr_pub_` + `secrets.token_urlsafe(32)`) se devuelve una sola vez. Rotar cambia el secreto en la misma fila, así que la propiedad de las carreras se mantiene.
- `cloud/main.py`: `_check_publish_key` → `resolver_key`, y `_check_race_owner` pasa a ser por `owner_org_key_id`. Una carrera sin dueño, o con `owner_key_hash` igual al de la key global, se la queda la fila legacy en la próxima publicación. **Se agrega `_check_race_owner` en `publish_event`.** El chequeo de arranque en producción (`CT_PUBLISH_KEY` no default) queda igual.
- `cloud/static/js/pantallas/admin.js`: sección "Organizadores" (listar, crear, rotar, revocar, copiar la key una vez), con `data-act`.
- `DEPLOY.md` pasos 3–4: la key sale del panel de admin, no de Environment de Render. README: decisión de diseño.

### Etapa final
Suites completas, `PENDIENTES.md` actualizado (tachar lo cerrado y sumar lo nuevo), snapshot del disco en Render (manual, **antes** del push, porque hay migración) y después `git push origin main` + tags `archivo/*` + borrar `origin/arreglos-revision`. **Ese push redeploya el portal en Render (cambian `cloud/**` y `render.yaml`) y dispara la OTA de EAS (cambia `mobile/**`).** Te aviso antes de ejecutarlo.

## Tests

Todos en pytest, escritos antes del cambio que cubren (rojo → verde):
- `cloud/tests/test_hardening.py` o `test_portal_estaticos.py`: la CSP no contiene `unsafe-inline` en ninguna directiva. Ningún `.js` ni `index.html` de `cloud/static` contiene `style="`. `styles.css` define las custom properties `--pct`/`--i` que usa el helper.
- `test_health.py`: 200 con base sana y 503 si `SessionLocal` falla (monkeypatch). Que `render.yaml` apunte a `/api/health`.
- `test_rate_limit.py` (se extiende sin borrar nada): `LimitadorEnMemoria` corta en el límite y libera al pasar la ventana. `crear_limitador("xx")` falla con un mensaje que nombra la variable. `rate_limit_key` usa el limitador inyectado (fake por monkeypatch), lo que prueba que es intercambiable.
- `test_publish_keys.py`:
  - admin crea una key y la lista muestra solo el prefijo
  - un no-admin recibe 403
  - publicar con key A funciona
  - B no puede publicar, despublicar ni `POST /api/events` sobre una carrera de A (este último es el bug: rojo hoy)
  - con la key rotada, la vieja da 403 y la nueva publica y sigue siendo dueña
  - una key revocada da 403 y las carreras quedan
  - `CT_PUBLISH_KEY` crea la fila legacy y adopta carreras con `owner_key_hash` viejo o NULL
  - después de rotar la legacy, `CT_PUBLISH_KEY` da 403
  - la migración sobre una base con el esquema viejo es idempotente
- Los tests existentes de publicación (`conftest.publicar_carrera` con `test-publish-key`) pasan sin cambios. Si eso falla, es una señal de que se rompió la compatibilidad.

## Riesgos

- **Migración en producción sobre SQLite**: sin snapshot no hay vuelta atrás. Va primero el snapshot y después el push. El ALTER es aditivo e idempotente.
- **Lockout del escritorio**: si la key legacy se rota antes de pegar la nueva en el escritorio, la publicación falla con 403. Mitigación: la legacy sigue andando hasta que el admin la rota a propósito, y `DEPLOY.md` explica el orden.
- **CSS visual**: mover 42 estilos puede romper el layout sin que fallen los tests. Lo reviso en el navegador, en las pantallas que cambian y en los dos temas, mirando que no aparezcan violaciones de CSP en la consola.
- **OTA**: el push publica un update con un fingerprint nuevo, que los builds viejos ignoran sin romperse. Para que llegue hace falta un build nuevo, que es outward y te lo confirmo antes.
- **Borrar ramas sin mergear** (`-D`): queda cubierto por los tags `archivo/*` y el sha anotado.
- **`healthCheckPath` nuevo**: si `/api/health` fallara, Render no completaría el deploy y seguiría sirviendo la versión anterior. El riesgo es bajo y está testeado.
- Sin push forzado ni `reset --hard` en ningún paso.

## Verificación

- En cada etapa: `.venv/Scripts/python -m pytest cloud/tests backend/tests -q`, y en `mobile/`, `npm test`, `npm run lint` y `npx tsc --noEmit`. En `frontend/`, `npm run lint` y `npm run build`. Comparo los conteos con la etapa 0 (sin menos tests ni más warnings).
- Git: `git branch -a` final, más `git log main..<rama>` registrado para cada rama borrada y `git tag -l 'archivo/*'`.
- Portal local: `uvicorn cloud.main:app --port 8002`. Recorrer inicio, buscar, calendario, progreso, admin y cuenta en los temas claro y oscuro, con la consola sin errores de CSP. Hacer el flujo de admin: crear key → publicar desde el escritorio apuntando a localhost → rotar → ver el 403 con la vieja.
- Después del push: `curl` a `/api/health` y a `/api/races` (200), y la cabecera CSP sin `unsafe-inline`. Revisar la corrida de `gh run list --workflow eas-update.yml`.
- **Checklist manual del panel de Render** (va en el informe):
  - Environment: están `CT_SMTP_HOST/PORT/USER/PASSWORD/FROM` y `CT_PUBLIC_URL`
  - en los logs de arranque no aparece el warning "CT_SMTP_HOST no está configurado"
  - Disks → snapshot creado antes del push
  - el deploy terminó en "Live" con el health check nuevo
