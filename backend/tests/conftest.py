import os
import asyncio
import tempfile
import pytest

# Apuntar la DB del escritorio a un archivo temporal ANTES de importar backend.*
_tmp = tempfile.NamedTemporaryFile(prefix="ct_desktop_test_", suffix=".db", delete=False)
_tmp.close()
os.environ["CT_DESKTOP_DB"] = _tmp.name

from fastapi.testclient import TestClient  # noqa: E402
from backend.main import app  # noqa: E402
from backend.core.database import engine  # noqa: E402
from backend.models.models import Base  # noqa: E402
from backend.services.timing_engine import reset_engines  # noqa: E402


@pytest.fixture(autouse=True)
def _fresh_db():
    """Cada test arranca con tablas limpias y sin engines de timing en memoria."""
    async def reset():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        # Las conexiones del pool quedan atadas a este event loop (que muere acá);
        # se descartan para que el loop del TestClient cree las suyas.
        await engine.dispose()
    asyncio.run(reset())
    reset_engines()
    yield


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def make_runner(client, first="Ana", last="Gomez", **extra):
    r = client.post("/api/v1/runners", json={"first_name": first, "last_name": last, **extra})
    assert r.status_code == 201, r.text
    return r.json()


def make_race(client, name="Carrera Test", **extra):
    r = client.post("/api/v1/races", json={"name": name, **extra})
    assert r.status_code == 201, r.text
    return r.json()


def register(client, race_id, runner_id, bib="7", distance_km=10.0):
    r = client.post(f"/api/v1/races/{race_id}/registrations", json={
        "runner_id": runner_id, "race_id": race_id,
        "bib_number": bib, "distance_km": distance_km,
    })
    assert r.status_code == 201, r.text
    return r.json()
