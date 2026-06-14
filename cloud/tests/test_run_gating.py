"""Muro premium: el ranking mundial requiere acceso; el de amigos es gratis."""
from datetime import datetime, timedelta

from sqlalchemy import select

from cloud.models import PortalUser
from cloud.run import TRIAL_DAYS
from cloud.tests.conftest import make_user


def _expire_trial(db, email):
    """Vence la prueba: empuja created_at más allá del período de prueba."""
    u = db.scalar(select(PortalUser).where(PortalUser.email == email))
    u.created_at = datetime.utcnow() - timedelta(days=TRIAL_DAYS + 5)
    db.commit()
    return u


def test_mundial_libre_durante_la_prueba(client):
    h = make_user(client, username="nuevo")
    # Recién creado: prueba vigente → puede ver el mundial.
    assert client.get("/api/run/ranking?scope=global", headers=h).status_code == 200


def test_mundial_bloqueado_si_vencio_la_prueba(client, db):
    h = make_user(client, email="viejo@test.com", username="viejo")
    _expire_trial(db, "viejo@test.com")
    r = client.get("/api/run/ranking?scope=global", headers=h)
    assert r.status_code == 402
    assert "premium" in r.json()["detail"].lower()


def test_amigos_siempre_gratis_aunque_venza(client, db):
    h = make_user(client, email="viejo2@test.com", username="viejo2")
    _expire_trial(db, "viejo2@test.com")
    # El ranking de amigos sigue disponible sin premium.
    assert client.get("/api/run/ranking?scope=friends", headers=h).status_code == 200


def test_mundial_con_premium_pagado(client, db):
    h = make_user(client, email="pago@test.com", username="pago")
    u = _expire_trial(db, "pago@test.com")
    u.premium_until = datetime.utcnow() + timedelta(days=10)
    db.commit()
    assert client.get("/api/run/ranking?scope=global", headers=h).status_code == 200


def test_mundial_para_admin(client, db):
    h = make_user(client, email="admin@test.com", username="adm")
    u = _expire_trial(db, "admin@test.com")
    u.is_admin = 1
    db.commit()
    assert client.get("/api/run/ranking?scope=global", headers=h).status_code == 200
