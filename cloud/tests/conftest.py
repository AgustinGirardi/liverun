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
from cloud.main import app, _RATE  # noqa: E402


@pytest.fixture(autouse=True)
def _fresh_db():
    """Cada test arranca con tablas limpias y sin estado de rate-limit."""
    _RATE.clear()
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
