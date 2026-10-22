# Pendientes

Lo que quedó abierto después de rescatar `backup/hardening-local-7-commits` sobre `main` (rama `rescate/movil-a11y`, 19 de octubre de 2026). Los commits rescatados están en el historial; el plan, en `docs/plans/2026-10-19-rescatar-backup-hardening-local-7-commits-sobre-ma.md`.

**Nada de lo rescatado corrió en un dispositivo.** Está verificado con `tsc`, `eslint`, `jest`, `pytest`, `vite build` y `expo export --platform web`.

## 1. Bloqueante: verificación en dispositivo

- [ ] **Toque del FAB en Android.** Se reestructuró `mobile/src/components/app-tabs.tsx` para que los 62 pt del botón queden dentro del padre. Probar que toda la superficie responde y que la franja sobre la barra (`pointerEvents="box-none"`) no se traga toques.
- [ ] **Predictive Back en Android 13+.** Se quitó `predictiveBackGestureEnabled: false` de `mobile/app.json`. Confirmar que el gesto de volver convive con la tab bar propia.
- [ ] **Tema claro completo, mirándolo.** Los contrastes están testeados, pero la armonía del conjunto se juzga con los ojos. Las 5 pantallas.
- [ ] **Texto al 200 %.** `line()` escala el alto de línea; verificar que los números grandes del cronómetro no se recortan.
- [ ] **Tarjeta para compartir** con el texto del sistema en grande.
- [ ] **Sugerencias de corredor en el escritorio** (`InscriptosView`): Tab, Enter y foco visible.

## 2. Despliegue

- [ ] **La OTA de EAS no llega a los builds instalados** (diagnosticado el 19/10 con `eas-cli`). Dos causas: (1) el único canal es `preview` y apunta al branch `preview`, vacío, mientras `eas-update.yml` publica en el branch `main`; (2) los builds instalados tienen `runtimeVersion` `exposdk:54.0.0` (política vieja `sdkVersion`) y los updates de `main` salen con un fingerprint (`993246…`). Para que llegue: `eas channel:edit preview --branch main` **y** un build nuevo (`eas build -p android --profile preview`) con la política `fingerprint` actual. Sin ambos, los updates se publican pero ningún dispositivo los toma.
- [ ] **Preview web en Vercel** (`mobile/desplegar-web.bat`, dominio `liverun-ochre.vercel.app`). Todo el tráfico llega al backend desde IPs de Vercel, y `cloud/deps.py` llavea el rate limit por IP: los usuarios del preview comparten un balde. Alcanza para revisión personal. El login con Google desde ese dominio no está verificado.

## 3. Decisiones abiertas

- [ ] **Tipografía móvil.** Barlow Condensed (commit original `16c31b4`) quedó afuera por la marca compartida. Si se quiere, está en el tag `archivo/backup-hardening-local` (la rama se borró): tres `.ttf` más `OFL.txt` y un `useFonts` en `_layout.tsx`.
- [ ] **Emoji expresivos en la app móvil** (🏃 🔥 🎁 🎯 ⭐ y las medallas): quedan a propósito, pero es decisión de producto.
- [ ] **`@expo/ngrok`** (devDependency del commit `7f63c2b`): no se rescató porque nada lo usa. Si se vuelve a necesitar `expo start --tunnel`, se reinstala.

## 4. Menor

- [x] ~~**Avisos de lint preexistentes:** 28 en móvil y 2 en el escritorio.~~ Cerrados el 21/10: ambos lints corren con `--max-warnings 0` y las reglas `react-hooks/refs` y `set-state-in-effect` volvieron a error en `mobile/eslint.config.js`.
- [ ] **Portal:** listas largas de resultados sin virtualizar. Medir antes de tocar.
- [ ] **Móvil:** `index.tsx` y `perfil.tsx` usan `ScrollView` + `.map()` sin virtualizar; revisar si crecen.

## 5. Cierre del 20/10 (plan `docs/plans/2026-10-20-cerrar-los-pendientes-abiertos-de-liverun-20-10.md`)

Hecho en código: el escritorio avisa si `CT_PUBLISH_KEY` de la PC pisa la clave guardada (`key_from_env`); el portal avisa al arrancar si hay más de un worker con el rate limit en memoria (`aviso_multiworker`); documentados el paso a paso de la clave personal y la rotación de la global (DEPLOY.md, Paso 3), el checklist post-deploy de Render y la OTA de EAS (`mobile/README.md`).

**No se pusheó.** El push despliega el portal en Render y hay una tabla nueva (`publish_keys`): falta el snapshot. `main` está 14 commits adelante de `origin/main`.

Orden para Agustín:

- [ ] **1. Snapshot del disco de Render** (Disks → Create snapshot) y recién ahí `git push origin main`.
- [ ] **2. Checklist post-deploy** de DEPLOY.md: Live, health check, `CT_PUBLIC_URL`, `CT_SMTP_*`, logs sin avisos, mail de prueba, portal en el navegador sin violaciones de CSP.
- [ ] **3. Clave personal:** publicar con la global (crea la fila "Organizador original") → **Rotar** esa fila → pegar la clave en ☁ Portal en la nube → republicar para comprobar. Opcional: cambiar el valor de `CT_PUBLISH_KEY` en Render.
- [ ] **4. OTA:** `eas channel:edit preview --branch main` y `eas build -p android --profile preview`; instalar el APK. Con ese APK hacer la verificación en dispositivo de la sección 1.
- [ ] **5. Regenerar el instalador del escritorio** (`build.bat`) para que la app instalada muestre el aviso de `CT_PUBLISH_KEY`. No bloquea: sin él la app ya permite pegar la clave.
- [ ] **Borrar `origin/arreglos-revision`** (ya está en `main`) tras el push.
- [ ] **Tags de archivo** `archivo/backup-hardening-local` y `archivo/web-pulido-movil`: existen solo en local. Decidir si se pushean (el repo es público).
- [ ] **Rate limit con más de un worker:** escribir el backend Redis en `cloud/deps.py` (`_BACKENDS`) recién al escalar; el aviso del log avisa si se olvida.

## 6. Auditoría del 21/10 (plan `docs/plans/2026-10-21-aplicar-las-mejoras-de-la-auditoria-2026-10-21-liv.md`)

Hecho en código: CI (`.github/workflows/ci.yml`), `npm audit fix` en el escritorio (0 vulnerabilidades), locks de Python y `requirements-dev.txt`, test de contrato del `email_hash`, `cloud/main.py` partido en routers, `App.jsx` partido en `views/` y `components/` con Vitest, `ruff`, restos de la plantilla de Expo fuera, lint en cero y documentación ordenada en `docs/`.

**Nada de esto se pusheó.** Para el push siguen valiendo los pasos de la sección 5 (snapshot del disco de Render primero).

- [ ] **Primera corrida de la CI en GitHub.** Todo lo que corre la CI se verificó a mano en local, pero el workflow nunca corrió en Actions. Mirar la primera corrida después del push y, si anda, activar la protección de `main` (Settings → Branches → exigir los tres jobs).
- [ ] **Que Render espere a la CI.** `render.yaml` sigue con `autoDeploy: true`: un push a `main` despliega aunque la CI esté en rojo. Verificar en la doc de Blueprint de Render si existe `autoDeployTrigger: checksPass` y, si existe, usarlo en lugar de `autoDeploy`. No se pudo verificar (falló la consulta a la doc).
- [ ] **Verificación manual del cronómetro del escritorio.** `App.jsx` se partió en 30 archivos con movimiento literal, y build, lint y los 36 tests de Vitest pasan, pero no hay e2e. Antes de usarlo en una carrera: `python launcher.py`, largar, capturar, asignar dorsal, deshacer, descartar, cortar el backend unos segundos para ver el contador "sin guardar", e imprimir un certificado.
- [ ] **Verificación en dispositivo de lo que tocó el lint del móvil** (se suma a la sección 1): `FadeIn` y `Ring` (el valor animado ahora vive en `useState`), el reseteo del podio al cambiar alcance o período en `ranking.tsx`, y el splash.
- [ ] **Migrar Expo 54 → 58.** Plan en `docs/plans/2026-10-21-migrar-expo-54-a-58.md`. Para bajar las 71 vulnerabilidades de `mobile`; bloquea una decisión sobre Expo Go en iOS.
- [ ] **`eas-update.yml` en Node 20.** La CI ya usa Node 22. Subirlo, y pensar si la OTA debería esperar a la CI (hoy un push con `mobile/` en rojo igual publica).
- [ ] **`backend/api/routes.py`** (1278 líneas, 52 funciones) quedó afuera: mismo tratamiento que `cloud/main.py`, en su propio plan.
- [ ] **Formateo de `ruff`.** Entró junto con el resto en un solo commit: `git blame` marca ese commit en las líneas que solo cambiaron de formato. Si molesta, rehacerlo como commit aparte y listarlo en `.git-blame-ignore-revs`.


## 7. Push del 21/10 y migración del portal a Cloud Run (plan `docs/plans/2026-10-21-push-pendiente-de-main-plan-de-migracion-del-porta.md`)

**Pusheado:** `main` quedó en `1e9a6a3` (el esquema de la base no cambió, así que no hizo falta snapshot). Render quedó sano (`/api/health` → `{"status":"ok"}`, `/api/races` → 200) y la primera corrida de la CI en GitHub pasó en verde. Con esto se cierra el pendiente "primera corrida de la CI" de la sección 6.

**Hecho en código (sin desplegar):** el portal reconoce producción con `CT_PRODUCCION=1` (y `RENDER`, por compatibilidad); `CT_AVATAR_DIR` para los avatares; migraciones y ranking portables a Postgres; `scripts/migrar_portal_a_postgres.py` con verificación por conteo y hash; `Dockerfile`, `.dockerignore`; en la CI, el job `python-postgres` (suite completa contra Postgres 16) y el job `deploy-portal` (se saltea mientras no esté `GCP_PROJECT_ID`); `DEPLOY.md` reescrito para Cloud Run, con Render como apéndice.

**Todavía no se tocó nada en Google Cloud, Neon ni Render.** Nada de la migración fue probado contra un proyecto real: no hay Docker en esta máquina (la imagen no se construyó) y los flags de `gcloud` (volumen de Cloud Storage, probes, `domain-mappings`) se escribieron sin probarlos. Para Agustín, en orden:

- [ ] **1. Crear el proyecto de Google Cloud y hacer el Paso 1 de DEPLOY.md** (APIs, Artifact Registry, bucket, cuentas de servicio, Workload Identity). Cargar las variables del repo en GitHub: recién con `GCP_PROJECT_ID` el job de deploy deja de saltearse.
- [ ] **2. Crear la base en Neon** (us-east-1) y un branch de ensayo; cargar los secretos en Secret Manager con **los mismos valores que hoy tiene Render** (Paso 3).
- [ ] **3. Construir la imagen y probarla** (`docker build` + `curl /api/health`, Paso 4). Es lo primero que puede fallar.
- [ ] **4. Ensayar la migración de datos:** copia de la base de Render → `migrar_portal_a_postgres.py` contra el branch de Neon → recorrer el portal en la URL `*.run.app`. Anotar cold starts y confirmar que la IP del cliente llega bien (`X-Forwarded-For`).
- [ ] **5. Elegir y comprar el dominio** (`liverun.com.ar`, ver el Paso 5 del apéndice) antes del corte: sin dominio propio, los links compartidos mueren con `onrender.com`.
- [ ] **6. Cortar** (Paso 7 de DEPLOY.md): ventana sin carreras, Render suspendido, migración final, DNS, Google OAuth, webhook de Mercado Pago y la URL en cada escritorio (el escritorio no sigue redirecciones de un POST).
- [ ] **7. Commit aparte con las URLs nuevas** en `backend/core/account.py` (`DEFAULT_PORTAL`), `mobile/src/lib/api.ts`, `mobile/src/app/ranking.tsx` y `mobile/vercel.json`.
- [ ] **8. Baja de Render** tras 2 a 4 semanas sin incidentes; borrar `render.yaml` y el apéndice de DEPLOY.md.
- [ ] **Decidir `min-instances`** con la latencia medida en el paso 4 (0 = ~US$0–3/mes; 1 = ~US$10/mes más).
- [ ] **Backup fuera del proveedor.** Hoy solo están el PITR de Neon y el versionado del bucket (mismo proveedor de cuentas). Se descartó usar una PC propia; queda el `pg_dump` manual antes de cada cambio de esquema.
- [ ] **Rate limit:** con `max-instances=1` alcanza la memoria. Si algún día hace falta escalar, registrar un backend compartido en `cloud/deps.py` (`_BACKENDS`).
- [ ] **Nombre de las variables de Render** (`RENDER`, `render.yaml`): siguen funcionando; quitar la compatibilidad con `RENDER` en `en_produccion()` junto con la baja.
