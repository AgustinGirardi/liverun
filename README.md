# LiveRun

Sistema de cronometraje de carreras de calle y app de running, de punta a punta:
la computadora que toma los tiempos en la línea de llegada, el portal donde los
corredores buscan su resultado y se descargan el certificado, y la app móvil con
la que entrenan el resto del año.

Nació de un problema concreto: en las carreras de mi ciudad los resultados se
publicaban como una foto de una planilla de Excel en Instagram, a veces al día
siguiente. LiveRun los deja publicados y buscables por nombre apenas el
organizador aprieta un botón.

> **Estado:** en producción, con carreras reales cronometradas. Este repo es
> público para que se pueda leer el código; no es un template para clonar.

---

## Las cuatro piezas

```
┌──────────────────┐   publica      ┌──────────────────┐   consultan   ┌─────────────┐
│   ESCRITORIO     │  resultados    │      PORTAL      │   corredores  │   MÓVIL     │
│  (Windows .exe)  │ ─────────────► │  (web pública)   │ ◄──────────── │  (Android)  │
│                  │  POST /publish │                  │               │             │
│ cronometra la    │                │ busca, reclama   │               │ entrena,    │
│ carrera offline  │                │ y certifica      │               │ rankea      │
└──────────────────┘                └──────────────────┘               └─────────────┘
      backend/                       cloud/ + cloud/static/               mobile/
      frontend/
```

| Pieza | Qué hace | Stack |
|---|---|---|
| **Escritorio** (`backend/`, `frontend/`, `launcher.py`) | Cronómetro con centésimas, captura de llegadas por dorsal, roster, exportación e instalador. Funciona **sin internet**: en una largada el WiFi nunca es confiable. | FastAPI + SQLite, React + Vite, pywebview (Edge WebView2), PyInstaller + Inno Setup |
| **Portal** (`cloud/`) | Web pública de resultados: búsqueda por nombre, certificado imprimible, cuentas de corredor, calendario de carreras, panel de admin y cobro de la suscripción. | FastAPI + SQLAlchemy + SQLite, SPA en JS sin framework, desplegado en Render |
| **Móvil** (`mobile/`) | Registro de salidas con GPS en segundo plano, historial, rachas, amigos y ranking. Comparte la cuenta con el portal. | Expo (SDK 54) + React Native 0.81, expo-router, TypeScript |
| **Cobro** (`cloud/billing*.py`) | Suscripción premium mensual vía Mercado Pago, con precio anclado al dólar del día. | API de Mercado Pago + webhooks firmados |

---

## Decisiones de diseño que vale la pena mirar

Son las partes donde el problema real obligó a algo menos obvio:

- **El escritorio no depende de la nube.** Cronometra contra su propia SQLite y
  publica cuando hay señal. Si el portal está caído, la carrera igual se corre.
- **El portal nunca ve el email de los corredores en claro.** El escritorio manda
  un `sha256` del email (`_email_hash`) y el portal vincula el resultado a la
  cuenta cuando el corredor entra. Así se autovinculan los resultados sin que la
  base del portal acumule los emails que el organizador tenía en su planilla.
  El modelo (`cloud/models.py`) tampoco guarda DNI ni fecha de nacimiento.
- **Republicar una carrera no borra el perfil de nadie.** Un organizador corrige
  un tiempo y republica; los resultados se reemplazan enteros, pero los reclamos
  de los corredores se preservan por `(dorsal, distancia)`.
- **El precio se fija en dólares y se cobra en pesos del día.** Con la inflación
  argentina, un precio fijo en pesos se desactualiza en semanas
  (`cloud/billing.py`).
- **El rate limit no confía en los headers que manda el cliente.** Solo se cree
  `CF-Connecting-IP` si quien nos habla está realmente en un rango de Cloudflare;
  si no, la clave es el peer, que no se puede falsear (`cloud/deps.py`).

---

## Correrlo

Requiere Python 3.12+ y Node 20+.

```bash
# ── Portal (cloud/) ──
python -m venv .venv && .venv/Scripts/activate     # Linux/macOS: source .venv/bin/activate
pip install -r cloud/requirements.txt
cp .env.example .env                                # completá CT_CLOUD_SECRET y CT_PUBLISH_KEY
uvicorn cloud.main:app --reload --port 8002         # http://localhost:8002

# ── App de escritorio ──
pip install -r requirements.txt
cd frontend && npm install && npm run build && cd ..
python launcher.py

# ── App móvil ──
cd mobile && npm install && npx expo start
```

### Tests

```bash
python -m pytest cloud/tests backend/tests -q      # 150 tests
cd mobile && npm test
```

El despliegue del portal en Render está documentado paso a paso en
[DEPLOY.md](DEPLOY.md), incluido el blueprint (`render.yaml`) y la migración a
un dominio propio.

---

## Seguridad

El repo es público, así que el código de un servicio que está en producción es
legible por cualquiera. Lo que eso implicó:

- **Ningún secreto vive en el repo.** `.env`, las bases de datos y la config
  local están en `.gitignore`, y el historial completo está limpio.
  [`.env.example`](.env.example) documenta cada variable con valores vacíos.
- **Los secretos de producción los genera Render** (`generateValue` en
  `render.yaml`) y el portal **se niega a arrancar** si detecta los valores por
  defecto de desarrollo (`cloud/main.py`, `_startup`).
- **Auditoría previa a abrir el repo.** Se revisaron autenticación, autorización,
  el cobro y sus webhooks, rate limiting, subida de archivos y el SPA. Los
  hallazgos están corregidos, y cada corrección tiene su test de regresión en
  [`cloud/tests/test_hardening.py`](cloud/tests/test_hardening.py) para que no
  se reintroduzcan.

Si encontrás algo, escribime en vez de abrir un issue público.

### Deuda conocida

Anotada acá a propósito, porque el código público se lee mejor con sus límites a la vista:

- La CSP necesita `script-src 'unsafe-inline'`: el SPA del portal engancha los
  handlers como atributos `onclick`. Sacarlo requiere migrarlos a
  `addEventListener`.
- El rate limiting es en memoria y por proceso: sirve porque el portal corre en
  un único worker. Escalar horizontalmente pide moverlo a Redis.
- Hay una sola API key de publicación. Cada carrera ya graba qué key la publicó
  (`owner_key_hash`), así que el día que haya una key por organizador ninguno
  puede pisar las carreras de otro; falta emitirlas.

---

## Licencia

Todos los derechos reservados. El código está publicado para poder leerse, no
bajo una licencia de uso libre. (`mobile/LICENSE` es la licencia MIT de la
plantilla de Expo, no la de este proyecto.)
