# ChronoTrack — Brief de implementación (handoff para Claude Code)

Rediseño UX/UI completo, **Dirección A "Pista nocturna"**. Dark-first, acento
mint. Tres superficies con roles distintos pero misma marca y mismos datos.
Los prototipos HTML de este proyecto son la **fuente visual de verdad**:
`movil.html`, `web.html`, `escritorio.html`, `index.html` (hub).

Repo objetivo: `frontend/` (React + Vite, web), `mobile/` (Expo/React Native),
escritorio (app de cronometraje), `backend/` (API + `cloud/`).

---

## 1. Design tokens (de `brand-spec.md`, ya en el código)

```
--bg:#0d0f10  --surface:#141618  --surface-2:#1c1f21  --line:#262b2e
--fg:#e8eaeb  --muted:#8a9299
--accent:#00e5a0  --accent-2:#00bf85  --on-accent:#06281d
--blue:#4d9fff  --gold:#f5a623  --danger:#ff4d4d
gradiente marca: linear-gradient(135deg,#00bf85,#00e5a0)
```

- Display/rounded: `ui-rounded, "SF Pro Rounded", system-ui` (pesos 800).
- Body: `-apple-system, "SF Pro Text", system-ui`.
- Numerales (tiempo/distancia/ritmo): `tabular-nums`, peso 800.
- Radios: tarjeta 16px, hero 20px, botón primario pill. Bordes hairline 1px.
- Acento mint con disciplina: hero gradiente + 1 CTA/dato clave por pantalla.
- En `mobile/src/constants/theme.ts` ya existen `BrandAccent` y `BrandGradient`
  — reusarlos, no hardcodear.

---

## 2. Móvil (Expo) — SOLO para correr · ref. Adidas Runtastic
Archivos: `mobile/src/app/index.tsx` (Inicio), `correr.tsx`, `historial.tsx`,
`perfil.tsx`. Tab bar: Inicio · Correr · Historial · Perfil.
Prototipo: `movil.html`.

- **Inicio**: hero mint con racha ("¿Salimos a correr hoy?"), tarjeta "Esta
  semana" (X de N días + dots + km), mini-tarjetas Racha/Mes, última salida.
- **Correr** (pantalla central): estados `idle → running → paused → done`.
  - Mapa GPS con ruta dibujándose, badge "GPS · señal fuerte".
  - Cronómetro grande tabular, fila ritmo/distancia/splits.
  - Botones: Iniciar (gradiente) → Pausar/Reanudar + Terminar.
  - El tiempo neto no suma en pausa. Avisos de voz por km = premium.
  - Al terminar: resumen y `saveActivity()` (ya existe) + sync a la web.
- **Historial/Perfil**: lista de salidas; perfil con total km, salidas, mejor 5K.
- Hit targets ≥ 44px. Mantener frame nativo + tab bar inferior.

---

## 3. Web (React + Vite) — informativa: perfil, stats, certificados
Prototipo: `web.html`. Responsive 360→1920. Nav superior frosted:
Mi perfil · Mis carreras · Eventos · Ranking.

- **Perfil hero**: avatar, nombre, metadatos (ciudad, dorsal habitual), badge
  de racha, CTAs (ver carreras / último certificado).
- **Franja de stats**: distancia total, carreras oficiales, salidas, mejor 10K.
- **Tabs**: Resumen (gráfico km/mes + récords) · Mis carreras (tabla con
  filtros 5K/10K/21K) · Récords personales.
- **Certificado** (clave): modal por carrera con evento, corredor, distancia,
  tiempo oficial, ritmo, puesto, sello "verificado". Botón **Imprimir / Guardar
  PDF** → `window.print()` con `@media print` que aísla `#cert` sobre fondo
  blanco. Datos desde la API (`cloud/`), no hardcode.
- Reemplaza el `App.jsx` actual (que "no cierra") por esta IA.

---

## 4. Escritorio — consola de cronometraje (toma tiempos y sube a la web)
Prototipo: `escritorio.html`. Chrome de app de escritorio (title bar).

- **Reloj maestro** con centésimas (`requestAnimationFrame`).
- Botón **Dar largada / Detener**; selector de carrera activa con metadatos.
- **Capturar llegada por dorsal**: input + Enter → toma el tiempo exacto,
  resuelve nombre desde el roster, agrega fila y ordena por tiempo (puesto +
  ritmo según distancia).
- Tabla en vivo (puesto/dorsal/corredor/tiempo/ritmo), medallas top-3.
- **Subir resultados a la web** → POST a la API; pasan a ser certificados.

---

## 5. Conexión del ecosistema
Escritorio cronometra carrera → resultados suben a la API → Web los muestra como
perfil + certificado → Móvil suma tus entrenamientos a stats/racha.
Backend: extender `backend/` + `cloud/` para `races`, `results`, `certificates`.

---

## 6. Criterios de aceptación
- [ ] Tokens centralizados (web `:root` / mobile `theme.ts`), sin hex sueltos.
- [ ] Móvil: flujo correr completo (idle→running→paused→done) con cronómetro real.
- [ ] Web responsive sin scroll horizontal en 360/390/768/1024/1440/1920.
- [ ] Certificado imprime a PDF de 1 página, fondo blanco, datos reales.
- [ ] Escritorio: reloj con centésimas + captura por dorsal + orden por tiempo.
- [ ] Sin tropos AI: nada de índigo ni gradientes morados; mint de marca.
- [ ] Microcopy en español rioplatense, igual que los prototipos.

> Para Claude Code: abrí los .html de este proyecto como referencia visual y
> portá el diseño al stack real. No copies el HTML literal: reimplementá en
> React/RN con componentes y tokens.
