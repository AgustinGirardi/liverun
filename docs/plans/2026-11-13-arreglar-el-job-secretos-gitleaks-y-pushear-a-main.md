# Arreglar el job `secretos` (gitleaks) y pushear a main

## Contexto
El run 43438349458 (push `d53fb7c..152ea67`) pasó todos los jobs salvo `secretos`: gitleaks
(regla `generic-api-key`) marca `PASSWORD = "clave-sentinela-9X7"` en
`cloud/tests/test_auditoria.py:21`. Es un valor de prueba (sentinela para detectar fugas de
datos en logs/filas de auditoría), no un secreto real. Ya existe el plan
`docs/plans/2026-11-13-arreglar-gitleaks-en-test-auditoria.md` (+ `.html`) con la opción
recomendada: allowlist en `.gitleaks.toml` acotada por path y valor.

Estado: `main` está 1 commit adelante de `origin/main` (`110a362`, solo docs/planes).
El CI escanea todo el historial (`gitleaks git`, `fetch-depth: 0`, v8.30.1 fijada con
checksum), y lee `.gitleaks.toml` del árbol de trabajo, así que la allowlist cubre también
el commit viejo `152ea67` sin reescribir historial.

Hallazgo del análisis: **gitleaks no está instalado en esta máquina** (`command not found`).
El valor solo aparece en `test_auditoria.py:21` (y en los planes que lo citan).

## Cambios
1. `.gitleaks.toml`: agregar un segundo bloque `[[allowlists]]` siguiendo el formato del existente
   (el de `backend/tests/test_cloud_config.py` / `lr_pub_abcdefgh1234`):
   ```toml
   [[allowlists]]
   description = "Contraseña sentinela (no real) del test de auditoría"
   paths = ['''cloud/tests/test_auditoria\.py''']
   regexes = ['''clave-sentinela-9X7''']
   ```
   Se acota por path **y** valor; (en gitleaks 8 con ambos criterios, la condición por
   defecto es OR, ver riesgo 1 y Verificación).
2. Sin cambios en el test ni en `ci.yml`.
3. El vault de Obsidian no se toca: Gira se encarga de él, aunque `C:\dev\CLAUDE.md` pida
   actualizar la nota hub y capturar en Inbox. Al cerrar lo aviso en una línea.

## Tests
Es configuración, sin código de producción: no hay test unitario que escribir. La "prueba" es
el propio gitleaks, en dos pasos (rojo → verde):
- Rojo: antes del cambio, `gitleaks git --redact` local reproduce el hallazgo en `152ea67`.
- Verde: después, 0 hallazgos.
- Además corro la suite habitual (`pytest`, ruff) para confirmar que nada cambió.

## Riesgos
1. **Allowlist por path+valor**: en gitleaks 8.x, con `paths` y `regexes` en el mismo bloque la
   condición por defecto es `OR` (se ignora todo el archivo O todo lo que matchee el regex en
   cualquier archivo). Para que sea realmente acotada hay que poner `condition = "AND"`.
   Lo verifico con la versión 8.30.1 y, si aplica, lo agrego (el bloque existente de
   `test_cloud_config.py` tiene el mismo problema; lo anoto, no lo toco).
2. gitleaks no está instalado: hay que bajar el binario oficial v8.30.1 para Windows. Lo bajo
   a un directorio nuevo fuera del repo, verifico el checksum contra el `checksums.txt` de la
   release y lo ejecuto pasando la ruta del repo como argumento. Es una descarga externa:
   te aviso antes de hacerla.
3. Push a `main` es una acción publicada: incluye `110a362` (docs) + el commit nuevo. Un push
   nuevo cancela corridas en curso de la rama (`cancel-in-progress`).
4. Hay runs de Dependabot en cola en el mismo repo; no los toco. Siguiendo la CI miro solo
   el run de `main`.
5. `deploy-portal` se saltó en el run anterior (esperable: falta `vars.GCP_PROJECT_ID`). Si
   sigue saltado, lo reporto tal cual y no cuenta como falla.
6. Historial no se reescribe (sin force-push).

## Verificación
1. Bajar gitleaks 8.30.1 (Windows x64), verificar checksum.
2. Antes del cambio: `gitleaks git --redact --verbose --exit-code 1 <repo>` → debe fallar con
   `generic-api-key` en `152ea67` (confirma el rojo y que local = CI).
3. Aplicar el cambio y repetir → exit 0, 0 hallazgos en todo el historial.
4. Prueba negativa: el mismo valor en otro archivo (temporal, sin commitear) o un secreto falso
   distinto en `test_auditoria.py` debe seguir marcándose si se usa `condition = "AND"`.
5. `pytest` y `ruff` del repo en verde.
6. Commit chico (`fix(ci): allowlist de la clave sentinela de test_auditoria en gitleaks`, con
   el porqué y la línea Co-Authored-By), `git push origin main` (publica ambos commits).
7. `gh run list --branch main` + `gh run watch <id> --exit-status` hasta que `python`,
   `python-postgres`, `mobile`, `frontend` y `secretos` queden en verde; reportar el estado de
   `deploy-portal`. Si algo falla, leo `gh run view --log-failed` y lo informo antes de seguir.

## Decisiones abiertas
1. **Cómo silenciar el hallazgo**
   - (a) Allowlist por path + valor en `.gitleaks.toml` *(recomendada)*.
   - (b) Cambiar el valor del test a uno de baja entropía y allowlistear igual el commit viejo por fingerprint.
   - (c) `.gitleaksignore` con el fingerprint del hallazgo en `152ea67`.
   - (d) Reescribir historial (descartada: exige force-push sobre un commit ya publicado).
2. **Condición de la allowlist**
   - (a) `condition = "AND"` (path **y** valor) *(recomendada, si 8.30.1 la soporta)*.
   - (b) Dejar el default (OR), igual que el bloque existente: más simple pero más laxo.
3. **Cómo conseguir gitleaks local**
   - (a) Binario oficial v8.30.1 a un directorio temporal fuera del repo, con checksum *(recomendada)*.
   - (b) Docker (`zricethezav/gitleaks:v8.30.1`), si hay Docker disponible.
   - (c) `winget`/`scoop`, instala globalmente (menos control de versión).
4. **Cómo seguir la CI**
   - (a) Commit chico + push a `main` + `gh run watch` *(recomendada, es lo que pediste)*.
   - (b) PR para ver la CI antes de mergear.
