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

- [ ] **Push a `main` y OTA de EAS.** Cambia `mobile/**`, así que `eas-update.yml` publica una OTA. Con `runtimeVersion` por `fingerprint`, las dependencias nuevas y `app.json` cambian el fingerprint: la OTA no llega a los builds instalados y hace falta un build nuevo.
- [ ] **Preview web en Vercel** (`mobile/desplegar-web.bat`, dominio `liverun-ochre.vercel.app`). Todo el tráfico llega al backend desde IPs de Vercel, y `cloud/deps.py` llavea el rate limit por IP: los usuarios del preview comparten un balde. Alcanza para revisión personal. El login con Google desde ese dominio no está verificado.

## 3. Decisiones abiertas

- [ ] **Tipografía móvil.** Barlow Condensed (commit original `16c31b4`) quedó afuera por la marca compartida. Si se quiere, está en la rama backup: tres `.ttf` más `OFL.txt` y un `useFonts` en `_layout.tsx`.
- [ ] **Emoji expresivos en la app móvil** (🏃 🔥 🎁 🎯 ⭐ y las medallas): quedan a propósito, pero es decisión de producto.
- [ ] **`@expo/ngrok`** (devDependency del commit `7f63c2b`): no se rescató porque nada lo usa. Si se vuelve a necesitar `expo start --tunnel`, se reinstala.

## 4. Menor

- [ ] **Avisos de lint preexistentes:** 28 en móvil y 2 en el escritorio, casi todos `set-state-in-effect`.
- [ ] **Portal:** listas largas de resultados sin virtualizar. Medir antes de tocar.
- [ ] **Móvil:** `index.tsx` y `perfil.tsx` usan `ScrollView` + `.map()` sin virtualizar; revisar si crecen.
