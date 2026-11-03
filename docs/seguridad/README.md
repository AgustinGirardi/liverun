# Seguridad y privacidad de LiveRun

Estado del plan `docs/plans/2026-11-03-hardening-de-seguridad-y-privacidad-de-liverun-soc.md`
(SOC 2 / ISO 27001 / ISO 27701 / PCI SAQ A / OWASP / CIS / NIST). El repo queda
**listo para auditar**, no certificado.

Decisiones aprobadas: PCI con alcance mínimo (SAQ A), fases 0→5 en orden con un PR
por fase, token propio con TTL corto + logout + bloqueo por cuenta, DPAPI/`keyring`
para la clave del escritorio, retención GPS 24 meses / cuentas sin verificar 30 días /
auditoría 12 meses.

## Documentos

- [`gap-analysis.md`](gap-analysis.md): controles del plan mapeados a SOC 2 / ISO / PCI / OWASP / CIS / NIST y resultados de la auditoría inicial.
- [`inventario-datos.md`](inventario-datos.md): qué dato vive dónde, base legal, retención y quién accede.
- [`matriz-accesos.md`](matriz-accesos.md): rol × endpoint y eventos de auditoría.
- [`organizativo.md`](organizativo.md): checklist de lo que no es código (AAIP, DPA, MFA, revisión legal).

## Hecho (Fase 0: auditoría y CI)

| Control | Qué cambió | Dónde | Test |
|---|---|---|---|
| Auditoría inicial | `pip-audit` limpio; `npm audit` (zod alta en `frontend/` resuelta); gitleaks sobre 176 commits: solo un falso positivo de test, sin secretos que rotar | [`gap-analysis.md`](gap-analysis.md) | — |
| Secretos | Job `secretos` (gitleaks pineado con checksum, historial completo); `.gitleaks.toml` con el falso positivo | `.github/workflows/ci.yml`, `.gitleaks.toml` | `test_config_ci.py` |
| Dependencias | Dependabot semanal (pip ×2, npm ×2, actions); `npm audit --audit-level=high` bloqueante en `frontend/`, informativo en `mobile/` hasta Expo 58 | `.github/dependabot.yml`, `ci.yml` | `test_config_ci.py` |
| Cadena de suministro | Todas las actions por SHA de 40 caracteres con el tag en comentario | `.github/workflows/*.yml` | `test_config_ci.py` |

## Hecho (Fase 1, parte sin cambio de esquema)

| Control | Qué cambió | Dónde | Test |
|---|---|---|---|
| Contraseñas (NIST 800-63B) | PBKDF2 con 600 000 iteraciones; rehash transparente al loguear; blocklist de contraseñas comunes | `cloud/security.py`, `cloud/auth.py` | `test_sesiones.py` |
| Sesiones (ASVS V3) | Token de 14 días (antes 30); se retira el formato de 3 partes; `POST /api/auth/logout` | `cloud/security.py`, `cloud/auth.py` | `test_sesiones.py` |
| Fuerza bruta (API4) | Bloqueo por cuenta tras 5 fallos en 10 min, además del límite por IP | `cloud/deps.py` | `test_sesiones.py` |
| Headers y CORS (A05) | `Permissions-Policy`, COOP, CORP; CORS sin comodines | `cloud/main.py` | `test_headers.py` |
| Configuración | En producción el arranque falla sin `CT_PUBLIC_URL` | `cloud/main.py` | `test_headers.py` |
| Tamaño de entrada (API4) | 413 si el body declara más de 8 MB; tope de 20 000 resultados por publicación | `cloud/main.py`, `cloud/publish.py` | `test_limites.py` |
| Control de acceso (API1/API5) | Toda ruta no pública exige credenciales; lista blanca explícita | — | `test_rutas_autorizadas.py` |

## Hecho (Fase 1b: auditoría de eventos, con esquema)

| Control | Qué cambió | Dónde | Test |
|---|---|---|---|
| Logging y auditoría (SOC 2 CC7.2, ISO A.8.15) | Tabla `audit_events` (`user_id` sin FK) y línea JSON al logger `cloud.audit`; IP truncada (/24, /48); huella HMAC del email en logins fallidos; filtro que tapa emails y `Bearer …`; una falla al auditar se loguea y no rompe la request | `cloud/audit.py`, `cloud/models.py` | `test_auditoria.py` |
| Eventos cableados | `register`, `login_ok/fail/locked`, `logout`, `password_change/reset`, `email_verified`, `account_deleted`, `google_login/link`, `publish_key_created/rotated/revoked`, `admin_grant`, `coupon_created/toggled` | `cloud/auth.py`, `cloud/google_auth.py`, `cloud/organizadores.py`, `cloud/run.py` | `test_auditoria.py` |
| Esquema | Sin `ALTER`: `create_all` crea la tabla en SQLite y Postgres; el script de migración a Postgres la copia sola (`sorted_tables`) | `cloud/db.py` | `test_migraciones.py`, `test_migrar_portal_a_postgres.py` |

La tabla crece hasta la purga a 12 meses (Fase 3). Los `print("[MP] …")` de `billing*.py` siguen igual (Fase 5).

## Antes de desplegar estos cambios (paso a paso)

**Nada se pushea sin el OK de Agustín.**

1. **Cargar `CT_PUBLIC_URL` en producción ANTES del push.** Si falta, el portal no arranca (`cloud/main.py`).
   - Cloud Run: variable del repo en GitHub (`Settings → Variables → CT_PUBLIC_URL`, p. ej. `https://liverun.com.ar`). `ci.yml` la pasa con `--set-env-vars`; vacía equivale a ausente y el deploy queda en rojo en el startup probe (Cloud Run conserva la revisión anterior).
   - Render (mientras exista): Dashboard → Environment → `CT_PUBLIC_URL` (es `sync: false`, no se carga sola).
2. Snapshot previo, con la fecha anotada: Neon (branch/PITR) y snapshot manual del disco de Render. El esquema cambia solo por una tabla nueva.
3. Elegir un horario tranquilo y avisar: **se desloguea a todos** (web y móvil) por el token viejo retirado.
4. Push, esperar la CI en verde (`python`, `python-postgres`, `secretos`, audit) y el deploy automático.
5. Verificar: `/api/health`, `curl -I` (headers y CORS), un login real y una fila nueva en `audit_events`, logs sin PII ni errores de auditoría, y el mail de "olvidé mi contraseña" con links al dominio correcto.
6. Rollback: volver a la revisión anterior de Cloud Run (o redeploy del commit previo en Render). `audit_events` es aditiva y queda sin uso: no hace falta tocar la base.

## Antes de desplegar estos cambios (resumen)

- **Se desloguea a todos** (web y móvil): el formato viejo deja de valer. Hacerlo en un horario tranquilo y avisar.
- **`CT_PUBLIC_URL` tiene que estar cargada** en el entorno de producción (Render o Cloud Run); si no, el portal no arranca. Está pendiente en `PENDIENTES.md` §8.
- La Fase 1b suma la tabla `audit_events` (aditiva): se crea sola al arrancar. Igual conviene el snapshot previo del plan base.

## Pendiente (fases siguientes)

- **Fase 2:** `result_revisions`, hash del lote, certificado con código y `/api/verificar/{código}`.
- **Fase 3:** política de privacidad, consentimiento versionado, `GET /api/me/export`, purga por retención (primero en modo "solo reportar").
- **Fase 4:** clave de publicación del escritorio con DPAPI/`keyring`, backups cifrados, OTA firmada, cola GPS cifrada en el móvil.
- **Fase 5:** `HEALTHCHECK` y base por digest en el `Dockerfile`, Trivy en CI, backup/restore probado.
- **Procesos y tareas organizativas** (AAIP, DPA con proveedores, MFA, revisión legal): ver el plan.
