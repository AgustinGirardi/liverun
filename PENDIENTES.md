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

- [ ] **Avisos de lint preexistentes:** 28 en móvil y 2 en el escritorio, casi todos `set-state-in-effect`.
- [ ] **Portal:** listas largas de resultados sin virtualizar. Medir antes de tocar.
- [ ] **Móvil:** `index.tsx` y `perfil.tsx` usan `ScrollView` + `.map()` sin virtualizar; revisar si crecen.

## 5. Cierre del 19/10 (plan `docs/plans/2026-10-19-cerrar-los-pendientes-abiertos-de-liverun-19-10-20.md`)

Hecho: `rescate/movil-a11y` mergeada a `main`; ramas viejas borradas (tags `archivo/backup-hardening-local` y `archivo/web-pulido-movil` conservan lo que no estaba en `main`); `/api/health` para el health check de Render; CSP sin `unsafe-inline` también en estilos; rate limit con backend intercambiable; API key de publicación por organizador con rotación y revocación.

- [ ] **Snapshot del disco de Render antes del push** (hay una tabla nueva, `publish_keys`, que `create_all` crea al arrancar).
- [ ] **Panel de Render, a mano:** `CT_SMTP_HOST/PORT/USER/PASSWORD/FROM` y `CT_PUBLIC_URL` cargadas; sin el warning "CT_SMTP_HOST no está configurado" en los logs de arranque; el deploy llega a "Live" con el health check nuevo.
- [ ] **Ver el portal en un navegador** (temas claro y oscuro; inicio, buscar, calendario, progreso, cuenta, admin → Claves) con la consola sin violaciones de CSP: los 42 `style=""` pasaron a clases y `data-*`, y los tests no miran el layout.
- [ ] **Repartir las claves:** emitir una por organizador en Administración → Claves, pegarla en su escritorio y recién ahí rotar o revocar la original (`CT_PUBLISH_KEY`).
- [ ] **Rate limit con más de un worker:** registrar un backend Redis en `cloud/deps.py` (`_BACKENDS`) antes de escalar. No hay uno escrito.
- [ ] **Borrar `origin/arreglos-revision`** (ya está en `main`) cuando se pushee.
