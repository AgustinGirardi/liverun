# Pushear 31ac6e6 a main y seguir la CI

## Contexto
`main` está 1 commit adelante de `origin/main`: 31ac6e6 (checklist de Render en DEPLOY.md, test de variables de render.yaml, comandos de EAS en mobile/README.md, PENDIENTES.md y el plan aprobado). La última CI en main (3c4ce59) pasó. Se espera que `deploy-portal` se saltee porque `vars.GCP_PROJECT_ID` está vacía.

## Cambios
Ninguno de código. Solo `git push origin main` (fast-forward, sin force) y seguir el run con `gh run watch` / `gh run view`.

Jobs de ci.yml a vigilar: `python` (ruff check, ruff format --check, pytest cloud+backend, pip-audit), `secretos` (gitleaks sobre todo el historial), `python-postgres`, `mobile`, `frontend`, y `deploy-portal` (esperado: skipped).

## Tests
No se escriben nuevos. El commit ya trae `test_render_yaml_declara_url_y_smtp_para_cargar_a_mano` (cloud/tests/test_health.py). Importa `yaml`: pyyaml==6.0.3 está en cloud/requirements.lock y requirements.lock, así que CI lo instala (localmente depende del entorno).

## Riesgos
- `ruff format --check` sobre el test nuevo (nunca corrió en CI).
- gitleaks: el commit nombra SMTP/CT_* y un fingerprint `0377e9e3…`; podría dar falso positivo (ya hubo uno, resuelto en 3c4ce59 con allowlist).
- pyyaml es dependencia transitiva, no declarada: si un lock la saca, el test rompe.
- `deploy-portal` no debe correr; si corriera, fallaría sin GCP. Si aparece como failure en vez de skipped, la condición `if` está mal.
- Los push a ramas de Dependabot fallan en `mobile` (ruido ajeno a este push).

## Verificación
1. `git push origin main`.
2. `gh run list --branch main --limit 1`, luego `gh run watch <id>` hasta el final.
3. Confirmar: python, secretos, python-postgres, mobile, frontend en success; deploy-portal en skipped.
4. Si algo falla: `gh run view <id> --log-failed`, diagnosticar la causa y proponer el arreglo sin aplicarlo.

## Decisiones abiertas
1. **Cómo pushear**: (a) push directo a main, recomendada, es lo que pediste y el cambio es docs + 1 test; (b) rama + PR y esperar CI antes de mergear; (c) correr antes ruff y pytest local y recién después pushear.
2. **Si falla un job**: (a) solo diagnosticar y proponer, recomendada, según el pedido; (b) diagnosticar y arreglar en un commit aparte con test que lo reproduzca; (c) revertir 31ac6e6 hasta entender.
3. **pyyaml no declarada**: (a) dejarlo como está; (b) sumar `pyyaml` a requirements-dev.txt, recomendada si el test es permanente, para no depender de una transitiva; (c) parsear render.yaml sin yaml (regex), peor.
4. **Cómo seguir la CI**: (a) `gh run watch` en foreground, recomendada; (b) polling en segundo plano; (c) revisar a mano más tarde.
