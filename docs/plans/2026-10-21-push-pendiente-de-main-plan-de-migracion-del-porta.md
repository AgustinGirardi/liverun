# Push pendiente de main + plan de migración del portal de Render a Cloud Run

## Contexto

**Parte 1, el push.** `main` tiene 2 commits sin pushear (`3bf06f4` es el doc del plan de push y `1e9a6a3` trae las mejoras de la auditoría del 21/10). Pushear despliega el portal en Render (`render.yaml`: `autoDeploy`, filtro `cloud/**`) y además corre por primera vez la CI (`.github/workflows/ci.yml`) y `eas-update.yml` (porque cambió `mobile/**`). En `cloud/`, el commit parte `main.py` en routers y saca las migraciones a `cloud/migraciones.py`. El diff de `cloud/models.py` (+121/−101) parece ser solo formato de `ruff`, pero hay que confirmar que el esquema no cambia antes de pushear.

**Parte 2, la migración.** Hoy el portal es FastAPI + SQLAlchemy 2.1 + SQLite en el disco de Render (`/var/data/cloud.db`). Cloud Run no tiene disco persistente. Leyendo el código aparecieron problemas que el pedido no menciona y que el plan resuelve:

1. **Los avatares también viven en el disco.** `cloud/run.py:57` `avatar_dir()` los guarda en `/var/data/avatars`, junto a la base, y `main.py` los sirve con `StaticFiles`.
2. **"Producción" se detecta con `RENDER`.** `cloud/main.py:45,143,151`, `billing_routes.py:26` (`_EXIGIR_FIRMA` del webhook de MP), `google_auth.py:58` (cookie `Secure`) y `mailer.py:46`. En Cloud Run esa variable no existe, así que el portal arrancaría **sin exigir firma a los webhooks de MP, con cookies no seguras, sin HSTS, con `/docs` abierto y sin el chequeo de secretos**. Es el riesgo más grave.
3. **SQL que solo anda en SQLite.** Todo `cloud/migraciones.py` usa `PRAGMA table_info`, `_migrar_avatares_a_relativo` usa `instr()` (no existe en Postgres) y el ranking global (`cloud/run.py:793,837`) usa `date(x, '-10800 seconds')`.
4. **Hay que reasignar las secuencias.** Al copiar filas con su `id`, las secuencias de Postgres quedan en 1 y el primer INSERT falla.
5. **El escritorio no sigue redirecciones de POST.** `backend/core/account.py:46` usa `urllib.request`, que no reenvía un POST ante un 307/308. Un redirect desde Render no sirve para publicar: hay que cambiar la URL en cada escritorio antes del corte.
6. **Las URLs están fijas en el código** en `backend/core/account.py:21` (`DEFAULT_PORTAL`), `mobile/src/lib/api.ts:8`, `mobile/src/app/ranking.tsx:29` y `mobile/vercel.json:6`. Los defaults de `CT_PUBLIC_URL` están repetidos en 4 módulos de `cloud/`.

**Decisiones recomendadas:**
- **Base: Neon** (Postgres gestionado, región AWS `us-east-1`), y no Cloud SQL. Neon escala a cero, el plan gratis/Launch alcanza para este volumen, deja crear un *branch* para ensayar la migración y ya se usa en Control de stock IA. Cloud SQL cobra ~US$9–10/mes como mínimo aunque esté ocioso y suma el conector. Se usa el endpoint **directo**, no el pooler (psycopg 3 y PgBouncer en modo transacción se llevan mal con los prepared statements), con un pool chico y `pool_pre_ping`.
- **Región de Cloud Run: `us-east4`** (Virginia), al lado de Neon `us-east-1`. Para Argentina la latencia es parecida a la de Ohio, que es la de hoy. Además admite *domain mapping*, que `southamerica-east1` no tiene, y así nos ahorramos un load balancer (~US$18/mes).
- **Rate limit: `max-instances=1` con el backend en memoria.** Un portal de este tamaño entra cómodo en una instancia con `concurrency` 80. Si en algún momento hace falta escalar, ya está el punto de extensión (`_BACKENDS` en `cloud/deps.py`) para sumar un backend en la base. Escribirlo ahora sería una abstracción "por si acaso". Se acepta que los contadores se reinician cuando la instancia baja a cero.
- **`min-instances=0`, con CPU boost al arrancar.** Una instancia mínima siempre prendida (1 vCPU, 512 MiB) cuesta ~US$10/mes, más que Render. El día de carrera se sube a mano a 1 con `gcloud run services update --min-instances=1`, que queda documentado en DEPLOY.md.
- **Avatares: bucket de Cloud Storage montado como volumen** (Cloud Storage FUSE) en `/data/avatars`. El código casi no cambia: `avatar_dir()` pasa a leer `CT_AVATAR_DIR`.
- **Dominio propio** (DEPLOY.md, Paso 5) **como requisito del corte.** Si no, los links compartidos mueren con `onrender.com`. Render queda después como redirector 308 al dominio.
- **Respaldo:** el PITR de Neon y el versionado del bucket. No va backup fuera del proveedor en una PC propia (descartado).

## Parte 1: push de main (va primero, antes que cualquier cambio de la migración)

Es una operación de release y no toca archivos. Si algo falla, freno y aviso.
1. `git fetch origin`. Confirmar que `origin/main` no avanzó y que `git status --porcelain` está vacío.
2. Grep de secretos (`lr_pub_`, `APP_USR-`, `ghp_`, `AKIA`, `PRIVATE KEY`) sobre `git diff origin/main..main`.
3. Esquema sin cambios: comparar el DDL de `Base.metadata` (`CreateTable` de cada tabla) entre `origin/main` (en un worktree temporal) y `main`. Si cambia, pido el snapshot del disco de Render antes de seguir.
4. Verificaciones, una por vez: `ruff check .`, `ruff format --check .`, `python -m pytest cloud/tests backend/tests -q`, y `npm run lint`, `npm test` y `npm run build` (vite) en `frontend/`. En `mobile/` van `npm test`, `npm run lint` (estricto) y `npx tsc --noEmit`. Después, `git status --porcelain` tiene que seguir limpio.
5. `git push origin main` sin force. Confirmar que `git rev-parse origin/main` da `1e9a6a3`.
6. Health check con Monitor, cada ~30 s y hasta 15 min: `curl -s https://chronotrack-portal.onrender.com/api/health` tiene que dar `{"status":"ok"}` y `/api/races` tiene que dar 200. Como `/api/health` ya existía antes, confirmo en el dashboard de Render que el deploy en *Live* sea el commit `1e9a6a3`.
7. Mirar la primera corrida de la CI con `gh run watch`. Informo el resultado y dejo el checklist manual de DEPLOY.md para el dashboard.

## Parte 2: cambios de la migración (cada bloque es un commit chico, con sus tests)

**A. Que el portal no dependa de Render**
- `cloud/deps.py`: `en_produccion()` lee `CT_PRODUCCION=1` y, como respaldo, `RENDER`. También concentra `PUBLIC_URL`, que hoy está duplicada.
- Reemplazar los `os.environ.get("RENDER")` de `main.py`, `billing_routes.py`, `google_auth.py` y `mailer.py`, y los `PUBLIC_URL` de `billing.py`, `google_auth.py` y `run.py`, por lo que expone `deps`.
- `cloud/run.py` `avatar_dir()`: si está definida, usa `CT_AVATAR_DIR`; si no, la lógica actual.
- `.env.example`: sumar `CT_PRODUCCION` y `CT_AVATAR_DIR`.

**B. Que la base ande en Postgres sin dejar de andar en SQLite**
- `cloud/migraciones.py`: cambiar `PRAGMA table_info` por un helper `_columnas(conn, tabla)` con `sqlalchemy.inspect`. `_migrar_avatares_a_relativo` deja `instr`/`substr` y lo hace en Python. El resto (ALTER ADD COLUMN, CREATE INDEX IF NOT EXISTS, UPDATE) ya funciona en los dos motores.
- `cloud/run.py` (ranking): la expresión "día argentino" se elige según el dialecto. En SQLite queda `date(x, '±N seconds')` y en Postgres pasa a `date(x + make_interval(secs => N))`.
- `cloud/db.py`: con Postgres, `pool_pre_ping=True` y `pool_size`/`max_overflow` chicos. El default sigue siendo SQLite.
- `cloud/requirements.txt`: sumar `psycopg[binary]` (es el driver de `postgresql+psycopg://`; es la única dependencia nueva) y regenerar `cloud/requirements.lock` con el comando `uv` de su encabezado.

**C. Script de migración de datos.** `scripts/migrar_portal_a_postgres.py`:
- Recibe `--origen sqlite:///…` y `--destino postgresql+psycopg://…`. Primero corre las migraciones sobre una **copia** del origen, para que tenga todas las columnas. Después crea el esquema en el destino con `create_all`.
- Copia tabla por tabla en el orden de `Base.metadata.sorted_tables` (respeta las FK), en lotes y en una sola transacción. Si el destino ya tiene datos, se niega a seguir, salvo con `--vaciar`.
- Ajusta cada secuencia con `setval(pg_get_serial_sequence(...), max(id))`.
- Verifica, para cada tabla, el conteo y un hash del contenido ordenado por PK en origen y destino. Si algo no coincide, sale con código distinto de 0.
- Tiene que poder correrse más de una vez: primero en un Postgres local en Docker, después en un branch de Neon y por último en el corte real.

**D. Contenedor y deploy**
- `Dockerfile`: `python:3.12-slim`, `pip install -r cloud/requirements.lock`, usuario no root, `CMD uvicorn cloud.main:app --host 0.0.0.0 --port ${PORT}`. Un solo worker.
- `.dockerignore`: dejar afuera las `*.db*`, `.env`, `chronotrack_cloud.json`, `backend/`, `frontend/`, `mobile/`, `build/`, `dist/`, `installer/`, `avatars/` y `__pycache__`.
- `.github/workflows/ci.yml`:
  - Nuevo job `python-postgres` que corre `pytest cloud/tests` con `services: postgres:16` y `CT_CLOUD_DB=postgresql+psycopg://…`.
  - Nuevo job `deploy-portal`. Solo corre en push a `main`, con `needs: [python, python-postgres]`, y solo si cambió `cloud/**`, el `Dockerfile` o el workflow. Se autentica con Workload Identity Federation (sin claves JSON), hace build y push a Artifact Registry (`us-east4-docker.pkg.dev/<proyecto>/liverun/portal:<sha>`) y despliega con `gcloud run deploy`.
  - Parámetros del deploy: `--max-instances=1 --min-instances=0 --cpu-boost --memory=512Mi`, `--set-secrets`, `--set-env-vars CT_PRODUCCION=1,CT_AVATAR_DIR=/data/avatars,CT_PUBLIC_URL=…`, el volumen GCS, y probes de arranque y de vida en `/api/health` con timeout amplio, por el despertar de Neon.
  - Los IDs (proyecto, WIF, service account) van en `vars` del repo. Así se cierra el pendiente "que el deploy espere a la CI".
- Secretos en Secret Manager: `CT_CLOUD_DB`, `CT_CLOUD_SECRET`, `CT_PUBLISH_KEY`, `CT_MP_ACCESS_TOKEN`, `CT_MP_WEBHOOK_SECRET`, `CT_GOOGLE_CLIENT_SECRET` y `CT_SMTP_PASSWORD`. **Se copian los valores actuales de Render** para que sigan valiendo las sesiones y las claves de publicación.

**E. Documentación**
- `DEPLOY.md`: reescribirlo para Cloud Run. El bootstrap único va con comandos `gcloud`: proyecto, APIs, Artifact Registry, bucket con versionado, Secret Manager, service account con mínimos permisos, WIF y Neon. Después: deploy, dominio, día de carrera (`min-instances`), backups (PITR de Neon y versionado del bucket), checklist post-deploy y el runbook de corte. Render pasa a un apéndice "legado" hasta la baja.
- `README.md` (tests contra Postgres) y `PENDIENTES.md`.
- Constantes de URL al dominio nuevo, en un commit propio al cortar: `backend/core/account.py`, `mobile/src/lib/api.ts`, `mobile/src/app/ranking.tsx` y `mobile/vercel.json`.

**F. Plan de corte**
1. **Paralelo.** Cloud Run queda desplegado contra un *branch* de Neon, con una copia de la base bajada de Render (snapshot del disco, después `sqlite3 .backup` y `scp` por SSH de Render; a verificar en su doc). Ahí se ensaya el script, se recorre el portal en `*.run.app` y se miden los cold starts.
2. **Dominio.** Si no existe, se compra (`liverun.com.ar`, Paso 5). El TTL de DNS baja a 5 min un día antes.
3. **Ventana de corte** (sin carreras ese día, avisada):
   - Pausar la publicación desde el escritorio.
   - Suspender Render, para que no entren escrituras.
   - Bajar la base y los avatares finales.
   - Correr el script contra la rama principal de Neon y verificarlo.
   - Copiar los avatares al bucket.
   - Mapear el dominio a Cloud Run y esperar el certificado.
   - Fijar `CT_PUBLIC_URL`.
4. **Integraciones externas:** el redirect URI de Google OAuth en el dominio nuevo (se deja el viejo), la URL del webhook en el panel de Mercado Pago, y la URL del portal en cada escritorio (☁ Portal en la nube).
5. **Respaldo.** Render queda suspendido pero recuperable 2–4 semanas, con su disco intacto. Si hay que volver atrás, se reactiva y se vuelve a apuntar el DNS. Los datos escritos en Neon mientras tanto se perderían; queda documentado.
6. **Baja.** Render pasa a un redirector 308 hacia el dominio (para los links `/r/CODIGO` compartidos con `onrender.com`) o se borra. Después se quitan `render.yaml` y el apéndice.

## Tests

- **Nuevos:**
  - `cloud/tests/test_produccion.py`: con `CT_PRODUCCION=1` y sin `RENDER`, el arranque falla si los secretos son los default, el webhook exige firma, la cookie sale `Secure`, hay HSTS y `/docs` da 404. Sin ninguna de las dos variables, el comportamiento de desarrollo no cambia.
  - `test_migraciones.py`: sobre una base "vieja" (sin columnas) las migraciones las agregan y son idempotentes, y `_migrar_avatares_a_relativo` corre en los dos motores.
  - `test_avatar_dir.py`: `CT_AVATAR_DIR` tiene prioridad.
  - `test_migrar_portal_a_postgres.py`: con un origen con datos en todas las tablas, el destino tiene los mismos conteos y hashes, el siguiente INSERT no choca de id y la segunda corrida sin `--vaciar` falla.
- **Actualizados:** los tests que hoy setean `RENDER` (`test_hardening.py`, `test_run_billing.py`, `test_run_google.py` y otros), para que cubran las dos variables. Ranking y racha: el cálculo de días argentinos tiene que dar lo mismo en los dos motores.
- **Suite completa contra Postgres** en el job nuevo de la CI. `conftest.py` ya respeta `CT_CLOUD_DB` y hace `drop_all`/`create_all`. Lo que es propio de Postgres (secuencias) corre siempre en la CI; en local necesita Docker, y el README lo dice.
- La cobertura no baja, y no se borra ni se saltea ningún test existente.

## Riesgos

- **Seguridad en el cambio de plataforma** (punto 2 del Contexto). Se mitiga con el bloque A y su test, y en el checklist post-deploy un webhook sin firma tiene que dar rechazo.
- **Pérdida de datos en el corte.** La mitigan los ensayos (en Docker local y en un branch de Neon), la verificación por conteo y hash, la ventana sin escrituras y el disco de Render intacto como respaldo.
- **Diferencias SQLite/Postgres.** Postgres compara strings distinguiendo mayúsculas y valida los largos de `VARCHAR`. Un dato viejo más largo haría fallar la copia, y el script lo reporta. Lo cubre la suite completa contra Postgres en la CI.
- **IP del cliente para el rate limit.** `_peer_ip` toma el último salto de `X-Forwarded-For`, que en Cloud Run agrega el Google Front End. Hay que comprobarlo con una petición real en el paralelo.
- **Cold starts:** arranque de Python + migraciones al iniciar + despertar de Neon, unos 3–5 s. Se mide en el paralelo. Si molesta, `min-instances=1` (~US$10/mes).
- **Escritorios con la URL vieja.** No siguen el redirect del POST, así que hay que cambiarlos a mano en el corte. La app móvil tiene la URL fija, y hoy no hay builds que reciban OTA (PENDIENTES §2), así que el impacto es bajo.
- **Respaldo dentro del mismo proveedor:** si se pierde la cuenta de Neon, se pierde también su PITR. Se acepta, con export manual (`pg_dump`) antes de cada cambio de esquema, anotado en el checklist.
- **Domain mapping de Cloud Run** está en *preview*. Si da problemas, la salida es Cloudflare proxy hacia `*.run.app` o un load balancer (US$18/mes).
- **Costo esperado:** Cloud Run ~US$0–3, Neon US$0 (free) o ~US$19 (Launch, si se necesita PITR largo), GCS centavos. Hoy Render cuesta ~US$7 + disco.
- **Cosas a verificar en la doc al implementar:** el SSH/scp de Render, la región `us-east-1` de Neon, el domain mapping en `us-east4`, los volúmenes GCS en Cloud Run y la acción de filtro por rutas (fijada por SHA).

## Verificación

1. **Local:** `ruff check .`, `ruff format --check .`, `pytest cloud/tests backend/tests` con SQLite, y `pytest cloud/tests` con `CT_CLOUD_DB` apuntando a un Postgres en Docker. Además `docker build .` y `docker run -e PORT=8080 …` con `curl /api/health`, que tiene que dar `{"status":"ok"}`.
2. **Ensayo de migración:** en un branch de Neon, comparando conteos y hashes. En `*.run.app`:
   - Buscar una carrera conocida.
   - Iniciar sesión con una cuenta existente.
   - Ver un avatar, el ranking y el certificado.
   - Entrar a admin → Claves.
   - Pedir el mail de "olvidé mi contraseña".
3. **CI:** que todos los jobs pasen en verde y `deploy-portal` deje la revisión nueva sirviendo, con la health check en verde.
4. **Post-corte:**
   - `curl https://<dominio>/api/health`.
   - Publicar una carrera desde el escritorio con la URL nueva.
   - Pago de prueba de MP y su webhook aceptado.
   - Un webhook sin firma, rechazado.
   - Login con Google.
   - Cabeceras: HSTS presente y `/docs` en 404.
5. **Baja de Render:** después de 2–4 semanas sin incidentes, y con el último snapshot del disco archivado.

No toco el vault de Obsidian: lo maneja Gira.
