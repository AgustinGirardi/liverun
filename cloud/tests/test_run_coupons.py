"""Cupones: creación por admin, canje por usuario, límites y validaciones."""
from datetime import datetime, timedelta

from sqlalchemy import select

from cloud.models import Coupon, PortalUser
from cloud.run import coupon_redeemable
from cloud.tests.conftest import make_user

NOW = datetime(2026, 6, 12)


def _admin(client, db, email="admin@test.com"):
    h = make_user(client, email=email, username="boss")
    u = db.scalar(select(PortalUser).where(PortalUser.email == email))
    u.is_admin = 1
    db.commit()
    return h


# ── Lógica pura de validez ────────────────────────────────────────────────────

def test_redeemable_ok():
    c = Coupon(code="X", kind="free_months", months=1, active=1, redeemed_count=0)
    assert coupon_redeemable(c, already=False, now=NOW) is None


def test_redeemable_inexistente_inactivo_vencido_y_repetido():
    assert coupon_redeemable(None, False, NOW)
    assert coupon_redeemable(Coupon(active=0), False, NOW)
    assert coupon_redeemable(Coupon(active=1, expires_at=NOW - timedelta(days=1)), False, NOW)
    assert coupon_redeemable(Coupon(active=1), True, NOW)  # ya canjeado


def test_redeemable_maximo_alcanzado():
    c = Coupon(active=1, max_redemptions=2, redeemed_count=2)
    assert coupon_redeemable(c, False, NOW)


# ── Admin crea cupones ────────────────────────────────────────────────────────

def test_admin_crea_cupon_meses_y_descuento(client, db):
    ha = _admin(client, db)
    r = client.post("/api/run/admin/coupons", json={"code": "verano26", "kind": "free_months", "months": 2}, headers=ha)
    assert r.status_code == 200 and r.json()["code"] == "VERANO26"
    r = client.post("/api/run/admin/coupons", json={"code": "promo50a", "kind": "discount", "percent_off": 50}, headers=ha)
    assert r.status_code == 200 and r.json()["percent_off"] == 50


def test_admin_cupon_validaciones(client, db):
    ha = _admin(client, db)
    assert client.post("/api/run/admin/coupons", json={"code": "ab", "kind": "free_months", "months": 1}, headers=ha).status_code == 422  # min_length Pydantic
    assert client.post("/api/run/admin/coupons", json={"code": "bad code", "kind": "free_months", "months": 1}, headers=ha).status_code == 400  # regex (espacio)
    assert client.post("/api/run/admin/coupons", json={"code": "nomonths", "kind": "free_months"}, headers=ha).status_code == 400
    client.post("/api/run/admin/coupons", json={"code": "duplica1", "kind": "free_months", "months": 1}, headers=ha)
    assert client.post("/api/run/admin/coupons", json={"code": "duplica1", "kind": "free_months", "months": 1}, headers=ha).status_code == 409


def test_no_admin_no_crea_cupones(client):
    h = make_user(client)
    assert client.post("/api/run/admin/coupons", json={"code": "hackear1", "kind": "free_months", "months": 1}, headers=h).status_code == 403


# ── Usuario canjea ────────────────────────────────────────────────────────────

def test_canje_meses_suma_premium(client, db):
    ha = _admin(client, db)
    client.post("/api/run/admin/coupons", json={"code": "regalo03", "kind": "free_months", "months": 3}, headers=ha)
    h = make_user(client, email="corredor@test.com")
    r = client.post("/api/run/coupons/redeem", json={"code": "regalo03"}, headers=h)
    assert r.status_code == 200 and r.json()["months"] == 3
    p = client.get("/api/run/profile", headers=h).json()
    assert p["plan"] == "premium" and p["premium_until"]


def test_canje_descuento_deja_pendiente(client, db):
    ha = _admin(client, db)
    client.post("/api/run/admin/coupons", json={"code": "off25pct", "kind": "discount", "percent_off": 25}, headers=ha)
    h = make_user(client, email="c2@test.com")
    r = client.post("/api/run/coupons/redeem", json={"code": "off25pct"}, headers=h)
    assert r.status_code == 200 and r.json()["percent_off"] == 25
    u = db.scalar(select(PortalUser).where(PortalUser.email == "c2@test.com"))
    assert u.pending_discount_percent == 25


def test_no_se_puede_canjear_dos_veces(client, db):
    ha = _admin(client, db)
    client.post("/api/run/admin/coupons", json={"code": "unavez01", "kind": "free_months", "months": 1}, headers=ha)
    h = make_user(client, email="c3@test.com")
    assert client.post("/api/run/coupons/redeem", json={"code": "unavez01"}, headers=h).status_code == 200
    assert client.post("/api/run/coupons/redeem", json={"code": "unavez01"}, headers=h).status_code == 400


def test_canje_concurrente_no_supera_el_maximo(client, db, monkeypatch):
    """Simula la carrera check-then-increment: aunque el fast-path de
    coupon_redeemable pase (dos requests leyeron el contador antes del
    incremento de la otra), el UPDATE condicional no deja superar el tope."""
    import cloud.run as run_mod
    ha = _admin(client, db)
    client.post("/api/run/admin/coupons",
                json={"code": "carrera1", "kind": "free_months", "months": 1, "max_redemptions": 1},
                headers=ha)
    h1 = make_user(client, email="r1@test.com")
    h2 = make_user(client, email="r2@test.com")
    assert client.post("/api/run/coupons/redeem", json={"code": "carrera1"}, headers=h1).status_code == 200
    # Segunda request que "ya pasó" el chequeo previo (carrera simulada).
    monkeypatch.setattr(run_mod, "coupon_redeemable", lambda *a, **k: None)
    r = client.post("/api/run/coupons/redeem", json={"code": "carrera1"}, headers=h2)
    assert r.status_code == 400
    c = db.scalar(select(Coupon).where(Coupon.code == "CARRERA1"))
    assert c.redeemed_count == 1  # no se pasó del tope


def test_canje_repetido_mismo_usuario_en_carrera_da_400_no_500(client, db, monkeypatch):
    """Mismo usuario, request que saltea el fast-path `already` (carrera):
    el INSERT duplicado de la redención debe caer en el try/except del commit
    (400 limpio), no en un 500 por el autoflush del UPDATE del contador."""
    import cloud.run as run_mod
    ha = _admin(client, db)
    client.post("/api/run/admin/coupons",
                json={"code": "duplica1", "kind": "free_months", "months": 1}, headers=ha)
    h = make_user(client, email="dup@test.com")
    assert client.post("/api/run/coupons/redeem", json={"code": "duplica1"}, headers=h).status_code == 200
    monkeypatch.setattr(run_mod, "coupon_redeemable", lambda *a, **k: None)  # simula el race
    r = client.post("/api/run/coupons/redeem", json={"code": "duplica1"}, headers=h)
    assert r.status_code == 400
    c = db.scalar(select(Coupon).where(Coupon.code == "DUPLICA1"))
    assert c.redeemed_count == 1  # el rollback deshizo el segundo incremento


def test_canje_respeta_maximo_y_toggle(client, db):
    ha = _admin(client, db)
    cid = client.post("/api/run/admin/coupons",
                      json={"code": "limite01", "kind": "free_months", "months": 1, "max_redemptions": 1}, headers=ha).json()["id"]
    h1 = make_user(client, email="u1@test.com")
    h2 = make_user(client, email="u2@test.com")
    assert client.post("/api/run/coupons/redeem", json={"code": "limite01"}, headers=h1).status_code == 200
    assert client.post("/api/run/coupons/redeem", json={"code": "limite01"}, headers=h2).status_code == 400  # máximo
    # toggle desactiva
    client.post(f"/api/run/admin/coupons/{cid}/toggle", headers=ha)
    h3 = make_user(client, email="u3@test.com")
    assert client.post("/api/run/coupons/redeem", json={"code": "limite01"}, headers=h3).status_code == 400


def test_canje_codigo_inexistente(client):
    h = make_user(client)
    assert client.post("/api/run/coupons/redeem", json={"code": "NOEXISTE"}, headers=h).status_code == 400
