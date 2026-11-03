# Seguridad y privacidad de LiveRun

Estado del plan `docs/plans/2026-11-03-hardening-de-seguridad-y-privacidad-de-liverun-soc.md`
(SOC 2 / ISO 27001 / ISO 27701 / PCI SAQ A / OWASP / CIS / NIST). El repo queda
**listo para auditar**, no certificado.

Decisiones aprobadas: PCI con alcance mínimo (SAQ A), fases 0→5 en orden con un PR
por fase, token propio con TTL corto + logout + bloqueo por cuenta, DPAPI/`keyring`
para la clave del escritorio, retención GPS 24 meses / cuentas sin verificar 30 días /
auditoría 12 meses.

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

## Antes de desplegar estos cambios

- **Se desloguea a todos** (web y móvil): el formato viejo deja de valer. Hacerlo en un horario tranquilo y avisar.
- **`CT_PUBLIC_URL` tiene que estar cargada** en el entorno de producción (Render o Cloud Run); si no, el portal no arranca. Está pendiente en `PENDIENTES.md` §8.
- No cambia el esquema de la base: no hace falta snapshot previo.

## Pendiente (fases siguientes)

- **Fase 0:** `gap-analysis.md`, `inventario-datos.md`, `matriz-accesos.md`, `organizativo.md`, Dependabot, gitleaks, `npm audit` y actions por SHA en la CI.
- **Fase 1 (con esquema):** `cloud/audit.py` + tabla `audit_events` + migración (también en Postgres); auditar emisión/rotación/revocación de claves y acciones de admin.
- **Fase 2:** `result_revisions`, hash del lote, certificado con código y `/api/verificar/{código}`.
- **Fase 3:** política de privacidad, consentimiento versionado, `GET /api/me/export`, purga por retención (primero en modo "solo reportar").
- **Fase 4:** clave de publicación del escritorio con DPAPI/`keyring`, backups cifrados, OTA firmada, cola GPS cifrada en el móvil.
- **Fase 5:** `HEALTHCHECK` y base por digest en el `Dockerfile`, Trivy en CI, backup/restore probado.
- **Procesos y tareas organizativas** (AAIP, DPA con proveedores, MFA, revisión legal): ver el plan.
