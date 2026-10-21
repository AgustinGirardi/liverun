# Push de main a origin/main y verificación del deploy del portal

## Contexto

`main` está 14 commits adelante de `origin/main` (de `ec15199` a `bb446ee`): el rescate móvil/a11y, `/api/health`, la CSP sin `'unsafe-inline'`, el rate limit intercambiable, las API keys por organizador (tabla nueva `publish_keys`) y los avisos y guías del 20/10. El push quedó frenado porque despliega el portal en Render (`render.yaml`: `autoDeploy`, `branch: main`, filtro `cloud/**` y `render.yaml`) y suma una tabla. Agustín ya confirmó los snapshots del disco (20/10 a las 20:55 y 19/10 a las 20:50), que era la condición de `PENDIENTES.md` §5.

Lo que ya revisé (solo lectura):
- Árbol limpio; `chronotrack.db`, `chronotrack_cloud.json`, `cloud/cloud.db` y `.env` están en `.gitignore`. Los únicos archivos versionados con nombre "sensible" son `.env.example` (sin valores; el diff solo agrega `CT_RATE_LIMIT_BACKEND=memoria`) y `cloud/tests/test_publish_keys.py`.
- Un grep de patrones de secretos (`lr_pub_…`, `APP_USR-`, `ghp_`, `AKIA`, claves privadas, contraseñas literales) sobre el diff `origin/main..main` no encontró nada.
- Esquema: el único cambio es la tabla nueva `publish_keys` (`cloud/models.py`), que `create_all` crea en `cloud/db.py:31`. Es aditivo y no toca columnas existentes.
- Producción hoy usa `healthCheckPath: /api/races`; el push lo pasa a `/api/health` (`cloud/main.py:166`, con tests en `cloud/tests/test_health.py`).

## Cambios

**No se modifica ningún archivo del repo.** Es una operación de release: verificar, pushear y validar. No se crean commits. Los pendientes de `PENDIENTES.md` §5 que se resuelvan (push, health check) se informan en la respuesta. Tacharlos sería un commit aparte, solo si Agustín lo pide.

No toco el vault de Obsidian: lo maneja Gira.

## Tests (no se escriben tests nuevos: solo se corre la suite existente)

Un comando por vez desde `C:\dev\liverun`. Si alguno falla, me detengo y no pusheo:
1. `git status --porcelain` vacío y `git log --oneline origin/main..main` (los 14 commits, listados en la respuesta). Antes, `git fetch origin` para confirmar que `origin/main` no avanzó; si avanzó, freno y aviso (sin rebase ni force).
2. Repetir el grep de secretos sobre `git diff origin/main..main`.
3. `python -m pytest cloud/tests backend/tests -q` (README: ~330 tests).
4. `cd mobile && npm test` (jest).
5. `cd mobile && npx tsc --noEmit`.
6. `cd mobile && npm run lint` y `cd frontend && npm run lint`. Pasa si no hay errores; los avisos preexistentes (28 en móvil y 2 en escritorio, según PENDIENTES §4) no bloquean.
7. `cd frontend && npm run build` (vite build).
8. `git status --porcelain` de nuevo: el build y los tests no deben dejar archivos versionados modificados.

## Riesgos

- **El push dispara dos despliegues, no uno.** Además de Render, `.github/workflows/eas-update.yml` publica un OTA de EAS porque cambió `mobile/**`. Según PENDIENTES §2, hoy ese OTA no llega a ningún build instalado (canal y runtimeVersion no coinciden), así que el efecto real es nulo, pero conviene saberlo. `mobile/vercel.json` cambia, y el preview de Vercel se despliega a mano con `desplegar-web.bat`, no por el push.
- **Cambia el health check del Blueprint.** Si Render no sincroniza `render.yaml` solo, el dashboard puede seguir mostrando `/api/races`. Ese chequeo está en el checklist manual.
- **La migración es aditiva.** Si el deploy falla al arrancar, Render mantiene la versión anterior. Si hace falta volver atrás, la salida es un `git revert` pusheado (nunca force push), y el snapshot del 20/10 cubre la base.
- **La `CT_PUBLISH_KEY` global sigue valiendo** hasta que se rote la fila "Organizador original". Es así por diseño, para que el escritorio no quede sin poder publicar. Lo resuelven los pasos manuales.
- **Push sin force:** `git push origin main`. Si lo rechaza por no ser fast-forward, freno y aviso.

## Verificación

1. `git push origin main`, y después confirmar que `git rev-parse origin/main` = `bb446ee`.
2. Health check: consultar `curl -s https://chronotrack-portal.onrender.com/api/health` en bucle (Monitor, cada ~30 s, hasta ~15 min) hasta recibir exactamente `{"status":"ok"}`. La versión vieja no tiene esa ruta, así que esa respuesta prueba que el deploy nuevo está vivo. Como control, `curl -s -o /dev/null -w "%{http_code}" …/api/races` → 200. Si a los 15 min no responde, lo informo con la última respuesta y no doy el deploy por bueno.
3. Dejar escritos en la respuesta, para que Agustín los haga a mano en el dashboard (DEPLOY.md, Paso 3 y checklist):
   - **Checklist post-deploy:** Live; Settings → Health Check Path = `/api/health`; `CT_PUBLIC_URL` y `CT_SMTP_*` con valor; logs sin `CT_SMTP_HOST no está configurado`, sin el aviso de workers y con un solo `Started server process`; mail de prueba; portal claro y oscuro sin violaciones de CSP.
   - **Clave personal:** (1) publicar o republicar una carrera desde el escritorio con la config actual, lo que crea la fila "Organizador original"; (2) Administración → Claves → esa fila → **Rotar** (no *Crear clave*) y copiar la clave `lr_pub_…`; (3) ☁ Portal en la nube → pegar → Guardar (si la PC tiene la variable `CT_PUBLISH_KEY`, quitarla); (4) republicar y ver *último uso* actualizado.
   - **Desactivar la global:** después de rotar ya no sirve. Además, en Render → Environment se cambia `CT_PUBLISH_KEY` por otro valor aleatorio. No se puede borrar, porque `_startup` en `cloud/main.py` exige que exista.
   - Lo que sigue de PENDIENTES §5: borrar `origin/arreglos-revision`, OTA/APK y el instalador del escritorio. No lo hago en esta tarea.
