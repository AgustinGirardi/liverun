# Hardening de LiveRun, parte 2: Fase 0 (auditoría y CI) + Fase 1 con esquema (auditoría de eventos)

## Contexto

El plan base `docs/plans/2026-11-03-hardening-de-seguridad-y-privacidad-de-liverun-soc.md` está aprobado (fases 0→5, un PR por fase, después del corte a Cloud Run). Ya está commiteada, sin push (`d53fb7c`, 462 tests), la parte de la Fase 1 que no toca el esquema: PBKDF2 600 000, token de 14 días sin formato viejo, logout, bloqueo por cuenta, headers/CORS, topes de tamaño y `CT_PUBLIC_URL` obligatoria en producción.

Ahora toca:
1. **Fase 0:** auditoría inicial (dependencias, secretos, historial), documentos de alcance, Dependabot, gitleaks, `npm audit` y actions por SHA en la CI.
2. **Fase 1, parte con esquema:** `cloud/audit.py`, tabla `audit_events` y su migración, más el cableado de eventos en auth, claves de organizador y acciones de admin.

Fuera de alcance: Fases 2 a 5, tareas organizativas (solo quedan listadas en `organizativo.md`) y el vault (lo maneja Gira).

Cómo se testea hoy: `python -m pytest cloud/tests backend/tests -q`, con SQLite temporal (`cloud/tests/conftest.py`) o Postgres con `CT_TEST_DB`; `ruff check` y `ruff format --check`. Las tablas nuevas las crea `Base.metadata.create_all` (`cloud/db.py:init_db`); `cloud/migraciones.py` solo agrega columnas a tablas existentes. El Python local no tiene pytest: hay que hacer `pip install -r requirements-dev.txt` antes de verificar.

## Cambios

### Fase 0 (un commit/PR propio)

**Auditoría inicial** (solo lectura, resultado volcado en `gap-analysis.md`):
- `pip-audit` de `cloud/requirements.lock` y `requirements.lock`; `npm audit` en `frontend/` y `mobile/` (mobile tiene ~71 conocidas por Expo 54, ver migración a 58); gitleaks sobre **todo el historial** (el repo es público: un hallazgo implica rotar ese secreto, no solo borrarlo).

**Documentos** (`docs/seguridad/`, se actualiza el índice `README.md`):
- `gap-analysis.md`: tabla del plan base con mapeo a SOC 2 / ISO 27001 / 27701 / PCI SAQ A / OWASP / CIS / NIST y los resultados de la auditoría.
- `inventario-datos.md`: dato, dónde vive, base legal, retención (24 m GPS / 30 d sin verificar / 12 m auditoría), quién accede.
- `matriz-accesos.md`: rol × endpoint, armada a partir de `app.routes` y de `test_rutas_autorizadas.py`.
- `organizativo.md`: checklist de lo que no es código (AAIP, DPA con proveedores, MFA, revisión legal, etc.).

**Configuración:**
- `.github/dependabot.yml` (nuevo): ecosistemas `pip` (`/cloud` y `/`), `npm` (`/frontend`, `/mobile`) y `github-actions`, semanal, agrupando minor/patch para no inundar de PRs.
- `.github/workflows/ci.yml`: job `secretos` con gitleaks (historial completo, `fetch-depth: 0`); `npm audit --audit-level=high` en el job `frontend`; en `mobile` el audit va **informativo** hasta la migración a Expo 58.
- Actions pineadas por SHA de 40 caracteres con el tag en comentario (`checkout`, `setup-python`, `setup-node`, `google-github-actions/*`, y las de `eas-update.yml`). Los SHA se resuelven con `gh api` en el momento; no se inventan.
- `.gitleaks.toml` solo si la auditoría muestra falsos positivos (valores de ejemplo en `.env.example`, tokens de tests).

### Fase 1b: auditoría de eventos (otro commit/PR)

- `cloud/models.py`: modelo `AuditEvent` (`audit_events`): `id`, `created_at` (UTC, indexado), `action` (indexado), `result` (`ok`/`fail`), `actor_type` (`user`/`admin`/`publish_key`/`anon`/`system`), `user_id` (entero **sin FK**, para que el historial sobreviva al borrado de la cuenta y no bloquee `db.delete(user)`), `target` (ej. `key:12`, `user:7`), `ip` (truncada), `detail` (texto corto, ≤200). Nunca email, nombre ni token.
- `cloud/audit.py` (nuevo, pequeño):
  - `registrar(db, accion, resultado, *, request=None, user_id=None, actor_type=..., target=None, detalle=None)`: agrega la fila y emite una línea JSON al logger `cloud.audit` (stdout → Cloud Logging / Render).
  - `ip_truncada(ip)`: IPv4 a /24, IPv6 a /48. Reusa `_client_ip` de `cloud/deps.py` (no confía en headers del cliente).
  - `huella_email(email)`: HMAC-SHA256 con `CT_CLOUD_SECRET`, truncado; solo para correlacionar logins fallidos sin guardar el email.
  - Filtro de redacción de logging (emails y `Bearer …` → `[redactado]`) enganchado al logger de auditoría.
  - Una falla al auditar se loguea como error y **no rompe** la request.
- `cloud/migraciones.py` / `cloud/db.py`: la tabla es nueva, así que `create_all` la crea sola en SQLite existente y en Postgres; no hay `ALTER`. Se agrega el test que lo demuestra (ver Tests) y se revisa que `scripts/migrar_portal_a_postgres.py` incluya `audit_events` en su lista de tablas.
- Cableado de eventos:
  - `cloud/auth.py`: `register`, `login_ok`, `login_fail`, `login_locked` (hoy el 429 por cuenta no deja rastro), `logout`, `password_change`, `password_reset`, `email_verified`, `account_deleted`. Se reemplaza el `print()` de `delete_account` (`auth.py:206`) por el evento + log.
  - `cloud/google_auth.py`: login/vinculación con Google.
  - `cloud/organizadores.py`: `publish_key_created`, `_rotated`, `_revoked` (con `key:<id>`, nunca el secreto ni el prefijo).
  - `cloud/run.py`: `admin_grant`, `coupon_created`, `coupon_toggled`.
- Los eventos de éxito se agregan a la misma sesión antes del `commit` de la acción (atómicos con ella); los de fallo hacen su propio commit.
- Los `print("[MP] …")` de `billing*.py` quedan como están (no son datos de la cuenta; migrarlos a logging estructurado va con la Fase 5).

### Documentación y seguimiento
- `docs/seguridad/README.md` y `PENDIENTES.md` §9: marcar lo hecho y dejar el paso a paso de deploy (abajo).
- `render.yaml:63-64`: el comentario de `CT_PUBLIC_URL` ("si no se carga, se usa onrender") ya es falso desde `d53fb7c`; se corrige.
- `README.md` §Seguridad: una línea sobre la auditoría de eventos y su retención.

## Tests (rojo → verde, estilo de `test_hardening.py`)

- `cloud/tests/test_auditoria.py` (nuevo): una fila por cada evento sensible (login ok/fail/locked, logout, cambio y reset de contraseña, verificación, borrado, alta/rotación/revocación de clave, grant y cupones de admin); `ip` truncada; **ni filas ni `caplog` contienen email, nombre, token ni la key** (se prueba con valores sentinela); la línea del log es JSON válido; si `registrar` falla, el login sigue respondiendo 200; el evento de borrado sobrevive a `DELETE /api/auth/account`.
- `cloud/tests/test_migraciones.py` (extender): una base sin `audit_events` la obtiene con `init_db` + `migrar_esquema`, y correrlo dos veces es idempotente (corre también con `CT_TEST_DB`).
- `cloud/tests/test_migrar_portal_a_postgres.py` (extender si la lista de tablas es explícita): `audit_events` se copia y su secuencia queda bien.
- `cloud/tests/test_account_delete.py`, `test_sesiones.py`, `test_rutas_autorizadas.py`: deben seguir pasando sin cambios (confirma que auditar no altera el comportamiento).
- `backend/tests/test_config_ci.py` (nuevo, con regex, sin dependencia de YAML): todo `uses:` de `.github/workflows/*.yml` está pineado a un SHA de 40 hex; `dependabot.yml` cubre `pip`, `npm` y `github-actions`; el workflow tiene el job de gitleaks y el `npm audit`.
- No se borra ni saltea ningún test; la cobertura no baja.

## Pasos de deploy (explícitos)

Aplican al conjunto ya commiteado (`d53fb7c`) más lo nuevo. **Nada se pushea sin tu OK.**

1. **Cargar `CT_PUBLIC_URL` en producción ANTES del push.** Si falta, el portal no arranca (`cloud/main.py:165`).
   - Cloud Run: la variable del repo en GitHub (`Settings → Variables → CT_PUBLIC_URL`, p. ej. `https://liverun.com.ar`). `ci.yml` la pasa con `--set-env-vars`; vacía equivale a ausente y el deploy fallaría en el startup probe (Cloud Run conserva la revisión anterior, pero el deploy queda en rojo).
   - Render (mientras exista): Dashboard → Environment → `CT_PUBLIC_URL` (en `render.yaml` es `sync: false`, no se carga sola).
2. Snapshot previo: Neon (branch/PITR) y snapshot manual del disco de Render, con la fecha anotada. El esquema cambia solo por una tabla nueva, pero así lo pide el plan base.
3. Elegir un horario tranquilo y avisar: **se desloguea a todos** (web y móvil) por el token viejo retirado; el móvil pide login de nuevo.
4. Push → esperar CI verde (`python`, `python-postgres`, gitleaks, audit) → deploy automático.
5. Verificar: `/api/health`, `curl -I` (headers nuevos, CORS), login real y una fila nueva en `audit_events`, logs sin PII ni errores de auditoría, mail de prueba (olvidé mi contraseña) con links al dominio correcto.
6. Rollback: volver a la revisión anterior de Cloud Run (o redeploy del commit previo en Render). `audit_events` es aditiva y queda sin uso; no hace falta revertir la base.

## Riesgos

- **Deploy sin `CT_PUBLIC_URL`:** el servicio no arranca (mitigado por el paso 1 y porque Cloud Run conserva la revisión sana).
- **Deslogueo masivo** por el token viejo: se avisa y se despliega en horario tranquilo.
- **PII en la auditoría:** riesgo central; mitigado con IP truncada, HMAC en lugar de email, redacción y test con sentinelas.
- **Auditar no puede romper el login:** `registrar` captura errores. Contrapartida: una falla silenciosa pierde un evento (queda en el log de errores).
- **Crecimiento de la tabla** y retención de 12 meses: la purga es de la Fase 3 (primero en "solo reportar"); hasta entonces la tabla crece. Volumen esperado bajo.
- **Historial con secretos:** si gitleaks encuentra algo, hay que rotarlo; puede abrir trabajo no previsto.
- **`npm audit` bloqueante:** puede dejar la CI en rojo por vulnerabilidades altas de `frontend/`; se resuelve actualizando o con excepción documentada.
- **Pinear actions por SHA** exige que Dependabot las mantenga al día; sin él se vuelven viejas.
- **Interacción con el corte a Cloud Run:** el plan base dice "después del corte". Si el corte aún no se hizo, hay que decidir si esto va a Render o espera.

## Verificación

- `pip install -r requirements-dev.txt`; `python -m pytest cloud/tests backend/tests -q` y `CT_TEST_DB=postgresql+psycopg://postgres:ci@localhost:5432/postgres python -m pytest cloud/tests -q` (Postgres con Docker, como en el README).
- `ruff check .` y `ruff format --check .`.
- `pipx run pip-audit==2.10.1 --no-deps --disable-pip -r cloud/requirements.lock` (y el lock de la raíz); `npm audit --audit-level=high` en `frontend/`; `npm audit` en `mobile/` (solo informe); gitleaks sobre el historial.
- `frontend/`: `npm run lint`, `npm test`, `npm run build` (la CI los corre; no se tocan, pero el job cambia).
- Manual: portal local (`uvicorn cloud.main:app --port 8002`), registrarse, loguearse bien y mal, rotar una clave desde admin y mirar `audit_events` y la salida del log (sin email ni token).
- CI en verde en el push, y revisión con `/security-review` de cada commit de fase.

## Decisiones abiertas

1. **Dónde vive la auditoría**
   - A) Tabla `audit_events` + línea JSON a stdout. *Recomendada.*
   - B) Solo tabla.
   - C) Solo log estructurado (Cloud Logging).
   - D) Tabla en una base separada.
2. **IP en el evento**
   - A) Truncada (/24 IPv4, /48 IPv6). *Recomendada.*
   - B) HMAC de la IP (correlaciona, no revela).
   - C) IP completa.
   - D) No guardarla.
3. **Login fallido: cómo identificar la cuenta**
   - A) HMAC del email con `CT_CLOUD_SECRET`, truncado; `user_id` si la cuenta existe. *Recomendada.*
   - B) Solo `user_id` (nulo si no existe).
   - C) `sha256` simple del email.
   - D) Nada.
4. **Si falla el registro del evento**
   - A) Éxitos en la misma transacción; fallos con commit propio; un error de auditoría se loguea y no rompe la request. *Recomendada.*
   - B) Fail-closed: si no se puede auditar, la acción falla.
   - C) Siempre en una sesión separada, mejor esfuerzo.
5. **"Migración" de `audit_events`**
   - A) Confiar en `create_all` y cubrirlo con test (sin código nuevo). *Recomendada.*
   - B) Función explícita `_ensure_audit_table` en `migrar_esquema`.
   - C) Introducir Alembic (cambio grande, plan propio).
6. **Gitleaks en la CI**
   - A) CLI oficial pineada, sobre el historial completo, en un job propio. *Recomendada.*
   - B) `gitleaks-action`.
   - C) A + hook de pre-commit local.
   - D) TruffleHog.
7. **`npm audit` en `mobile/`**
   - A) Bloqueante en `frontend/`, informativo en `mobile/` hasta Expo 58. *Recomendada.*
   - B) Bloqueante en ambos (rompe la CI hoy).
   - C) Solo `frontend/`.
   - D) Con excepciones listadas en un archivo.
8. **Eventos de publicación de carreras** (`publish` / `delete`)
   - A) Dejarlos para la Fase 2, con `result_revisions`. *Recomendada.*
   - B) Auditarlos ya, solo con evento.
   - C) Auditar solo el borrado de carreras.
9. **Orden de entrega**
   - A) Dos commits/PR locales (Fase 0 y Fase 1b), push junto con lo ya commiteado cuando confirmes la fecha. *Recomendada.*
   - B) Pushear primero `d53fb7c` y después cada fase.
   - C) Todo en un solo commit.
