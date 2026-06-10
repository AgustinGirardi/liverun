# RESUME — Rediseño del Portal Cloud (ChronoTrack)

> Documento para retomar el trabajo en una próxima sesión de Claude Code.
> Última actualización: 2026-06-09 (sesión del handoff de Claude Design → Opción C + degradado)

## Estado en una línea

**Rediseño "Opción C" + lenguaje de marca degradado mint→teal aplicado al PORTAL y al OPERADOR,
todo commiteado y pusheado a `main`. Portal auto-deployando en Render. Escritorio rebuildeado a
v2.6 (instalador generado).** Único pendiente: **distribuir el instalador v2.6 a los
organizadores**.

- **Rama:** `main` ↔ `origin/main` sincronizadas (sin ramas de feature).
- **HEAD:** `58331e9` (bump v2.6).
- **Portal en producción:** https://chronotrack-portal.onrender.com (auto-deploy de `cloud/**`).
- **Instalador escritorio:** `installer\ChronoTrack_Setup_v2.6.exe` (~21 MB) ya construido.

## Lo que se hizo esta sesión (2026-06-09)

Llegó un **handoff de Claude Design** (claude.ai/design), reverse-engineered de este repo
(`AgustinGirardi/chronotrack`). Se bajó vía WebFetch (gzip → tar), se leyó el README + el chat
transcript: el usuario iteró en la herramienta y **aterrizó en la Opción C** con lenguaje de marca
**degradado sobrio mint→teal**. Se implementó en el código REAL (no se copió el JSX del prototipo):

### Portal — commit `60f0bc2`
- **Inicio → layout split-editorial (Opción C):** columna izquierda con badge "Resultados
  oficiales" + titular *"Encontrá tu tiempo, **seguí tu progreso**"* (degradado en la frase clave)
  + buscador + nota; columna derecha "Carreras recientes" en tarjetas. Se ELIMINÓ el hero
  centrado, las feature cards y la doble fila de botones.
- **Lenguaje degradado mint→teal:** tokens nuevos en `cloud/static/styles.css`
  `--acc-strong`/`--acc-deep`/`--grad` (claro y oscuro), helpers `.grad-text` y `.btn.grad`.
- Botón "Crear cuenta" del header con degradado; acento `.grad-text` en títulos de
  Buscar/Auth/Dashboard; CTA "Crear cuenta y guardar" con `.btn.grad`.
- Cambios SOLO en `cloud/static/{app.js,styles.css}`. **Verificado con screenshots headless en
  tema claro Y oscuro** — ambos fieles al diseño.

### Operador (escritorio) — commit `5d21247`
- Mismo gesto de marca en `frontend/src/App.jsx` (inline styles, hex hardcodeado, sin tokens CSS):
  - Constante `OP_GRAD = "linear-gradient(110deg, #00bf85, #00e5a0)"` + helper `<OpGrad>` para
    acentos de título.
  - `BTN_PRIMARY` ahora usa `OP_GRAD` (texto oscuro) → todas las acciones principales consistentes
    (Nueva carrera, Nuevo atleta, Inscribir, Crear, Publicar, Crear carrera…).
  - Botón **⏱ CAPTURAR LLEGADA** del cronómetro con el degradado.
  - Títulos con acento: "Panel de **Control**", "**Carreras**", "**Atletas**", "**Historial** de
    Carreras".
- **Verificado:** `vite build` OK + screenshot headless del Panel de Control.

### Rebuild escritorio — commit `58331e9`
- `version.txt` 2.5 → 2.6; pasos manuales de `build.bat` (npm build + PyInstaller + Inno Setup
  ISCC) → `installer\ChronoTrack_Setup_v2.6.exe`. Se corrió manual (no el `.bat` directo) porque
  tiene `pause`/`start` interactivos.

## Único pendiente (operativo, NO de código)

**Distribuir `installer\ChronoTrack_Setup_v2.6.exe` a los organizadores** e instalarlo. El push NO
auto-deploya el escritorio: siguen con la v2.5 hasta reinstalar. (Recordá: el operador no es
crítico para que el portal nuevo funcione — el portal ya está en producción.)

## Posibles próximos pasos

- Verificar en producción (incógnito / Ctrl+F5) que la Opción C ya se ve en el portal de Render.
- Distribuir el instalador v2.6.
- Si se quiere: extender el degradado a más pantallas del operador (detalle de carrera, resultados)
  o afinar el contraste del botón con degradado en tema oscuro del portal (texto blanco sobre mint
  claro — aprobado en diseño, pero revisable).

## Cómo verificar visualmente (lo que se usó esta sesión)

- **Portal local:** `python -m uvicorn cloud.main:app --port 8002` desde la raíz; abrir
  http://127.0.0.1:8002 (la `cloud.db` tiene ~6 carreras de prueba; sirve estáticos desde disco).
- **Operador local:** `cd frontend; npm run dev` (Vite). OJO: Vite bindea a `localhost`/IPv6, así
  que `127.0.0.1:5174` da connection-refused — usar `http://localhost:5174` o `http://[::1]:5174`.
  El dashboard renderiza sin backend (stats en 0), suficiente para ver los degradados.
- **Screenshot headless (sin Playwright):** Chrome en
  `C:\Program Files\Google\Chrome\Application\chrome.exe` con
  `--headless=new --disable-gpu --user-data-dir=<tmp> --virtual-time-budget=7000 --screenshot=<out.png> <url>`.
  Para tema oscuro del portal: dejar un HTML temporal en `cloud/static/` que haga
  `localStorage.setItem("ct_theme","dark"); location.replace("/")` y apuntar Chrome ahí (mismo
  origen). Borrarlo después.

## Arquitectura imprescindible (referencia)

- **Escritorio** (`backend/` FastAPI async + `frontend/` React/Vite) empaquetado como `.exe` con
  `build.bat` (bumpea `version.txt`, compila frontend, PyInstaller, Inno Setup → `installer\`).
  Requiere Inno Setup 6 (`%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe`), node_modules y
  PyInstaller. El `.bat` termina con `pause` → para no colgar la sesión, correr los pasos a mano:
  bump `version.txt`, `npm run build` en `frontend/`, `python -m PyInstaller ChronoTrack.spec
  --clean --noconfirm`, `ISCC /DAppVersion=<v> ChronoTrack_Setup.iss`.
- **Portal cloud** (`cloud/` FastAPI sync + SQLite) + SPA estática en 3 archivos:
  `cloud/static/index.html` (shell + script FOUC inline en `<head>`), `cloud/static/styles.css`,
  `cloud/static/app.js` (router por estado `go(view,arg)`; init al final). Sin build step. Deploya
  en Render al pushear `cloud/**`.
- **Hash de email (privacy-preserving):**
  `sha256(("chronotrack-v1:" + email.strip().lower()).encode()).hexdigest()`. Duplicado en
  `backend/api/routes.py::_email_hash` y `cloud/main.py::_email_hash` (mantener sincronizados).

## Paleta y tokens

**Portal** (`cloud/static/styles.css`): tema claro (`:root`) / oscuro (`[data-theme="dark"]`),
toggle ◐/◑ persiste en `localStorage` key `ct_theme`.
- `--bg` #F5F7F8 / #14171A · `--panel` #FFFFFF / #1E2329 · `--txt` #28323A / #E4E8EA
- `--acc` (menta) #54BFA3 / #6FD3B8 · `--blue` #7099DE / #84ABEC
- **NUEVO degradado:** `--acc-strong` #00BF85 / #54BFA3 · `--acc-deep` #00795C / #6FD3B8 ·
  `--grad` = `linear-gradient(110deg,var(--acc-strong),var(--acc-deep))`. Helpers `.grad-text`
  (acento de texto) y `.btn.grad` (acción con degradado, texto blanco).

**Operador** (`frontend/src/App.jsx`, inline): hex `#00e5a0` (neón) por todos lados; degradado
nuevo `OP_GRAD = linear-gradient(110deg, #00bf85, #00e5a0)` + helper `<OpGrad>`; `BTN_PRIMARY`
usa el degradado con texto `#000`.

## Documentos de referencia

- **Diseño (handoff):** se bajó el bundle de Claude Design a `/tmp` durante la sesión (no quedó en
  el repo). El README del bundle apunta a recrear `ui_kits/portal/index.html`.
- **Spec original:** `docs/superpowers/specs/2026-06-07-portal-redesign-design.md`
- **Plan original:** `docs/superpowers/plans/2026-06-07-portal-redesign.md`
- Memoria: `portal-redesign-progreso.md`, `proyecto-chronotrack.md`, `multiline-commit-messages.md`.
