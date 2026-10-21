# Plan: aplicar las mejoras de la auditoría 2026-10-21 (LiveRun)

## Contexto

La auditoría (`docs/audits/2026-10-21.md`) encontró que nada verifica el código antes de que llegue a `main`, y un push a `main` despliega el portal en Render. Además encontró dependencias sin fijar o vulnerables, tres archivos gigantes, un hash duplicado sin test que lo ate, 30 avisos de lint y documentación desordenada en la raíz.

Estado medido hoy (solo lectura):
- `pytest cloud/tests backend/tests`: **330 passed**. `mobile`: jest **73 passed** en 9 suites y `tsc --noEmit` limpio.
- Lint: **28 avisos en `mobile`**: 26 de `react-hooks/refs` (15 en `ranking.tsx`, 7 en `fade-in.tsx` y 4 en `ring.tsx`, todos por `useRef(new Animated.Value()).current`) y 2 de `set-state-in-effect` (en `ranking.tsx` y `use-color-scheme.web.ts`). Además hay **2 en `frontend`** (`exhaustive-deps` de `load` en `AthletesPage`, `App.jsx:2898` y `:2903`). `mobile/eslint.config.js` baja esas dos reglas a `warn` a propósito.
- `frontend` tiene 8 vulnerabilidades (vite 8.0.12, postcss y source-map-js), y todas se arreglan con `npm audit fix`.
- Hay `uv 0.11.26` en la máquina. No hay `ruff`, `pip-audit` ni `pyproject.toml`.
- `main` está 14 commits adelante de `origin/main`, y el push espera el snapshot del disco de Render (`PENDIENTES.md` §5). **Este plan no pushea.** Todo queda en commits locales, chicos y con el porqué en el mensaje.

Orden de trabajo: primero la red de seguridad (CI y tests de contrato), después los refactors. Cada mejora suma su chequeo a `ci.yml` en el mismo commit, así la CI nunca pide algo que todavía no pasa.

## Cambios

### 1. CI de verificación: `.github/workflows/ci.yml` (nuevo)
- Corre en `push` (todas las ramas) y en `pull_request`, con `permissions: contents: read` y `concurrency` por ref con `cancel-in-progress`.
- Tiene tres jobs en paralelo sobre `ubuntu-latest`:
  - **python**: `setup-python` 3.12, igual que `PYTHON_VERSION` en `render.yaml`, con cache de pip. Instala los locks y `requirements-dev.txt` y corre `pytest cloud/tests backend/tests -q`. Después se suman `ruff check`, `ruff format --check` y `pip-audit` (secciones 3 y 8).
  - **mobile**: `working-directory: mobile`. Corre `npm ci`, `npm test`, `npm run lint` y `npx tsc --noEmit`.
  - **frontend**: `working-directory: frontend`. Corre `npm ci`, `npm run lint`, `npm test` (sección 7) y `npm run build`. El build lee `../version.txt`, que viene en el checkout.
- Node 22 LTS: Node 20 ya está fuera de soporte, y vite 8 y eslint 10 piden ≥20.19 o 22.12. El README pasa a decir "Node 22+". No toco `eas-update.yml`, que sigue en Node 20, y lo anoto como pendiente.
- **Que el rojo frene el deploy:** la CI sola no impide el push. En `render.yaml` reemplazo `autoDeploy: true` por `autoDeployTrigger: checksPass`, para que Render despliegue solo con los checks de GitHub en verde. Antes de commitearlo verifico en la doc de Blueprint que el campo exista con ese nombre. Proteger `main` con branch protection es opcional, y lo documento como paso manual en GitHub.

### 2. `npm audit fix` en `frontend/`
- Se corre `npm audit fix` sin `--force`. Cambia solo `package-lock.json` (y `package.json` si sube algún piso).
- Antes de commitear verifico `npm audit` (0 vulnerabilidades), `npm run build` y `npm run lint`.

### 3. Fijar las versiones de Python
- Los `.txt` actuales pasan a ser la entrada que se edita a mano (pisos `>=`), y el `.lock` es la salida generada:
  - `cloud/requirements.txt` pierde `pytest` y `httpx`. `cloud/requirements.lock` se genera con `uv pip compile cloud/requirements.txt --universal --python-version 3.12 -o cloud/requirements.lock`.
  - `requirements.lock` (escritorio) sale de `requirements.txt` **con `-c cloud/requirements.lock`**. Así fastapi, starlette, pydantic, sqlalchemy y uvicorn quedan en la misma versión en los dos locks, y la CI puede instalarlos juntos sin conflicto. Con `--universal`, `pywebview` conserva sus markers de Windows.
  - `requirements-dev.txt` (nuevo) fija exacto `pytest`, `httpx` y `ruff`.
- `render.yaml`: el `buildCommand` pasa a `pip install -r cloud/requirements.lock`. El lock vive en `cloud/`, así que cae dentro del `buildFilters` actual.
- `pip-audit` entra a la CI como `pipx run pip-audit==<versión> -r <lock>`, una corrida por lock. No va a `requirements-dev.txt` porque no hace falta para desarrollar. Si encuentra algo en los pins actuales, se sube el pin en ese mismo commit.
- `README.md` y `DEPLOY.md` (líneas 49 y 247) pasan a apuntar al lock y explican cómo regenerarlo.

### 4. `_email_hash`: test de contrato, no módulo compartido
**Recomendación: no unificarlo en un módulo compartido.** Hay tres motivos:
- El escritorio se empaqueta con PyInstaller y solo incluye `backend/` (`LiveRun.spec`). Importar `cloud` lo acoplaría al portal.
- Un módulo nuevo en la raíz obligaría a tocar los `buildFilters` de Render.
- Las dos copias difieren a propósito con el email vacío: el escritorio devuelve `None` y el portal hashea `""`.

Lo que hago:
- La versión del portal sale de `cloud/main.py` a `cloud/security.py` como `email_hash`. `security.py` ya es stdlib pura y no tiene efectos al importarse. `_autolink` la importa de ahí.
- Test nuevo: `backend/tests/test_email_hash_contrato.py` (ver Tests).
- El docstring de las dos funciones apunta al test en vez de decir "si cambia uno, cambiar el otro".

### 5. Expo 54 → 58: solo el plan, más el arreglo de `@types/jest`
- `mobile/package.json` saca `@types/jest` de `dependencies`; queda en `devDependencies`. Después se corre `npm install` para regenerar el lock.
- Escribo el plan aparte en `docs/plans/2026-10-2x-migrar-expo-54-a-58.md`, sin ejecutarlo. Va a cubrir:
  - subir un SDK por vez (55 → 56 → 57 → 58) con `npx expo install expo@^N --fix` y la suite verde en cada salto;
  - revisar NativeTabs, reanimated/worklets y `react-native-maps`;
  - el `runtimeVersion` con `fingerprint`: hace falta un build nuevo, porque los instalados no van a tomar la OTA;
  - un checklist de prueba en dispositivo;
  - **una decisión que hay que tomar primero**: `mobile/AGENTS.md` dice que se bajó a SDK 54 porque Expo Go en iOS solo soporta 54 y Agustín prueba en iPhone. Hay que pasar a development builds o confirmar que Expo Go ya soporta 58.

### 6. Partir `cloud/main.py` (1363 líneas) en routers por dominio
Sigo el patrón de `run.py` y `billing_routes.py`: `router = APIRouter(...)` e imports desde `cloud.db` y `cloud.deps`. Los módulos nuevos son:

| Módulo | Contenido |
|---|---|
| `cloud/nombres.py` | `normalizar_nombre`, `_name_tokens`, `_name_matches`, `_last_name_matches` (los usan publish, claims y search) |
| `cloud/publish.py` | `PUBLISH_API_KEY`, `PublishResult`, `PublishPayload`, `EventPayload`, `_gen_code`, `_rank_categories`, `_check_publish_key`, `_check_race_owner`, `POST /api/publish`, `POST /api/events` y `DELETE /api/publish/{source_id}` |
| `cloud/auth.py` | Los schemas de auth, `_DUMMY_HASH`, verificación de mail, reset de contraseña y los 8 endpoints de `/api/auth/*` |
| `cloud/claims.py` | `ClaimIn`, `ClaimResultIn`, `_autolink`, `_participation`, `/api/claim`, `/api/me/results`, `/api/me/claim` y `/api/me/autolink` |
| `cloud/search.py` | `_result_dict`, `_event_dict`, `SEARCH_LIMIT`, `_like_escapado`, `GET /api/events`, `/api/races`, `/api/races/{code}` y `/api/search` |
| `cloud/migraciones.py` | Los `_ensure_*` y `_migrar_avatares_a_relativo` |

- `cloud/main.py` se queda con la app, CORS, CSP y cache, `/api/health`, `_lifespan`, `_startup` (llama a `migraciones`), los `include_router` y los mounts.
- Los routers se incluyen **en el mismo orden relativo** que hoy, y los mounts siguen al final.
- `PUBLIC_URL` lo usan CORS y los links de mail, así que pasa a `cloud/deps.py`, que ya concentra lo compartido.
- Se borra la re-exportación de `_RATE` y `_LAST_SWEEP` (`main.py:41-45`). Los tests pasan a importar de `cloud.deps`, `cloud.migraciones`, `cloud.search` y `cloud.nombres`. No dejo re-exports "por si acaso".
- `scripts/simulate_6m.py:535` menciona `cloud.main._autolink` en un docstring y se actualiza.

### 7. Partir `frontend/src/App.jsx` (3883 líneas) y configurar Vitest
- **Primero Vitest:** sumo `vitest` como devDependency. Se justifica porque reusa `vite.config.js`, incluido el `define` de `__APP_VERSION__`, y es la única dependencia nueva. Sin jsdom ni testing-library: lo que se testea es lógica pura, con `fetch` y timers simulados por `vi`. El script es `"test": "vitest run"`.
- **Después la extracción, en commits separados y cada uno con build, lint y tests en verde:**
  1. `src/lib/tiempo.js`: `pad`, `formatNs`, `horaDeCaptura`, `formatTiempo`, `horaANs`, `formatPace` y un `formatCronometro(ms)` nuevo, extraído del cálculo inline de `RaceClock` (`App.jsx:1400`).
  2. `src/lib/capturas.js`: la cola offline de capturas (`App.jsx:632-681`): `porSecuencia`, `encolarCaptura`, `guardarCapturasPendientes`, `contarSinGuardar`, los oyentes y el `beforeunload`.
  3. `src/lib/standings.js`: el agrupado y orden por distancia que hoy vive adentro de `Standings`.
  4. Los demás helpers: `src/lib/api.js` (`API`, `getWsBase`), `src/lib/impresion.js` (certificado, reporte y `escapeHtml`), `src/lib/categorias.js` (`calcAge`, `autoCategory`), `src/lib/ui-store.js` (`ask`, `notify`, `useUiStore`) y `src/theme.js` (`C`, `INPUT`, `BTN_*`, `CARD`, fuentes y radios).
  5. `src/hooks/useTimingEngine.js` y `useEscape.js`.
  6. `src/components/`: `Icon`, los badges, `PublishedChip`, `RaceClock`, `WallClock`, `Standings`, `RaceResultCard`, `DialogHost` y `NoticeHost`. Los controles de configuración van en `src/components/ajustes/`.
  7. `src/views/`: `InscriptosView`, `TimingPage`, `ResultsDetail`, `InscripcionPanel`, `RaceDetailPage`, `DashboardPage`, `RacesPage`, `AthletesPage` y `HistorialPage`. `App.jsx` queda solo con `App`.
- Los componentes y los helpers van en archivos separados, porque `react-refresh/only-export-components` avisa si se mezclan.
- El movimiento es literal: no cambia la lógica, salvo la extracción de `formatCronometro` y del agrupado de `Standings`.

### 8. Ruff
- `pyproject.toml` (nuevo) define `[tool.ruff]` con `target-version = "py312"`, `line-length = 120` (el código ya usa líneas largas, y así el formateo cambia menos) y `extend-exclude` para `.venv`, `build`, `dist`, `frontend` y `mobile`. Las reglas son las de ruff por defecto (`E4`, `E7`, `E9`, `F`). Sumar más es otro plan.
- Lo hago **después** de partir `main.py`, para que ese diff sea un movimiento puro:
  1. Un commit con `ruff check --fix` y los arreglos a mano de lo que quede.
  2. Otro commit, solo con `ruff format`, cuyo hash va a `.git-blame-ignore-revs` (nuevo). Ese mismo commit suma los dos chequeos a la CI.

### 9. Restos de la plantilla de Expo
- Se borran `mobile/scripts/reset-project.js` y el script `reset-project` de `package.json`.
- También se borran `react-logo.png`, `react-logo@2x.png`, `react-logo@3x.png`, `expo-badge.png`, `expo-badge-white.png` y `tutorial-web.png`, que no tienen ninguna referencia en `src/` ni en `app.json`.
- **`expo-logo.png` sí se usa**, contra lo que dice la auditoría, pero solo desde `AnimatedIcon` (`animated-icon.tsx:89` y `animated-icon.web.tsx`), un export que nadie importa: `_layout.tsx` usa solo `AnimatedSplashOverlay`. Borro `AnimatedIcon`, sus estilos y la imagen.
- `assets/expo.icon/Assets` está vacío. Lo borro si git no lo trackea.
- `mobile/LICENSE` no está en el pedido y el README lo menciona, así que queda.

### 10. Lint en cero y estricto
- **mobile:** cambio `useRef(new Animated.Value(x)).current` por `const [anim] = useState(() => new Animated.Value(x))` en `fade-in.tsx`, `ring.tsx` y `ranking.tsx`. Es el mismo valor estable, sin leer un ref durante el render.
- Los 2 `set-state-in-effect` se resuelven caso por caso. En `use-color-scheme.web.ts`, la hidratación pasa a `useSyncExternalStore`. En `ranking.tsx`, el estado se deriva o el `setState` se mueve al callback.
- Después se borra el bloque que baja las reglas a `warn` en `mobile/eslint.config.js`.
- **frontend:** `load` de `AthletesPage` pasa a `useCallback` y entra en las dependencias.
- Los scripts quedan como `"lint": "eslint . --max-warnings 0"` en frontend y `"lint": "expo lint --max-warnings 0"` en mobile. Si `expo lint` no pasa el flag, uso `eslint . --max-warnings 0`.

### 11. Documentación
- `HANDOFF.md` y `docs/superpowers/RESUME-*.md` van a `docs/historico/`, y `PRODUCT.md` va a `docs/PRODUCT.md`, todos con `git mv`.
- `DEPLOY.md` y `PENDIENTES.md` quedan en la raíz: son operativos y muchos planes los citan.
- `docs/README.md` (nuevo) es un índice corto que dice qué es fuente de verdad y qué es histórico.
- Se arregla la referencia a `HANDOFF.md` en `PRODUCT.md:43`.
- `README.md` suma:
  - la sección **Lint** (`ruff check . && ruff format --check .`, más `npm run lint` en `frontend` y en `mobile`);
  - `cd frontend && npm test` en Tests;
  - cómo regenerar los locks;
  - Node 22+;
  - un link a `docs/README.md`.
- `PENDIENTES.md`: tacho los avisos de lint y sumo la migración de Expo (con link al plan) y el Node de `eas-update.yml`.

## Tests

| Test | Archivo | Qué fija |
|---|---|---|
| Contrato del hash | `backend/tests/test_email_hash_contrato.py` (nuevo) | `backend.api.routes._email_hash(e) == cloud.security.email_hash(e)` para emails con mayúsculas, espacios, `+alias`, acentos y punycode. Suma un vector dorado fijo (sha256 de `"chronotrack-v1:ana@test.com"`), para que un cambio de sal en las dos puntas también falle. Pasa en verde desde el principio, porque fija un comportamiento que ya existe. Antes de commitearlo verifico que falle si cambio la sal en una sola copia. |
| Mapa de rutas del portal | `cloud/tests/test_rutas.py` (nuevo, **antes** de partir `main.py`) | El conjunto de `(método, path)` de `app.routes` es igual a la lista actual de las 21 rutas de `main.py` más las de los routers. Es la red de seguridad del refactor: tiene que seguir verde después. |
| Imports de tests del portal | `conftest.py`, `test_rate_limit.py`, `test_portal_busqueda.py`, `test_email_hash.py`, `test_password_google.py`, `test_email_verificacion.py`, `test_arreglos_cuentas.py` y `test_run_avatar_global.py` | Solo cambia de dónde importan (`cloud.deps`, `cloud.migraciones`, `cloud.search`, `cloud.nombres`). No se borra ni se saltea ninguno. `test_health` sigue parcheando `cloud.main.SessionLocal`, porque `health` queda en `main`. |
| Tiempo | `frontend/src/lib/tiempo.test.js` (nuevo) | `formatNs` con null, 0, string BigInt y más de 24 h; `horaDeCaptura`; `formatTiempo` con y sin largada; `horaANs` con `hh:mm`, `hh:mm:ss`, `,`/`.` y 1 a 3 decimales, rangos inválidos y `baseNs` de otro día; `formatPace`; `formatCronometro` con truncado a centésimas y clamp de negativos. |
| Captura de llegadas | `frontend/src/lib/capturas.test.js` (nuevo) | `encolarCaptura` hace POST con `delay_ms` calculado desde `performance.now()`. Si hay error de red o 5xx, la captura queda en cola y se reintenta a los 2 s (con timers falsos). Un 4xx la descarta y avisa `rechazo`; un 2xx avisa `captura`. Se fija el orden FIFO, `contarSinGuardar` por carrera, que el intervalo se limpie al vaciarse y `porSecuencia`. El estado del módulo se aísla con `vi.resetModules()` e import dinámico, sin exports solo para tests. |
| Clasificación | `frontend/src/lib/standings.test.js` (nuevo) | Agrupa por distancia, pone "sin distancia" al final y ordena por neto o por hora de captura. |
| Suites existentes | `pytest` (330) y jest de mobile (73) | Siguen verdes en cada commit. La cobertura no baja. |

## Riesgos

- **Deploy del portal.** Cambiar el `buildCommand` al lock y `autoDeployTrigger` se activa recién con el push, que sigue atado al snapshot de `PENDIENTES.md` §5. Para mitigarlo, el job python de la CI instala el mismo `cloud/requirements.lock` en Linux, como Render, y localmente pruebo `pip install -r cloud/requirements.lock` en un venv limpio. Si `autoDeployTrigger` no existiera en el Blueprint, queda `autoDeploy: true` y lo aviso.
- **Partir `main.py`.** Puede cambiar el orden de rutas (FastAPI matchea en orden), dejar imports circulares (`claims` ↔ `auth` por `_autolink`) o romper tests que parchean atributos de módulo. Para mitigarlo: `test_rutas.py` primero, dependencias en una sola dirección (`nombres` ← `search`/`publish`/`claims` ← `auth`) y los 330 tests.
- **Partir `App.jsx`.** Es la pantalla que cronometra y no tiene e2e. Un import roto puede pasar el build si es una ruta que no se renderiza. Para mitigarlo: commits por capa, `vite build` y lint estricto (`no-undef`) en cada uno, y una prueba manual de punta a punta antes de darlo por cerrado (ver Verificación).
- **`ruff format`** genera un diff grande. Va aislado, en `.git-blame-ignore-revs`, después del split y con la suite verde.
- **`pip-audit`** puede encontrar CVEs en los pins de hoy y dejar la CI en rojo. Se resuelve subiendo pins en el mismo commit; si alguno no tiene fix, lo ignoro explícitamente con su ID y el porqué en el workflow.
- **El cambio de Animated en mobile** puede alterar la animación solo si el valor se recreara, y no se recrea: `useState` con inicializador es estable. Igual, toca la verificación en dispositivo que ya está pendiente.
- **Mover `PRODUCT.md`** puede romper herramientas que lo busquen en la raíz (`.impeccable/`). Si al revisarlo aparece una dependencia, lo dejo en la raíz y lo aviso.
- **La CI no bloquea `eas-update.yml`.** Un push a `main` con `mobile/` en rojo igual publica la OTA. Lo dejo como pendiente (por ejemplo, que el workflow dependa de la CI), porque está fuera del pedido.

## Verificación

1. En cada commit: `python -m pytest cloud/tests backend/tests -q`, y en `mobile` `npm test`, `npm run lint` y `npx tsc --noEmit`. En `frontend`: `npm run lint`, `npm test` y `npm run build`. Desde la sección 8 también `ruff check .` y `ruff format --check .`.
2. Locks: crear un venv limpio, instalar `-r cloud/requirements.lock -r requirements.lock -r requirements-dev.txt` y correr la suite completa. Además, `pipx run pip-audit -r cloud/requirements.lock` y lo mismo con el lock del escritorio.
3. Portal: `uvicorn cloud.main:app --port 8002`. Probar `/api/health`, el SPA, una búsqueda, un registro y login, y publicar con la key de dev. Las rutas de `/openapi.json` tienen que ser las mismas que antes.
4. Escritorio: `npm run build` y `python launcher.py`. Hacer el flujo de cronometraje completo: crear una carrera, inscribir, largar y ver avanzar el cronómetro. Capturar, asignar dorsal, deshacer y descartar. Cortar el WebSocket (bajar el backend unos segundos), capturar, ver el contador "sin guardar" y comprobar que al volver se guarda con su hora real. Imprimir el certificado.
5. CI: `actionlint` local sobre `ci.yml`, si está disponible. La corrida real en GitHub queda para después del push, que hace Agustín según `PENDIENTES.md`.
6. Final: `git status` limpio, un commit por mejora con el porqué, y los resultados reales (con su salida) en el resumen.
