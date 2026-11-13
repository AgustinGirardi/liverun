# Pushear los 3 commits a main y seguir la CI

## Contexto
`main` está 3 commits adelante de `origin/main` (árbol limpio):
- `d53fb7c` hardening de sesiones, headers y límites del portal (+ plan aprobado)
- `0f2e28f` Fase 0: auditoría, Dependabot, gitleaks, actions fijadas por SHA
- `152ea67` Fase 1b: auditoría de eventos (tabla `audit_events`, log JSON sin PII)

La CI (`.github/workflows/ci.yml`) corre en cada push. El job `python-postgres` corre
`pytest cloud/tests` contra Postgres 16 (`CT_TEST_DB`) y nunca se ejecutó local contra
Postgres; la tabla `audit_events` y su test de migración son lo nuevo que lo toca.
Última corrida conocida: 2026-10-23.

## Cambios
Ninguno de código en el camino feliz.
1. `git push origin main` (fast-forward, sin force). Remoto: `AgustinGirardi/liverun`.
2. Seguir la corrida con `gh run list` / `gh run watch` hasta que terminen todos los jobs:
   `python`, `secretos` (gitleaks sobre todo el historial), `python-postgres`, `mobile`, `frontend`.
3. Confirmar en especial `python-postgres`.
4. Si algo falla: leer `gh run view --log-failed`, diagnosticar la causa y **proponer el arreglo
   en un plan nuevo** (no se arregla sin aprobación).

Sospechosos a mirar primero si `python-postgres` falla:
- `cloud/tests/test_migraciones.py::test_una_base_sin_audit_events_...` hace `DROP TABLE IF EXISTS audit_events`
  sobre la base compartida: en Postgres puede quedar bloqueado por una sesión abierta de otro test
  o dejar la tabla ausente para los tests siguientes.
- `cloud/tests/test_auditoria.py` (315 líneas): tipos de `DateTime` naive, longitudes de `String(n)`
  (Postgres las hace cumplir, SQLite no) y orden de resultados sin `ORDER BY`.
- `cloud/audit.py`: el commit propio de los eventos "fail" frente a la transacción de la request.

## Tests
No se escriben tests nuevos para el push. Si hay una falla en Postgres, el arreglo propuesto
va con el test que la reproduce (rojo → verde), corriendo la suite contra Postgres local
(`CT_TEST_DB=postgresql+psycopg://...`, p. ej. con Docker `postgres:16`).

## Riesgos
- **Deploy automático:** el push a `main` toca `cloud/` y `ci.yml`, así que `deploy-portal` se
  dispara a Cloud Run si `vars.GCP_PROJECT_ID` está cargada (solo corre si pasan `python` y
  `python-postgres`). Además Render despliega solo (`autoDeploy`). Hay que verificar `/api/health`
  después.
- **gitleaks** escanea el historial completo (repo público): un hallazgo viejo no cubierto por
  `.gitleaks.toml` rompe el job `secretos`.
- La tabla nueva la crea `create_all` (sin ALTER): en producción se crea sola al arrancar;
  no requiere migración manual.
- `concurrency.cancel-in-progress` cancela corridas previas de la misma rama si se pushea de nuevo.
- Irreversible hacia afuera: un push a una rama pública no se "despublica". Sin force-push.

## Verificación
- `git status -sb` → `main...origin/main` sin adelanto.
- `gh run list -L 3` / `gh run watch`: todos los jobs en verde; `python-postgres` con los tests
  de `cloud/tests` pasando.
- Si corrió `deploy-portal`: paso "Comprobar que el servicio nuevo está sano" en verde.
- Informar el resultado fielmente, con el log si algo falla.

## Decisiones abiertas
1. **Cómo confirmar el push**: (a) push directo a `main` *(recomendada, es lo pedido)*;
   (b) rama + PR para ver la CI antes de mergear; (c) correr Postgres local con Docker antes de pushear;
   (d) pushear con el deploy desactivado temporalmente.
2. **Si falla `python-postgres`**: (a) diagnosticar y plan nuevo *(recomendada)*; (b) revertir los
   commits de `main`; (c) arreglo directo sin plan aparte; (d) saltear el test solo en Postgres
   (descartada por los estándares).
3. **Deploy a Cloud Run**: (a) dejar que corra si pasa la CI *(recomendada)*; (b) pausarlo hasta
   confirmar que `python-postgres` pasa; (c) desplegar a mano más tarde.
4. **Cómo seguir la CI**: (a) `gh run watch` hasta el final *(recomendada)*; (b) revisar al rato con
   `gh run list`; (c) programar un chequeo periódico.
