# Rediseño del Portal Cloud — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar el portal cloud de ChronoTrack (navegación + estética) y auto-vincular los resultados de cada corredor a su perfil mediante un hash de email, sin que el portal almacene el email en claro.

**Architecture:** Dos fases independientes y testeables por separado. **Fase A (backend/cloud):** se agrega `email_hash` (sha256) al snapshot publicado desde el escritorio y a `PublishedResult`; el cloud auto-vincula resultados al registrarse/loguear y vía un endpoint manual. Se prueba con pytest + FastAPI `TestClient`. **Fase B (frontend):** se separa la SPA en `index.html` / `styles.css` / `app.js`, se aplica tema claro por defecto + toggle oscuro vía tokens CSS, barra superior fija con búsqueda siempre accesible, y se conecta la UI de auto-vinculación. La Fase B se verifica manualmente en el navegador (no hay test runner JS y no se introduce uno).

**Tech Stack:** Python 3 · FastAPI (cloud sync) · SQLAlchemy 2 · SQLite · pytest + httpx (nuevo, solo dev) · SPA estática vanilla JS (sin build step) · CSS custom properties + `data-theme`.

**Referencia de diseño:** `docs/superpowers/specs/2026-06-07-portal-redesign-design.md`

**Despliegue:** cambios en `cloud/**` auto-deployan en Render al pushear. El cambio en `backend/api/routes.py` (Tarea A4) requiere `build.bat` para llegar a los organizadores — NO basta con pushear.

**Sincronización del hash (crítico):** la fórmula del hash vive duplicada en el escritorio (`backend/api/routes.py`) y en el cloud (`cloud/main.py`). DEBE ser idéntica byte a byte:
`sha256(("chronotrack-v1:" + email.strip().lower()).encode()).hexdigest()`. Cualquier cambio en una copia obliga a cambiar la otra; cada copia lleva un comentario apuntando a la otra.

---

## FASE A — Backend / Cloud (auto-vinculación por hash)

### Task A1: Harness de tests del cloud (pytest + TestClient)

Hoy no existe ningún test en el repo. Esta tarea crea la infraestructura mínima para testear el cloud contra una base SQLite temporal, sin tocar `cloud.db` de desarrollo.

**Files:**
- Create: `cloud/tests/__init__.py`
- Create: `cloud/tests/conftest.py`
- Create: `cloud/tests/test_smoke.py`
- Modify: `cloud/requirements.txt` (agregar deps de test)

- [ ] **Step 1: Agregar dependencias de test**

Editar `cloud/requirements.txt` para que quede:

```
fastapi>=0.110
uvicorn[standard]>=0.27
sqlalchemy>=2.0
pytest>=8.0
httpx>=0.27
```

- [ ] **Step 2: Crear el paquete de tests**

Crear `cloud/tests/__init__.py` vacío (archivo de 0 bytes).

- [ ] **Step 3: Escribir el conftest con base temporal y cliente**

El engine del cloud se crea al importar `cloud.db` leyendo `CT_CLOUD_DB`. Por eso el conftest setea esa env var ANTES de importar cualquier módulo `cloud.*`. Crear `cloud/tests/conftest.py`:

```python
import os
import tempfile
import pytest

# Apuntar la DB del cloud a un archivo temporal ANTES de importar cloud.*
_tmp = tempfile.NamedTemporaryFile(prefix="ct_test_", suffix=".db", delete=False)
_tmp.close()
os.environ["CT_CLOUD_DB"] = f"sqlite:///{_tmp.name}"
os.environ["CT_PUBLISH_KEY"] = "test-publish-key"

from fastapi.testclient import TestClient  # noqa: E402
from cloud.db import Base, engine, SessionLocal  # noqa: E402
from cloud import models  # noqa: E402,F401  registra los modelos
from cloud.main import app  # noqa: E402


@pytest.fixture(autouse=True)
def _fresh_db():
    """Cada test arranca con tablas limpias."""
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def db():
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()


PUBLISH_KEY = "test-publish-key"


def publish_race(client, source_id="ct-race-1", name="Maratón Test", results=None):
    """Helper: publica una carrera vía API y devuelve la respuesta JSON."""
    payload = {
        "source_id": source_id,
        "name": name,
        "location": "Córdoba",
        "race_date": "2026-05-01",
        "distances": [10.0],
        "results": results or [],
    }
    r = client.post("/api/publish", json=payload, headers={"X-API-Key": PUBLISH_KEY})
    assert r.status_code == 200, r.text
    return r.json()
```

- [ ] **Step 4: Escribir un smoke test**

Crear `cloud/tests/test_smoke.py`:

```python
def test_publish_and_list_race(client):
    from cloud.tests.conftest import publish_race
    publish_race(client, results=[{
        "bib_number": "1", "full_name": "Juan Perez",
        "distance_km": 10.0, "net_time_ns": 1_800_000_000_000,
        "position": 1, "status": "FINISHER",
    }])
    r = client.get("/api/races")
    assert r.status_code == 200
    races = r.json()
    assert len(races) == 1
    assert races[0]["name"] == "Maratón Test"
    assert races[0]["finishers"] == 1
```

- [ ] **Step 5: Correr el smoke test (debe pasar)**

Run: `python -m pytest cloud/tests/test_smoke.py -v`
Expected: PASS (1 passed). Si falla por import, verificar que se corre desde la raíz del repo (`C:\Users\agust\chronotrack`) para que `cloud` sea importable.

- [ ] **Step 6: Commit**

```bash
git add cloud/tests/__init__.py cloud/tests/conftest.py cloud/tests/test_smoke.py cloud/requirements.txt
git commit -m "test(cloud): harness de pytest con DB temporal y TestClient"
```

---

### Task A2: Columna `email_hash` en `PublishedResult` + migración suave

**Files:**
- Modify: `cloud/models.py:38-53` (modelo `PublishedResult`)
- Modify: `cloud/main.py:73-84` (`_startup`, agregar migración idempotente)
- Test: `cloud/tests/test_email_hash.py`

- [ ] **Step 1: Escribir el test de la columna y la migración**

Crear `cloud/tests/test_email_hash.py`:

```python
from sqlalchemy import inspect, text
from cloud.db import engine
from cloud.models import PublishedResult


def test_published_result_has_email_hash_column():
    cols = {c.name for c in PublishedResult.__table__.columns}
    assert "email_hash" in cols


def test_migration_adds_column_to_existing_table():
    # Simula una tabla vieja sin email_hash, luego corre la migración.
    from cloud.main import _ensure_email_hash_column
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS published_results"))
        conn.execute(text(
            "CREATE TABLE published_results ("
            "id INTEGER PRIMARY KEY, race_id INTEGER, bib_number VARCHAR, "
            "full_name VARCHAR, category VARCHAR, club VARCHAR, distance_km FLOAT, "
            "net_time_ns BIGINT, finish_time_ns BIGINT, position INTEGER, status VARCHAR)"
        ))
    _ensure_email_hash_column()  # idempotente
    _ensure_email_hash_column()  # segunda llamada no debe romper
    insp = inspect(engine)
    cols = {c["name"] for c in insp.get_columns("published_results")}
    assert "email_hash" in cols
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `python -m pytest cloud/tests/test_email_hash.py -v`
Expected: FAIL — `email_hash` no está en columnas / `_ensure_email_hash_column` no existe (ImportError).

- [ ] **Step 3: Agregar la columna al modelo**

En `cloud/models.py`, dentro de `class PublishedResult`, agregar la columna después de `status` (línea 50):

```python
    status         = Column(String(12), nullable=False, default="FINISHER")  # FINISHER/DNF/DNS/DQ
    email_hash     = Column(String(64), nullable=True, index=True)  # sha256 hex del email (privacy-preserving); ver design doc
```

- [ ] **Step 4: Agregar la migración idempotente en el cloud**

En `cloud/main.py`, agregar la función antes de `_startup` (antes de la línea 73) y llamarla dentro de `_startup` después de `init_db()`:

```python
def _ensure_email_hash_column():
    """Migración suave para SQLite: agrega published_results.email_hash si falta.
    create_all() no altera tablas existentes, así que en bases ya creadas
    (p. ej. Render) hay que hacer el ALTER manualmente. Idempotente."""
    from sqlalchemy import text
    from cloud.db import engine
    with engine.begin() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(published_results)"))]
        if not cols:
            return  # tabla inexistente: create_all (ya corrió en init_db) la crea con la columna
        if "email_hash" not in cols:
            conn.execute(text("ALTER TABLE published_results ADD COLUMN email_hash VARCHAR(64)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_published_results_email_hash ON published_results (email_hash)"))
```

Y en `_startup` (línea 84), después de `init_db()`:

```python
    init_db()
    _ensure_email_hash_column()
```

> Nota: `PRAGMA table_info` devuelve filas vacías si la tabla no existe. En ese caso `create_all()` (ya llamado por `init_db()`) la creó con la columna nueva, así que no hay nada que migrar. La migración solo importa para bases preexistentes en producción (Render).

- [ ] **Step 5: Correr el test (debe pasar)**

Run: `python -m pytest cloud/tests/test_email_hash.py -v`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
git add cloud/models.py cloud/main.py cloud/tests/test_email_hash.py
git commit -m "feat(cloud): columna email_hash en published_results + migración suave"
```

---

### Task A3: Ingreso del `email_hash` en `POST /api/publish`

**Files:**
- Modify: `cloud/main.py:89-98` (schema `PublishResult`)
- Test: `cloud/tests/test_publish_hash.py`

- [ ] **Step 1: Escribir el test de ingreso del hash**

Crear `cloud/tests/test_publish_hash.py`:

```python
import hashlib
from cloud.db import SessionLocal
from cloud.models import PublishedResult


def _h(email):
    return hashlib.sha256(("chronotrack-v1:" + email.strip().lower()).encode()).hexdigest()


def test_publish_stores_email_hash(client):
    from cloud.tests.conftest import publish_race
    h = _h("Juan@Mail.com")
    publish_race(client, results=[{
        "bib_number": "1", "full_name": "Juan Perez",
        "distance_km": 10.0, "net_time_ns": 1_800_000_000_000,
        "position": 1, "status": "FINISHER", "email_hash": h,
    }])
    db = SessionLocal()
    try:
        res = db.query(PublishedResult).one()
        assert res.email_hash == h
    finally:
        db.close()


def test_publish_without_hash_is_null(client):
    from cloud.tests.conftest import publish_race
    publish_race(client, results=[{
        "bib_number": "2", "full_name": "Ana Gomez",
        "distance_km": 10.0, "net_time_ns": 1_900_000_000_000,
        "position": 2, "status": "FINISHER",
    }])
    db = SessionLocal()
    try:
        res = db.query(PublishedResult).filter_by(bib_number="2").one()
        assert res.email_hash is None
    finally:
        db.close()
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `python -m pytest cloud/tests/test_publish_hash.py -v`
Expected: FAIL — el `email_hash` no se persiste (queda None) porque el schema lo ignora.

- [ ] **Step 3: Agregar `email_hash` al schema `PublishResult`**

En `cloud/main.py`, en `class PublishResult` (líneas 89-98), agregar el campo opcional al final:

```python
class PublishResult(BaseModel):
    bib_number: str
    full_name: str
    category: Optional[str] = None
    club: Optional[str] = None
    distance_km: Optional[float] = None
    net_time_ns: Optional[int] = None
    finish_time_ns: Optional[int] = None
    position: Optional[int] = None
    status: str = "FINISHER"
    email_hash: Optional[str] = None  # sha256 hex; el escritorio lo calcula, el cloud nunca ve el email en claro
```

El endpoint `publish()` ya hace `PublishedResult(race_id=race.id, **r.model_dump())` (línea 195), así que el campo se persiste automáticamente.

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `python -m pytest cloud/tests/test_publish_hash.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add cloud/main.py cloud/tests/test_publish_hash.py
git commit -m "feat(cloud): /api/publish acepta y persiste email_hash"
```

---

### Task A4: El escritorio calcula y envía el `email_hash`

**Files:**
- Modify: `backend/api/routes.py:709-760` (`publish_race`)

> ⚠️ Este cambio es del ESCRITORIO. Requiere `build.bat` para llegar a los organizadores; no se testea con el harness del cloud. Verificación manual al final.

- [ ] **Step 1: Agregar el helper de hash**

En `backend/api/routes.py`, justo antes de `publish_race` (antes de la línea 709), agregar:

```python
def _email_hash(email):
    """sha256 del email normalizado (privacy-preserving). DEBE coincidir byte a byte
    con cloud/main.py::_autolink — si cambia uno, cambiar el otro."""
    e = (email or "").strip().lower()
    if not e:
        return None
    return hashlib.sha256(("chronotrack-v1:" + e).encode()).hexdigest()
```

Verificar que `hashlib` esté importado al tope de `backend/api/routes.py`. Si no lo está, agregar `import hashlib` junto a los demás imports.

- [ ] **Step 2: Incluir el hash en ambos loops del payload**

En `publish_race`, en el loop de `data.results` (línea 729), agregar la clave `email_hash`:

```python
    for row in data.results:
        results.append({
            "bib_number": row.bib_number,
            "full_name": _clean_name(row.runner.full_name),
            "category": row.category,
            "club": row.club,
            "distance_km": row.distance_km,
            "net_time_ns": row.net_time_ns,
            "finish_time_ns": row.finish_time_ns,
            "position": row.position,
            "status": "FINISHER",
            "email_hash": _email_hash(row.runner.email),
        })
```

Y en el loop de `data.dnf_list` (línea 740):

```python
    for row in data.dnf_list:
        results.append({
            "bib_number": row.bib_number,
            "full_name": _clean_name(row.runner.full_name),
            "category": row.category,
            "club": row.club,
            "distance_km": row.distance_km,
            "net_time_ns": None,
            "finish_time_ns": None,
            "position": None,
            "status": row.status,
            "email_hash": _email_hash(row.runner.email),
        })
```

- [ ] **Step 3: Verificación de import en arranque del backend**

Run: `python -c "import backend.api.routes"`
Expected: sin error (confirma que `hashlib` y la sintaxis están bien).

- [ ] **Step 4: Commit**

```bash
git add backend/api/routes.py
git commit -m "feat(desktop): publish_race envía email_hash (privacy-preserving)"
```

---

### Task A5: Helper `_autolink` + auto-vinculación en register/login

**Files:**
- Modify: `cloud/main.py` (agregar `_autolink` cerca de los helpers, líneas 139-156)
- Modify: `cloud/main.py:246-258` (`register`)
- Modify: `cloud/main.py:261-268` (`login`)
- Test: `cloud/tests/test_autolink.py`

- [ ] **Step 1: Escribir los tests de auto-vinculación**

Crear `cloud/tests/test_autolink.py`:

```python
import hashlib


def _h(email):
    return hashlib.sha256(("chronotrack-v1:" + email.strip().lower()).encode()).hexdigest()


def _publish_with_email(client, email, bib="1", name="Juan Perez", source_id="ct-race-1"):
    from cloud.tests.conftest import publish_race
    publish_race(client, source_id=source_id, results=[{
        "bib_number": bib, "full_name": name, "distance_km": 10.0,
        "net_time_ns": 1_800_000_000_000, "position": 1,
        "status": "FINISHER", "email_hash": _h(email),
    }])


def test_register_autolinks_matching_results(client):
    _publish_with_email(client, "juan@mail.com")
    r = client.post("/api/auth/register", json={
        "email": "juan@mail.com", "password": "supersecreta", "full_name": "Juan Perez"})
    assert r.status_code == 200
    token = r.json()["token"]
    me = client.get("/api/me/results", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert len(me.json()["results"]) == 1


def test_register_does_not_link_other_emails(client):
    _publish_with_email(client, "otro@mail.com")
    r = client.post("/api/auth/register", json={
        "email": "juan@mail.com", "password": "supersecreta", "full_name": "Juan Perez"})
    token = r.json()["token"]
    me = client.get("/api/me/results", headers={"Authorization": f"Bearer {token}"})
    assert len(me.json()["results"]) == 0


def test_login_links_results_published_after_register(client):
    # Cuenta creada antes de que exista el resultado
    client.post("/api/auth/register", json={
        "email": "juan@mail.com", "password": "supersecreta", "full_name": "Juan Perez"})
    _publish_with_email(client, "juan@mail.com")  # se publica después
    r = client.post("/api/auth/login", json={"email": "juan@mail.com", "password": "supersecreta"})
    token = r.json()["token"]
    me = client.get("/api/me/results", headers={"Authorization": f"Bearer {token}"})
    assert len(me.json()["results"]) == 1


def test_autolink_is_idempotent(client):
    _publish_with_email(client, "juan@mail.com")
    client.post("/api/auth/register", json={
        "email": "juan@mail.com", "password": "supersecreta", "full_name": "Juan Perez"})
    r = client.post("/api/auth/login", json={"email": "juan@mail.com", "password": "supersecreta"})
    token = r.json()["token"]
    me = client.get("/api/me/results", headers={"Authorization": f"Bearer {token}"})
    assert len(me.json()["results"]) == 1  # no se duplica
```

- [ ] **Step 2: Correr los tests (deben fallar)**

Run: `python -m pytest cloud/tests/test_autolink.py -v`
Expected: FAIL — los resultados no se vinculan (0 en vez de 1); `_autolink` no existe aún.

- [ ] **Step 3: Agregar el helper `_autolink`**

En `cloud/main.py`, después de `_result_dict` (después de la línea 156), agregar:

```python
def _email_hash(email: str) -> str:
    """sha256 del email normalizado. DEBE coincidir byte a byte con
    backend/api/routes.py::_email_hash — si cambia uno, cambiar el otro."""
    return hashlib.sha256(("chronotrack-v1:" + (email or "").strip().lower()).encode()).hexdigest()


def _autolink(user: PortalUser, db: Session) -> int:
    """Vincula a `user` todos los PublishedResult cuyo email_hash coincide con su
    email de cuenta. Devuelve cuántos vínculos NUEVOS creó (no duplica)."""
    h = _email_hash(user.email)
    results = db.scalars(
        select(PublishedResult).where(PublishedResult.email_hash == h)
    ).all()
    created = 0
    for res in results:
        exists = db.scalar(select(Claim).where(
            Claim.user_id == user.id, Claim.result_id == res.id))
        if not exists:
            db.add(Claim(user_id=user.id, result_id=res.id))
            created += 1
    if created:
        db.commit()
    return created
```

- [ ] **Step 4: Llamar `_autolink` en register**

En `register` (línea 255-258), reemplazar el final:

```python
    user = PortalUser(email=email, password_hash=hash_password(body.password), full_name=body.full_name)
    db.add(user)
    db.commit()
    linked = _autolink(user, db)
    return {"token": make_token(user.id), "email": user.email, "full_name": user.full_name, "linked": linked}
```

- [ ] **Step 5: Llamar `_autolink` en login**

En `login` (líneas 265-268), reemplazar el final:

```python
    user = db.scalar(select(PortalUser).where(PortalUser.email == body.email.lower()))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Email o contraseña incorrectos")
    linked = _autolink(user, db)
    return {"token": make_token(user.id), "email": user.email, "full_name": user.full_name, "linked": linked}
```

- [ ] **Step 6: Correr los tests (deben pasar)**

Run: `python -m pytest cloud/tests/test_autolink.py -v`
Expected: PASS (4 passed).

- [ ] **Step 7: Commit**

```bash
git add cloud/main.py cloud/tests/test_autolink.py
git commit -m "feat(cloud): auto-vinculación de resultados por email_hash en register/login"
```

---

### Task A6: Endpoint manual `POST /api/me/autolink`

**Files:**
- Modify: `cloud/main.py` (agregar endpoint después de `claim_result`, ~línea 390)
- Test: `cloud/tests/test_autolink_endpoint.py`

- [ ] **Step 1: Escribir el test del endpoint manual**

Crear `cloud/tests/test_autolink_endpoint.py`:

```python
import hashlib


def _h(email):
    return hashlib.sha256(("chronotrack-v1:" + email.strip().lower()).encode()).hexdigest()


def _token(client, email="juan@mail.com"):
    r = client.post("/api/auth/register", json={
        "email": email, "password": "supersecreta", "full_name": "Juan Perez"})
    return r.json()["token"]


def test_manual_autolink_picks_up_new_results(client):
    from cloud.tests.conftest import publish_race
    token = _token(client)  # registro sin resultados aún
    # Se publica un resultado del usuario DESPUÉS del registro
    publish_race(client, results=[{
        "bib_number": "1", "full_name": "Juan Perez", "distance_km": 10.0,
        "net_time_ns": 1_800_000_000_000, "position": 1,
        "status": "FINISHER", "email_hash": _h("juan@mail.com")}])
    r = client.post("/api/me/autolink", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["linked"] == 1
    # Segunda llamada no vincula nada nuevo
    r2 = client.post("/api/me/autolink", headers={"Authorization": f"Bearer {token}"})
    assert r2.json()["linked"] == 0


def test_manual_autolink_requires_auth(client):
    r = client.post("/api/me/autolink")
    assert r.status_code == 401
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `python -m pytest cloud/tests/test_autolink_endpoint.py -v`
Expected: FAIL — 404 (endpoint inexistente) en el primer test.

- [ ] **Step 3: Agregar el endpoint**

En `cloud/main.py`, después de `claim_result` (después de la línea 390), agregar:

```python
@app.post("/api/me/autolink", tags=["Corredor"])
def autolink_me(request: Request, user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    """Re-ejecuta la auto-vinculación por email para el usuario logueado.
    Lo usa el botón 'Buscar mis resultados por email' del perfil."""
    rate_limit(request, "claim", limit=30, window=60.0)
    linked = _autolink(user, db)
    return {"linked": linked}
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `python -m pytest cloud/tests/test_autolink_endpoint.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Correr toda la suite del cloud**

Run: `python -m pytest cloud/tests/ -v`
Expected: PASS (todos). Confirma que nada se rompió.

- [ ] **Step 6: Commit**

```bash
git add cloud/main.py cloud/tests/test_autolink_endpoint.py
git commit -m "feat(cloud): endpoint POST /api/me/autolink para vinculación manual"
```

---

## FASE B — Frontend (rediseño visual + navegación)

> **Sin test runner JS.** Cada tarea se verifica manualmente levantando el cloud localmente:
> `python -m uvicorn cloud.main:app --reload --port 8002` y abriendo `http://127.0.0.1:8002`.
> Para datos de prueba, publicar con el escritorio o con un POST a `/api/publish` (X-API-Key
> = valor de `CT_PUBLISH_KEY`, por defecto `dev-publish-key-change-me` en local).

### Task B1: Separar la SPA en index.html / styles.css / app.js (sin cambios de comportamiento)

Refactor mecánico: extraer el `<style>` y el `<script>` del `index.html` a archivos propios servidos por el mismo `StaticFiles` mount. Sin cambios de comportamiento ni visuales — paridad exacta. Esto deja archivos manejables para las tareas siguientes.

**Files:**
- Modify: `cloud/static/index.html`
- Create: `cloud/static/styles.css`
- Create: `cloud/static/app.js`

- [ ] **Step 1: Extraer el CSS**

Crear `cloud/static/styles.css` con **exactamente** el contenido actual entre `<style>` y `</style>` de `index.html` (líneas 8-137, sin las etiquetas `<style>`).

- [ ] **Step 2: Extraer el JS**

Crear `cloud/static/app.js` con **exactamente** el contenido actual entre `<script>` y `</script>` de `index.html` (líneas 152-592, sin las etiquetas `<script>`).

- [ ] **Step 3: Reescribir index.html para enlazar los archivos**

Reemplazar `cloud/static/index.html` por:

```html
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ChronoTrack · Resultados</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<header>
  <div class="logo" onclick="go('home')"><span class="dot"></span>CHRONO<span>TRACK</span></div>
  <div class="nav" id="nav"></div>
</header>
<main id="app"></main>
<footer>
  <div class="logo"><span class="dot"></span>CHRONO<span>TRACK</span></div>
  <div>Resultados oficiales de cronometraje · Hecho con ChronoTrack</div>
</footer>
<script src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 4: Verificar paridad en el navegador**

Run: `python -m pytest cloud/tests/ -q` (confirma backend intacto), luego levantar el server y abrir el portal.
Expected: la web se ve y funciona **idéntica** a antes (home, búsqueda, detalle de carrera, login). Revisar la consola del navegador: sin errores 404 de `/styles.css` ni `/app.js`.

- [ ] **Step 5: Commit**

```bash
git add cloud/static/index.html cloud/static/styles.css cloud/static/app.js
git commit -m "refactor(portal): separar SPA en index.html / styles.css / app.js (sin cambios de comportamiento)"
```

---

### Task B2: Tema claro por defecto + toggle oscuro (tokens CSS)

Migrar de la paleta oscura fija a tokens temáticos: claro por defecto, oscuro bajo `[data-theme="dark"]`, con toggle persistido en `localStorage`.

**Files:**
- Modify: `cloud/static/styles.css` (bloque `:root`)
- Modify: `cloud/static/app.js` (init de tema + función toggle)
- Modify: `cloud/static/index.html` (botón de toggle en el header)

- [ ] **Step 1: Redefinir los tokens (claro por defecto + override oscuro)**

En `cloud/static/styles.css`, reemplazar el bloque `:root { ... }` (líneas 8-13 originales) por:

```css
  :root {
    --bg:#F7F9FA; --bg2:#FFFFFF; --panel:#FFFFFF; --panel2:#F0F3F5; --border:#E3E9ED;
    --txt:#0E1A22; --mut:#5B6B75; --dim:#8A969E; --acc:#00B383; --acc2:#009E74;
    --blue:#2D6FE0; --warn:#E5772A; --danger:#E5484D;
    --shadow:0 6px 20px rgba(14,26,34,.08);
  }
  [data-theme="dark"] {
    --bg:#0b0d0e; --bg2:#0f1213; --panel:#15181a; --panel2:#1c2023; --border:#262b2e;
    --txt:#eef1f2; --mut:#97a0a6; --dim:#5b646a; --acc:#00e5a0; --acc2:#00b483;
    --blue:#5aa2ff; --warn:#f5a623; --danger:#ff6b6b;
    --shadow:0 10px 30px rgba(0,0,0,.35);
  }
```

> El resto del CSS ya consume estos tokens, así que el cambio de tema es automático para casi todo. Revisar en la verificación si algún color hardcodeado (ej. `#04130d` del texto sobre botón acento) necesita ajuste de contraste en claro — ese sigue siendo legible sobre verde, se deja igual.

- [ ] **Step 2: Ajustar el fondo del body para el tema claro**

En `cloud/static/styles.css`, el `body` tiene gradientes radiales con alfa pensados para fondo oscuro (líneas 15-22). Reemplazar la regla `background:` del `body` por una que use el token y atenúe los gradientes:

```css
  body {
    background:
      radial-gradient(1100px 500px at 85% -10%, rgba(0,179,131,.07), transparent 60%),
      radial-gradient(900px 500px at -5% 0%, rgba(45,111,224,.05), transparent 55%),
      var(--bg);
    color:var(--txt); font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;
    min-height:100vh; -webkit-font-smoothing:antialiased; line-height:1.5;
  }
```

- [ ] **Step 3: Agregar el botón de toggle al header**

En `cloud/static/index.html`, dentro de `<header>`, agregar el botón de tema antes del `<div class="nav">`:

```html
<header>
  <div class="logo" onclick="go('home')"><span class="dot"></span>CHRONO<span>TRACK</span></div>
  <div class="nav" id="nav"></div>
  <button id="themeBtn" class="theme-toggle" onclick="toggleTheme()" title="Cambiar tema" aria-label="Cambiar tema claro u oscuro">◐</button>
</header>
```

- [ ] **Step 4: Estilar el botón de toggle**

En `cloud/static/styles.css`, agregar después de las reglas `.nav`:

```css
  .theme-toggle { background:transparent; border:1px solid var(--border); color:var(--mut);
    width:36px; height:36px; border-radius:9px; font-size:16px; line-height:1; margin-left:8px;
    transition:all .15s; }
  .theme-toggle:hover { border-color:var(--acc); color:var(--acc); }
```

- [ ] **Step 5: Implementar el toggle en app.js**

En `cloud/static/app.js`, agregar al principio (después de la línea `let state = ...`):

```javascript
function applyTheme(t){
  document.documentElement.setAttribute("data-theme", t);
  const b = document.getElementById("themeBtn");
  if(b) b.textContent = t === "dark" ? "◑" : "◐";
}
function toggleTheme(){
  const cur = localStorage.getItem("ct_theme") === "dark" ? "dark" : "light";
  const next = cur === "dark" ? "light" : "dark";
  localStorage.setItem("ct_theme", next);
  applyTheme(next);
}
applyTheme(localStorage.getItem("ct_theme") === "dark" ? "dark" : "light");
```

- [ ] **Step 6: Verificar en el navegador**

Levantar el server y abrir el portal.
Expected: la web carga en **tema claro** por defecto, legible (texto oscuro sobre fondo claro, cards blancas). Click en ◐ → cambia a oscuro y persiste tras recargar (F5). Volver a click → claro.

- [ ] **Step 7: Commit**

```bash
git add cloud/static/styles.css cloud/static/app.js cloud/static/index.html
git commit -m "feat(portal): tema claro por defecto + toggle oscuro vía tokens CSS"
```

---

### Task B3: Barra de búsqueda siempre accesible en el header

Mover la búsqueda al header para que esté disponible desde cualquier vista (resuelve la queja principal de navegación).

**Files:**
- Modify: `cloud/static/index.html` (input de búsqueda en el header)
- Modify: `cloud/static/styles.css` (estilo de la búsqueda del header)
- Modify: `cloud/static/app.js` (`headerSearch()` + ocultar la búsqueda del header en home para no duplicar el hero)

- [ ] **Step 1: Agregar el input al header**

En `cloud/static/index.html`, dentro de `<header>`, entre el logo y el nav:

```html
<header>
  <div class="logo" onclick="go('home')"><span class="dot"></span>CHRONO<span>TRACK</span></div>
  <div class="header-search" id="headerSearch">
    <input id="hq" placeholder="🔎 Buscar corredor o carrera…" onkeydown="if(event.key==='Enter')headerSearch()">
  </div>
  <div class="nav" id="nav"></div>
  <button id="themeBtn" class="theme-toggle" onclick="toggleTheme()" title="Cambiar tema" aria-label="Cambiar tema claro u oscuro">◐</button>
</header>
```

- [ ] **Step 2: Estilar la búsqueda del header**

En `cloud/static/styles.css`, agregar después de las reglas del header:

```css
  .header-search { flex:1; max-width:420px; }
  .header-search input { width:100%; background:var(--panel2); border:1px solid var(--border);
    border-radius:9px; padding:9px 13px; color:var(--txt); font-size:13px; outline:none;
    transition:border-color .15s, box-shadow .15s; }
  .header-search input:focus { border-color:var(--acc); box-shadow:0 0 0 3px rgba(0,179,131,.12); }
  @media (max-width:680px){ .header-search { max-width:none; } .logo span { display:none; } }
```

- [ ] **Step 3: Implementar `headerSearch()` y el control de visibilidad**

En `cloud/static/app.js`, agregar la función:

```javascript
function headerSearch(){ const el=document.getElementById("hq"); const q=(el?el.value:"").trim(); if(q.length>=2) go("search", q); }
```

Y en `go(view, arg)` (después de `renderNav();`), ocultar la búsqueda del header en la home (donde ya está el hero) y mostrarla en el resto:

```javascript
  const hs = document.getElementById("headerSearch");
  if(hs) hs.style.display = (view === "home") ? "none" : "block";
  const hq = document.getElementById("hq");
  if(hq && view === "search") hq.value = arg || "";
```

- [ ] **Step 4: Verificar en el navegador**

Levantar el server. En home la búsqueda del header está oculta (se usa el hero). Entrar a una carrera o a resultados de búsqueda → aparece el input en el header; escribir un nombre + Enter navega a la búsqueda. El input refleja el término al estar en la vista de búsqueda.
Expected: comportamiento descrito, sin errores en consola.

- [ ] **Step 5: Commit**

```bash
git add cloud/static/index.html cloud/static/styles.css cloud/static/app.js
git commit -m "feat(portal): barra de búsqueda siempre accesible en el header"
```

---

### Task B3b: Home híbrido — cards de carreras recientes para visitantes

El home de visitante (no logueado) hoy muestra solo el grid de "features". El spec pide un home híbrido: hero de búsqueda **y** exploración de carreras con igual peso. Esta tarea agrega debajo del hero un grid de carreras recientes (reutilizando `raceCard`, que ya existe).

**Files:**
- Modify: `cloud/static/app.js` (`viewHome`)

- [ ] **Step 1: Agregar el contenedor de carreras recientes y cargarlas**

En `cloud/static/app.js`, en `viewHome` (rama de visitante), reemplazar el bloque `.features` (líneas 225-229) por un separador + contenedor de carreras, y disparar la carga al final de la función. Cambiar:

```javascript
      <div class="features">
        <div class="feature"><div class="ic">🔎</div><h3>Buscá por nombre</h3><p>Sin códigos ni dorsales: escribí tu nombre y encontrá tus carreras.</p></div>
        <div class="feature"><div class="ic">🏅</div><h3>Certificado al instante</h3><p>Descargá tu certificado de finisher en PDF con un clic.</p></div>
        <div class="feature"><div class="ic">📈</div><h3>Tu progreso</h3><p>Guardá tus resultados y mirá tus mejores marcas por distancia.</p></div>
      </div>
    </section>`;
}
```

por:

```javascript
      <div class="features">
        <div class="feature"><div class="ic">🔎</div><h3>Buscá por nombre</h3><p>Sin códigos ni dorsales: escribí tu nombre y encontrá tus carreras.</p></div>
        <div class="feature"><div class="ic">🏅</div><h3>Certificado al instante</h3><p>Descargá tu certificado de finisher en PDF con un clic.</p></div>
        <div class="feature"><div class="ic">📈</div><h3>Tu progreso</h3><p>Guardá tus resultados y mirá tus mejores marcas por distancia.</p></div>
      </div>
    </section>
    <h2 style="text-align:center;margin-top:36px">Carreras recientes</h2>
    <div class="sub" style="text-align:center">Explorá los últimos resultados publicados.</div>
    <div id="homeRaces"><div class="empty">Cargando…</div></div>`;
  loadHomeRaces();
}
async function loadHomeRaces(){
  const box = $("homeRaces"); if(!box) return;
  try {
    const races = await api("GET","/api/races");
    box.innerHTML = races.length
      ? races.slice(0, 9).map(raceCard).join("")
      : `<div class="empty"><div class="ic">🏁</div>Todavía no hay carreras publicadas.</div>`;
  } catch(e){ box.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}
```

- [ ] **Step 2: Verificar en el navegador**

Abrir el portal sin sesión iniciada.
Expected: bajo el hero y los "features" aparece "Carreras recientes" con cards de las últimas carreras (máx. 9), clickeables hacia el detalle. En ambos temas se ve legible. Si no hay carreras publicadas, muestra el estado vacío.

- [ ] **Step 3: Commit**

```bash
git add cloud/static/app.js
git commit -m "feat(portal): home híbrido — carreras recientes para visitantes"
```

---

### Task B4: Perfil — toast de auto-vinculación + botón "Buscar mis resultados por email"

Conectar la UI con la Fase A: mostrar cuántos resultados se auto-vincularon al entrar, y un botón manual en el dashboard para re-ejecutar la búsqueda por email.

**Files:**
- Modify: `cloud/static/app.js` (`setSession`/`doAuth` para el toast; `viewDashboard` para el botón; función `manualAutolink`; helper `toast`)
- Modify: `cloud/static/styles.css` (estilo del toast)

- [ ] **Step 1: Agregar un helper de toast**

En `cloud/static/app.js`, agregar:

```javascript
function toast(msg, kind){
  let t = document.getElementById("ctToast");
  if(!t){ t = document.createElement("div"); t.id="ctToast"; t.className="toast"; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = "toast show" + (kind==="warn" ? " warn" : "");
  clearTimeout(t._h); t._h = setTimeout(()=>{ t.className="toast"; }, 3500);
}
```

- [ ] **Step 2: Estilar el toast**

En `cloud/static/styles.css`, agregar al final:

```css
  .toast { position:fixed; left:50%; bottom:24px; transform:translateX(-50%) translateY(20px);
    background:var(--acc); color:#04130d; font-weight:700; font-size:14px; padding:12px 20px;
    border-radius:11px; box-shadow:var(--shadow); opacity:0; pointer-events:none;
    transition:opacity .2s, transform .2s; z-index:50; max-width:90vw; text-align:center; }
  .toast.show { opacity:1; transform:translateX(-50%) translateY(0); }
  .toast.warn { background:var(--warn); color:#1a0f04; }
```

- [ ] **Step 3: Mostrar el toast tras register/login**

En `cloud/static/app.js`, en `doAuth` reemplazar la línea `setSession(d); go("home");` (línea 528) por:

```javascript
    setSession(d); go("home");
    if(d.linked > 0) toast(`Vinculamos ${d.linked} resultado${d.linked===1?"":"s"} a tu perfil 🎉`);
```

- [ ] **Step 4: Agregar el botón manual al dashboard**

En `cloud/static/app.js`, en `viewDashboard`, dentro del bloque de "Mis carreras" del historial — agregar el botón en el encabezado. Reemplazar la apertura del historial `hist` (la rama con resultados, línea 271) para incluir el botón. Concretamente, donde dice:

```javascript
    const hist = d.results.length
      ? `<h2 style="margin-top:24px">Mis carreras</h2><div class="card" style="padding:6px"><table>
```

reemplazar por:

```javascript
    const hist = d.results.length
      ? `<div class="row" style="justify-content:space-between;margin-top:24px;align-items:center">
           <h2 style="margin:0">Mis carreras</h2>
           <button class="btn ghost sm" onclick="manualAutolink(this)">🔄 Buscar por email</button>
         </div>
         <div class="card" style="padding:6px"><table>
```

Y en la rama vacía (sin resultados, línea 280) reemplazar:

```javascript
      : `<div class="empty" style="padding:34px"><div class="ic">🏃</div>Todavía no guardaste resultados.<br><span class="dim">Buscá tu nombre arriba para agregar tus carreras.</span></div>`;
```

por:

```javascript
      : `<div class="empty" style="padding:34px"><div class="ic">🏃</div>Todavía no guardaste resultados.<br><span class="dim">Buscá tu nombre arriba, o</span> <button class="btn ghost sm" onclick="manualAutolink(this)" style="margin-top:10px">🔄 Buscar mis resultados por email</button></div>`;
```

- [ ] **Step 5: Implementar `manualAutolink`**

En `cloud/static/app.js`, agregar:

```javascript
async function manualAutolink(btn){
  const orig = btn.textContent; btn.disabled=true; btn.textContent="Buscando…";
  try {
    const d = await api("POST","/api/me/autolink", null, true);
    if(d.linked > 0){ toast(`Vinculamos ${d.linked} resultado${d.linked===1?"":"s"} 🎉`); viewDashboard(); }
    else { toast("No encontramos resultados nuevos con tu email.", "warn"); btn.disabled=false; btn.textContent=orig; }
  } catch(e){ toast(e.message, "warn"); btn.disabled=false; btn.textContent=orig; }
}
```

- [ ] **Step 6: Verificar el flujo completo en el navegador**

Con el server local y un resultado publicado con `email_hash` de `prueba@mail.com`:
1. Registrarse con `prueba@mail.com` → aparece el toast "Vinculamos 1 resultado…" y la carrera figura en "Mis carreras".
2. Publicar otra carrera del mismo email, volver al dashboard, click "🔄 Buscar por email" → toast con el nuevo conteo y la lista se actualiza.
3. Click de nuevo → toast "No encontramos resultados nuevos…".
Expected: los tres comportamientos, sin errores en consola.

- [ ] **Step 7: Commit**

```bash
git add cloud/static/app.js cloud/static/styles.css
git commit -m "feat(portal): toast de auto-vinculación + botón 'Buscar por email' en el dashboard"
```

---

### Task B5: Refinar la página de carrera — podio top-3 y filtro instantáneo por nombre

La página de carrera ya tiene medallas y tabs de distancia. Esta tarea agrega un bloque de podio destacado arriba y un filtro de texto instantáneo (nombre/dorsal) sobre la tabla.

**Files:**
- Modify: `cloud/static/app.js` (`viewRace` / `renderTable`)
- Modify: `cloud/static/styles.css` (estilos del podio y del filtro)

- [ ] **Step 1: Estilar el podio y el filtro**

En `cloud/static/styles.css`, agregar:

```css
  .podium { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin:6px 0 20px; }
  .podium .p { background:var(--panel); border:1px solid var(--border); border-radius:13px; padding:16px 12px; text-align:center; box-shadow:var(--shadow); }
  .podium .p .medal { font-size:26px; }
  .podium .p .nm { font-weight:700; font-size:14px; margin:6px 0 2px; }
  .podium .p .tm { font-family:ui-monospace,monospace; color:var(--acc); font-weight:600; font-size:13px; }
  .podium .p1 { border-color:rgba(0,179,131,.45); }
  .race-filter { width:100%; background:var(--panel2); border:1px solid var(--border); border-radius:9px;
    padding:10px 13px; color:var(--txt); font-size:14px; outline:none; margin-bottom:12px; }
  .race-filter:focus { border-color:var(--acc); box-shadow:0 0 0 3px rgba(0,179,131,.12); }
  @media (max-width:680px){ .podium { grid-template-columns:1fr; } }
```

- [ ] **Step 2: Renderizar el podio y el input de filtro en viewRace**

En `cloud/static/app.js`, en `viewRace`, dentro del template de `$("rc").innerHTML`, insertar el podio y el filtro **antes** de las dist-tabs. Reemplazar el bloque (líneas 398-399):

```javascript
    ${dists.length>1?`<div class="dist-tabs" id="dtabs">${dists.map(d=>`<button class="${d===state.distFilter?'on':''}" onclick="setDist(${d})">${d} km</button>`).join("")}</div>`:""}
    <div class="card" style="padding:6px" id="tbl">${renderTable()}</div>
```

por:

```javascript
    <div id="podium"></div>
    ${dists.length>1?`<div class="dist-tabs" id="dtabs">${dists.map(d=>`<button class="${d===state.distFilter?'on':''}" onclick="setDist(${d})">${d} km</button>`).join("")}</div>`:""}
    <input class="race-filter" id="rfilter" placeholder="🔎 Filtrar por nombre o dorsal…" oninput="filterRace()">
    <div class="card" style="padding:6px" id="tbl">${renderTable()}</div>
```

- [ ] **Step 3: Hacer que renderTable respete el filtro de texto y poblar el podio**

En `cloud/static/app.js`, modificar `renderTable` para filtrar por `state.textFilter`. Reemplazar el inicio de `renderTable` (líneas 370-373):

```javascript
  const renderTable = () => {
    let list = finishers;
    if(dists.length) list = finishers.filter(r=>r.distance_km===state.distFilter);
    list = [...list].sort((a,b)=>(a.net_time_ns||a.finish_time_ns||9e18)-(b.net_time_ns||b.finish_time_ns||9e18));
```

por:

```javascript
  const renderTable = () => {
    let list = finishers;
    if(dists.length) list = finishers.filter(r=>r.distance_km===state.distFilter);
    list = [...list].sort((a,b)=>(a.net_time_ns||a.finish_time_ns||9e18)-(b.net_time_ns||b.finish_time_ns||9e18));
    const tf = (state.textFilter||"").toLowerCase();
    const ranked = list;  // posición = orden por tiempo, antes de filtrar texto
    if(tf) list = list.filter(r=> r.full_name.toLowerCase().includes(tf) || String(r.bib_number).toLowerCase().includes(tf));
```

Y en el `.map` que arma las filas, la posición (`i`) debe basarse en `ranked`, no en la lista filtrada. Reemplazar la línea `const rows = list.map((r,i)=>{` y la línea de posición. Concretamente, cambiar:

```javascript
    const rows = list.map((r,i)=>{
      const idx = race.results.indexOf(r);
      return `<tr>
        <td class="pos ${i<3?'medal'+i:''}">${i<3?["🥇","🥈","🥉"][i]:i+1}</td>
```

por:

```javascript
    const rows = list.map((r)=>{
      const i = ranked.indexOf(r);
      const idx = race.results.indexOf(r);
      return `<tr>
        <td class="pos ${i<3?'medal'+i:''}">${i<3?["🥇","🥈","🥉"][i]:i+1}</td>
```

- [ ] **Step 4: Implementar `filterRace()` y `renderPodium()`**

En `cloud/static/app.js`, agregar después de `setDist` (línea 413):

```javascript
function filterRace(){ const el=document.getElementById("rfilter"); state.textFilter = el?el.value:""; document.getElementById("tbl").innerHTML = state._renderTable(); }
function renderPodium(){
  const el = document.getElementById("podium"); if(!el || !state.curRace) return;
  const fin = state.curRace.results.filter(r=>r.status==="FINISHER" && (state.distFilter==null || r.distance_km===state.distFilter));
  const top = [...fin].sort((a,b)=>(a.net_time_ns||a.finish_time_ns||9e18)-(b.net_time_ns||b.finish_time_ns||9e18)).slice(0,3);
  if(top.length < 3){ el.innerHTML=""; return; }
  const m=["🥇","🥈","🥉"];
  el.innerHTML = `<div class="podium">${top.map((r,i)=>`<div class="p ${i===0?'p1':''}"><div class="medal">${m[i]}</div><div class="nm">${esc(r.full_name)}</div><div class="tm">${fmtNs(r.net_time_ns||r.finish_time_ns)}</div></div>`).join("")}</div>`;
}
```

- [ ] **Step 5: Llamar `renderPodium` al cargar la carrera y al cambiar de distancia**

En `cloud/static/app.js`, al final de `viewRace`, después de `state._renderTable = renderTable;` (línea 411), agregar:

```javascript
  state.textFilter = "";
  renderPodium();
```

Y en `setDist` (línea 413), reemplazar:

```javascript
function setDist(d){ state.distFilter=d; $("tbl").innerHTML = state._renderTable(); document.querySelectorAll("#dtabs button").forEach(b=>b.classList.toggle("on", b.textContent===d+" km")); }
```

por:

```javascript
function setDist(d){ state.distFilter=d; state.textFilter=""; const rf=document.getElementById("rfilter"); if(rf) rf.value=""; $("tbl").innerHTML = state._renderTable(); renderPodium(); document.querySelectorAll("#dtabs button").forEach(b=>b.classList.toggle("on", b.textContent===d+" km")); }
```

- [ ] **Step 6: Verificar en el navegador**

Abrir una carrera con ≥3 finishers en una distancia.
Expected: aparece el podio top-3 arriba (oro/plata/bronce con tiempos). Escribir en el filtro un nombre o dorsal → la tabla se reduce instantáneamente y las posiciones (1, 2, 3…) se mantienen según el tiempo real, no según el orden filtrado. Cambiar de distancia resetea el filtro y actualiza el podio. La sección DNF sigue funcionando.

- [ ] **Step 7: Commit**

```bash
git add cloud/static/app.js cloud/static/styles.css
git commit -m "feat(portal): podio top-3 + filtro instantáneo por nombre/dorsal en la carrera"
```

---

### Task B6: Pase final de pulido y verificación integral

Revisión de coherencia visual en ambos temas y verificación de todos los flujos end-to-end.

**Files:**
- Modify: `cloud/static/styles.css` (ajustes puntuales que surjan)

- [ ] **Step 1: Correr toda la suite del cloud**

Run: `python -m pytest cloud/tests/ -v`
Expected: PASS (todos).

- [ ] **Step 2: Checklist de verificación manual (tema claro y oscuro)**

Levantar el server y recorrer, alternando ◐ en cada vista:
- [ ] Home: hero + búsqueda; legible en claro y oscuro.
- [ ] Búsqueda desde el header funciona desde cualquier vista.
- [ ] Resultados de búsqueda: secciones Carreras y Corredores legibles.
- [ ] Carrera: podio, tabs de distancia, filtro instantáneo, tabla, sección DNF.
- [ ] Registro con email que tiene resultados → toast de vinculación; dashboard muestra las carreras.
- [ ] Botón "🔄 Buscar por email" en el dashboard.
- [ ] Certificado PDF se imprime correctamente (sigue con fondo blanco fijo, independiente del tema).
- [ ] Logout/login.

Anotar cualquier color con bajo contraste en tema claro (texto `--dim` sobre `--panel`, pills) y ajustarlo en `styles.css` si hace falta.

- [ ] **Step 3: Commit (si hubo ajustes)**

```bash
git add cloud/static/styles.css
git commit -m "polish(portal): ajustes de contraste y coherencia en ambos temas"
```

- [ ] **Step 4: Recordatorio de despliegue**

- Pushear la rama → Render auto-deploya `cloud/**`.
- **Rebuild del escritorio con `build.bat`** para que la Tarea A4 (envío de `email_hash`) llegue a los organizadores. Hasta que actualicen y re-publiquen, las carreras viejas no tendrán hash y los corredores usarán el claim manual.

---

## Notas de cierre

- **Riesgo conocido (re-publicación):** `POST /api/publish` borra y recrea los `PublishedResult` de la carrera, lo que cascada-borra los `Claim`. Con la auto-vinculación esto se auto-repara en el próximo login o con el botón manual. No se aborda en este plan (comportamiento preexistente); si se vuelve molesto, una mejora futura es re-vincular por `email_hash` justo después de re-publicar dentro de `publish()`.
- **Privacidad:** el `email_hash` nunca se expone por la API pública (`_result_dict` no lo incluye — verificar que siga así). Se usa solo server-side para el match.
- **DRY del hash:** la fórmula está duplicada (escritorio + cloud) por ser procesos separados; ambos sitios llevan un comentario cruzado. Mantenerlos sincronizados.
- **Deferido (menor):** el mockup del spec muestra la sección "No finalizaron" como colapsable. En este plan queda como sección fija al final de la carrera (ya existente, re-estilada por los tokens). Si se quiere colapsable, es un toggle trivial a sumar en una iteración posterior — no bloquea el rediseño.
