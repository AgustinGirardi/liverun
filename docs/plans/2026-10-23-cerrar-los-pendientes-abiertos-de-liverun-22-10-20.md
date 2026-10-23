# Cerrar los pendientes abiertos de LiveRun (22/10/2026)

## Contexto

- **Estado de git:** `main` está 1 commit adelante: `c1da443 feat(portal): preparar la migración a Cloud Run + Postgres (Neon)`. `origin/main` = `1e9a6a3` (lo confirmé con `git ls-remote`). El árbol está limpio.
- **La migración a Cloud Run quedó solo en código.** `c1da443` trae `en_produccion()` (`CT_PRODUCCION` o `RENDER`), `CT_AVATAR_DIR`, migraciones portables, `scripts/migrar_portal_a_postgres.py`, el `Dockerfile` y los jobs de CI `python-postgres` y `deploy-portal`. En Google Cloud, Neon y Render no se tocó nada (PENDIENTES §7). **El portal sigue corriendo en Render** (`chronotrack-portal.onrender.com`), así que el punto 2 se revisa ahí, con el checklist del apéndice de Render en `DEPLOY.md` (~línea 472).
- **Qué dispara el push:**
  - Render: `autoDeploy`, porque `c1da443` toca `cloud/**`.
  - La CI completa, con el job nuevo `python-postgres` corriendo por primera vez en Actions.
  - `deploy-portal` se saltea solo: tiene `if: vars.GCP_PROJECT_ID != ''`, `ci.yml:84`.
  - `eas-update.yml` no corre, porque no cambió `mobile/**`.
  - Render usa `runtime: python` + `requirements.lock`. El `Dockerfile` no le afecta, pero sí instala `psycopg[binary]`, que es nuevo.
- **El esquema no cambia:** `cloud/models.py` no está en el diff. Las migraciones cambian de forma (`inspect` en vez de `PRAGMA`, `TIMESTAMP` en vez de `DATETIME` solo para columnas que faltan). El único cambio que toca datos es `_migrar_avatares_a_relativo`, que ahora se hace en Python, es idempotente y en prod no debería encontrar filas.
- **OTA:** `app.json` tiene `runtimeVersion.policy: fingerprint`. El canal `preview` apunta al branch `preview`, que está vacío, y los APK instalados tienen `exposdk:54.0.0`. `eas-cli` no está instalado global; con `npx eas-cli@latest` hay que ver si hay sesión.
- Rate limiting con Redis: **no se toca**. El vault de Obsidian tampoco (es de Gira).

## Cambios

Es casi todo operación. El único archivo del repo que cambia es `PENDIENTES.md`, más el plan en `docs/plans/`, como en los cierres anteriores.

**1. Push (lo hago yo; si algo falla, freno y aviso)**
1. Hago `git fetch origin` y confirmo que `origin/main` sigue en `1e9a6a3` y que `git status --porcelain` está vacío.
2. Corro el grep de secretos (`lr_pub_`, `APP_USR-`, `ghp_`, `AKIA`, `PRIVATE KEY`) sobre `git diff origin/main..main`.
3. Confirmo que el esquema no cambia: el DDL de `Base.metadata` en un worktree temporal de `origin/main` tiene que ser igual al de `main`. Si difiere, freno y pido el snapshot del disco de Render antes de seguir.
4. Corro las verificaciones locales (ver Tests).
5. Hago `git push origin main`, sin force, y confirmo que `origin/main` quede en `c1da443`.

**2. Deploy en Render (lo verifico yo desde afuera)**
- Monitor cada ~30 s, durante 15 min como máximo: `curl -s https://chronotrack-portal.onrender.com/api/health` tiene que dar `{"status":"ok"}` y `/api/races`, 200.
- Producción de verdad, ahora que la decide `en_produccion()`: `/docs` tiene que dar 404 y tiene que venir la cabecera `strict-transport-security`. Si `/docs` responde 200, `RENDER` no llega y es un problema grave de seguridad: aviso enseguida.
- La CI con `gh run watch`: `python`, `python-postgres` y el resto en verde, y `deploy-portal` salteado.

**3. OTA de EAS**
- Pruebo `npx eas-cli@latest whoami` desde `mobile/`.
- **Si hay sesión:**
  1. `eas channel:view preview`, para ver el estado antes del cambio.
  2. `eas channel:edit preview --branch main`, que es lo que pediste.
  3. `eas fingerprint:generate -p android` y lo comparo con el runtime del último update de `main` (`eas update:list --branch main --json --non-interactive`).
  4. Lanzo `eas build -p android --profile preview --no-wait` desde `main` limpio y te paso el link del build.
- **Si no hay sesión**, quedan como pasos para Agustín.

**4. `PENDIENTES.md`:** tacho lo que quede cerrado (push, health, CI, canal) y dejo abiertos, con pasos concretos, los que dependen de paneles.

**Pasos para Agustín (no se pueden hacer desde el repo)**
1. **Render → Environment:** confirmar que `CT_PUBLIC_URL` tenga la URL real, y que estén `CT_SMTP_HOST`, `CT_SMTP_PORT`, `CT_SMTP_USER`, `CT_SMTP_PASSWORD` y `CT_SMTP_FROM`. En Logs no tiene que aparecer `CT_SMTP_HOST no está configurado`. Hacer la prueba de mail: Ingresar → ¿Olvidaste tu contraseña?
2. **Render → Disks:** que los snapshots automáticos estén activos. Crear uno manual y anotar la fecha. Es el respaldo previo a la migración, que lo va a necesitar.
3. **Render → Events:** que el deploy en *Live* sea `c1da443`.
4. **EAS** (si no lo pude hacer yo):
   1. `cd mobile && npx eas-cli@latest login`
   2. `npx eas-cli@latest channel:edit preview --branch main`
   3. `npx eas-cli@latest build -p android --profile preview`
5. **Después del build:**
   1. Instalar el APK.
   2. Correr el workflow `EAS Update (OTA)` a mano (*Run workflow*), para que se publique un update con el fingerprint de ese build.
   3. Abrir la app dos veces y comprobar que tome el update.
   4. Hacer la verificación en dispositivo de PENDIENTES §1.

## Tests

No hay cambios de código, así que no se escriben tests nuevos. Antes del push corro, una por vez, toda la suite y los chequeos del repo:
- **Python:** `ruff check .`, `ruff format --check .` y `python -m pytest cloud/tests backend/tests -q` (con SQLite; la de Postgres la cubre el job `python-postgres` en la CI).
- **`frontend/`:** `npm run lint`, `npm test` y `npm run build`.
- **`mobile/`:** `npm test`, `npm run lint` y `npx tsc --noEmit`.

Si algo falla, no pusheo.

## Riesgos

- **Deploy automático en Render.** Va a prod aunque la CI salga en rojo (`autoDeploy`). Lo mitigan las verificaciones locales previas y el health check posterior. Para volver atrás: *Rollback* en Render al deploy de `1e9a6a3`, que no tiene cambios de esquema.
- **Falla instalando `psycopg[binary]` en Render.** El build fallaría y Render deja la versión anterior sirviendo, así que no hay caída. Si pasa, aviso con el log.
- **`python-postgres` puede fallar en su primera corrida en Actions.** No afecta a Render; lo informo con el output.
- **Push sin snapshot manual previo.** El esquema no cambia y Render hace snapshots automáticos diarios. Si el chequeo de DDL marca diferencias, freno.
- **Build de EAS:** gasta cuota de builds. Además, la migración a Expo 58, que está pendiente, cambia el fingerprint y va a exigir **otro** build. Aun así conviene hacerlo ahora, porque hoy ningún dispositivo recibe OTA.
- **`channel:edit`:** cambia qué updates ven los builds `preview` que ya están instalados. Con `exposdk:54.0.0` igual ignoran los de `main` por runtime, así que no hay riesgo de que les llegue un update incompatible.

## Verificación

- `git rev-parse origin/main` da `c1da443`.
- `/api/health` responde `{"status":"ok"}`, `/api/races` da 200, `/docs` da 404 y está HSTS.
- La CI queda en verde (o informo exactamente qué falló).
- `eas channel:view preview` muestra el branch `main`, y el build queda en cola o terminado con un fingerprint igual al del próximo update.
- `PENDIENTES.md` queda actualizado y commiteado con el porqué. Ese commit lo pusheo también: solo toca `PENDIENTES.md`, así que no redeploya el portal.
- Informe final: qué quedó hecho y qué pasos quedan para Agustín.
