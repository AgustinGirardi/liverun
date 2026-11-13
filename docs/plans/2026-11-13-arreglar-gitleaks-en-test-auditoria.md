# Arreglar el job `secretos` (gitleaks) por la clave de prueba de test_auditoria

## Contexto
Tras pushear `d53fb7c..152ea67` (run 43438349458), todos los jobs pasaron (`python`,
`python-postgres`, `mobile`, `frontend`) salvo `secretos`: gitleaks (regla `generic-api-key`,
entropía 3.57) marca `PASSWORD = "clave-sentinela-9X7"` en `cloud/tests/test_auditoria.py:21`
(commit `152ea67`). Es un valor de prueba, no un secreto real. `deploy-portal` se saltó
(no corrió; `needs` solo pide `python` y `python-postgres`, así que se espera que falte `vars.GCP_PROJECT_ID`).

## Cambios (a aprobar)
Allowlist puntual en `.gitleaks.toml`: `paths = ['''cloud/tests/test_auditoria\.py''']` con
`regexes = ['''clave-sentinela-9X7''']`, con descripción del falso positivo.

## Tests
Un arreglo de configuración, sin código. Verificación: correr `gitleaks git --redact .` local
(mismo binario y versión que la CI) → 0 hallazgos, y confirmar `secretos` en verde en la CI.

## Riesgos
- Allowlist demasiado amplia podría ocultar secretos reales: se acota por path **y** por valor.
- Un push nuevo cancela corridas en curso de la rama (`cancel-in-progress`).
- El commit `152ea67` ya está publicado: la opción de reescribir historial exige force-push.

## Decisiones abiertas
1. **Cómo silenciar el hallazgo**: (a) allowlist por path + valor en `.gitleaks.toml` *(recomendada)*;
   (b) cambiar el valor a algo de baja entropía (`"clave-de-prueba"`) y allowlistear igual el commit viejo
   por fingerprint; (c) `.gitleaksignore` con el fingerprint; (d) reescribir historial (descartada: force-push).
2. **Cómo seguir**: (a) un commit chico + push y `gh run watch` *(recomendada)*; (b) PR para ver la CI antes de mergear.
