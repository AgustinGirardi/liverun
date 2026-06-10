"""Integridad referencial: SQLite necesita PRAGMA foreign_keys=ON en CADA conexión."""
import asyncio

from sqlalchemy import text

from backend.core.database import engine, AsyncSessionLocal
from backend.tests.conftest import make_runner, make_race, register


def test_foreign_keys_enabled_on_every_connection():
    async def check():
        async with AsyncSessionLocal() as s:
            value = (await s.execute(text("PRAGMA foreign_keys"))).scalar()
        await engine.dispose()
        return value
    assert asyncio.run(check()) == 1


def test_delete_runner_with_registrations_returns_409(client):
    runner = make_runner(client)
    race = make_race(client)
    register(client, race["id"], runner["id"])

    resp = client.delete(f"/api/v1/runners/{runner['id']}")
    assert resp.status_code == 409

    # La inscripción sigue intacta (no quedó huérfana)
    regs = client.get(f"/api/v1/races/{race['id']}/registrations").json()
    assert len(regs) == 1


def test_delete_runner_without_registrations_ok(client):
    runner = make_runner(client)
    resp = client.delete(f"/api/v1/runners/{runner['id']}")
    assert resp.status_code == 204
