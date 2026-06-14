"""Acceso premium (prueba/premium/admin) y endpoints de administración."""
from datetime import datetime, timedelta

from sqlalchemy import select

from cloud.models import PortalUser
from cloud.run import access_status, TRIAL_DAYS
from cloud.tests.conftest import make_user

NOW = datetime(2026, 6, 12)


# ── Lógica pura de acceso ─────────────────────────────────────────────────────

def test_prueba_activa_recien_creado():
    acc = access_status(False, NOW - timedelta(days=10), None, NOW)
    assert acc["access"] is True and acc["plan"] == "trial"


def test_prueba_vencida_sin_premium():
    acc = access_status(False, NOW - timedelta(days=TRIAL_DAYS + 1), None, NOW)
    assert acc["access"] is False and acc["plan"] == "expired"


def test_premium_pagado_da_acceso_aunque_venza_la_prueba():
    acc = access_status(False, NOW - timedelta(days=400), NOW + timedelta(days=30), NOW)
    assert acc["access"] is True and acc["plan"] == "premium"


def test_admin_es_ilimitado():
    acc = access_status(True, NOW - timedelta(days=9999), None, NOW)
    assert acc["access"] is True and acc["plan"] == "admin"


# ── Perfil expone el acceso ───────────────────────────────────────────────────

def test_profile_incluye_acceso(client):
    h = make_user(client)
    p = client.get("/api/run/profile", headers=h).json()
    assert p["access"] is True and p["plan"] == "trial"
    assert p["is_admin"] is False and p["trial_ends_at"]


# ── Admin ─────────────────────────────────────────────────────────────────────

def _make_admin(client, db, email="admin@test.com"):
    h = make_user(client, email=email, username="boss")
    u = db.scalar(select(PortalUser).where(PortalUser.email == email))
    u.is_admin = 1
    db.commit()
    return h


def test_no_admin_no_entra(client):
    h = make_user(client)
    assert client.get("/api/run/admin/users", headers=h).status_code == 403


def test_admin_lista_y_busca_usuarios(client, db):
    ha = _make_admin(client, db)
    make_user(client, email="ana@test.com", full_name="Ana Gomez", username="ana")
    out = client.get("/api/run/admin/users", headers=ha).json()
    assert out["total"] >= 2
    res = client.get("/api/run/admin/users?q=gomez", headers=ha).json()
    assert [u["email"] for u in res["users"]] == ["ana@test.com"]


def test_admin_otorga_y_revoca_premium(client, db):
    ha = _make_admin(client, db)
    ana = db.scalar(select(PortalUser).where(PortalUser.email == "ana@test.com")) \
        if db.scalar(select(PortalUser).where(PortalUser.email == "ana@test.com")) else None
    make_user(client, email="ana@test.com", username="ana")
    ana = db.scalar(select(PortalUser).where(PortalUser.email == "ana@test.com"))

    r = client.post(f"/api/run/admin/users/{ana.id}/grant", json={"months": 3}, headers=ha).json()
    assert r["plan"] == "premium" and r["premium_until"]

    r = client.post(f"/api/run/admin/users/{ana.id}/grant", json={"unlimited": True}, headers=ha).json()
    assert r["plan"] == "premium"

    r = client.post(f"/api/run/admin/users/{ana.id}/grant", json={"revoke": True}, headers=ha).json()
    assert r["premium_until"] is None


def test_admin_grant_usuario_inexistente_404(client, db):
    ha = _make_admin(client, db)
    assert client.post("/api/run/admin/users/99999/grant", json={"months": 1}, headers=ha).status_code == 404
