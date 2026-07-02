"""Borrado de cuenta (requisito App Store 5.1.1(v) / Google Play)."""
from sqlalchemy import select

from cloud import billing
from cloud.models import (
    Activity, BillingSubscription, Claim, Friendship, PortalUser,
)
from cloud.tests.conftest import make_user, publish_race


def test_borra_cuenta_y_todos_sus_datos(client, db):
    headers = make_user(client, email="borrame@test.com", username="borrame")
    other = make_user(client, email="amigo@test.com", username="amigo")

    # Datos colgados de la cuenta: salida, amistad y claim de un resultado.
    r = client.post("/api/run/activities", headers=headers, json={
        "client_uuid": "uuid-1", "started_at": "2026-06-01T10:00:00Z",
        "duration_s": 1800, "distance_m": 5000,
    })
    assert r.status_code == 200
    r = client.post("/api/run/friends/request", headers=headers, json={"username": "amigo"})
    assert r.status_code == 200
    publish_race(client, results=[{
        "bib_number": "42", "full_name": "Test Runner", "distance_km": 10.0,
        "net_time_ns": 3_600_000_000_000, "position": 1, "status": "FINISHER",
    }])
    r = client.post("/api/claim", headers=headers,
                    json={"code": publish_code(client), "bib_number": "42", "last_name": "Runner"})
    # el claim puede fallar por matching de nombre; no es el foco del test
    uid = db.scalar(select(PortalUser.id).where(PortalUser.email == "borrame@test.com"))

    r = client.delete("/api/auth/account", headers=headers)
    assert r.status_code == 200
    assert r.json() == {"deleted": True}

    # No queda NADA del usuario…
    assert db.scalar(select(PortalUser).where(PortalUser.id == uid)) is None
    assert db.scalar(select(Activity).where(Activity.user_id == uid)) is None
    assert db.scalar(select(Claim).where(Claim.user_id == uid)) is None
    assert db.scalar(select(Friendship).where(
        (Friendship.requester_id == uid) | (Friendship.addressee_id == uid))) is None
    # …y el token deja de servir.
    assert client.get("/api/run/profile", headers=headers).status_code == 401
    # El otro usuario sigue intacto.
    assert client.get("/api/run/profile", headers=other).status_code == 200


def publish_code(client):
    """Código de la única carrera publicada."""
    races = client.get("/api/races").json()
    return races[0]["code"] if races else "XXXXXX"


def test_borrar_cancela_la_suscripcion_de_mp(client, db, monkeypatch):
    headers = make_user(client, email="premium@test.com")
    uid = db.scalar(select(PortalUser.id).where(PortalUser.email == "premium@test.com"))
    db.add(BillingSubscription(user_id=uid, mp_preapproval_id="pre-123", status="authorized"))
    db.commit()

    cancelled = []
    monkeypatch.setattr(billing, "MP_ACCESS_TOKEN", "test-token")
    monkeypatch.setattr(billing, "mp_request",
                        lambda method, path, body=None: cancelled.append((method, path, body)) or {})

    r = client.delete("/api/auth/account", headers=headers)
    assert r.status_code == 200
    assert cancelled == [("PUT", "/preapproval/pre-123", {"status": "cancelled"})]
    assert db.scalar(select(BillingSubscription).where(BillingSubscription.user_id == uid)) is None


def test_borrar_sigue_aunque_mp_falle(client, db, monkeypatch):
    headers = make_user(client, email="premium2@test.com")
    uid = db.scalar(select(PortalUser.id).where(PortalUser.email == "premium2@test.com"))
    db.add(BillingSubscription(user_id=uid, mp_preapproval_id="pre-456", status="authorized"))
    db.commit()

    def boom(method, path, body=None):
        raise billing.MPError("MP caído")

    monkeypatch.setattr(billing, "MP_ACCESS_TOKEN", "test-token")
    monkeypatch.setattr(billing, "mp_request", boom)

    r = client.delete("/api/auth/account", headers=headers)
    assert r.status_code == 200
    assert db.scalar(select(PortalUser).where(PortalUser.id == uid)) is None


def test_requiere_autenticacion(client):
    assert client.delete("/api/auth/account").status_code == 401
