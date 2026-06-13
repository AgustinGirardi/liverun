"""Login con Google: state firmado, vinculación de cuentas y callback."""
import pytest
from sqlalchemy import select

import cloud.google_auth as ga
from cloud.models import PortalUser
from cloud.tests.conftest import make_user


# ── state ─────────────────────────────────────────────────────────────────────

def test_state_roundtrip():
    s = ga.make_state("exp://192.168.0.99:8081/--/auth")
    assert ga.verify_state(s) == "exp://192.168.0.99:8081/--/auth"


def test_state_adulterado_o_vencido():
    s = ga.make_state("exp://host/--/auth")
    assert ga.verify_state(s + "x") is None
    vencido = ga.make_state("exp://host/--/auth", now=0)  # expiró hace décadas
    assert ga.verify_state(vencido) is None


def test_state_rechaza_esquemas_no_permitidos():
    assert ga.verify_state(ga.make_state("https://evil.com/phish")) is None
    assert not ga.valid_app_redirect("javascript:alert(1)")
    assert ga.valid_app_redirect("chronotrackrun://auth")


def test_redirect_al_propio_portal_permitido():
    assert ga.valid_app_redirect(ga.PUBLIC_URL + "/")
    assert ga.valid_app_redirect(ga.PUBLIC_URL + "/?cualquier=cosa")
    # Mismo host con otro esquema u otro host: no.
    assert not ga.valid_app_redirect("http://" + ga.PUBLIC_URL.split("://", 1)[1])
    assert not ga.valid_app_redirect("https://chronotrack-portal.onrender.com.evil.com/")


# ── upsert ────────────────────────────────────────────────────────────────────

def test_upsert_crea_usuario_nuevo(db):
    u = ga.upsert_google_user(db, sub="g-123", email="Nuevo@Test.com", name="Nuevo Runner", picture=None)
    assert u.email == "nuevo@test.com"
    assert u.google_id == "g-123"
    assert u.full_name == "Nuevo Runner"


def test_upsert_vincula_cuenta_de_portal_existente(client, db):
    make_user(client, email="runner@test.com", full_name="Runner Portal")
    u = ga.upsert_google_user(db, sub="g-9", email="runner@test.com", name="Otro Nombre", picture="http://p/x.png")
    # Es la MISMA cuenta (no se duplica) y conserva su nombre original.
    assert db.scalar(select(PortalUser).where(PortalUser.email == "runner@test.com")).id == u.id
    assert u.google_id == "g-9"
    assert u.full_name == "Runner Portal"
    assert u.avatar_url == "http://p/x.png"


def test_upsert_segundo_login_encuentra_por_google_id(db):
    a = ga.upsert_google_user(db, sub="g-1", email="a@test.com", name=None, picture=None)
    b = ga.upsert_google_user(db, sub="g-1", email="cambio@test.com", name=None, picture=None)
    assert a.id == b.id  # manda el google_id, no el email


# ── endpoints ─────────────────────────────────────────────────────────────────

def test_start_redirige_a_google(client, monkeypatch):
    monkeypatch.setattr(ga, "GOOGLE_CLIENT_ID", "cid")
    monkeypatch.setattr(ga, "GOOGLE_CLIENT_SECRET", "secret")
    r = client.get(
        "/api/run/auth/google/start",
        params={"app_redirect": "exp://host/--/auth"},
        follow_redirects=False,
    )
    assert r.status_code == 302
    assert r.headers["location"].startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    assert "state=" in r.headers["location"]


def test_start_sin_config_da_503(client, monkeypatch):
    monkeypatch.setattr(ga, "GOOGLE_CLIENT_ID", "")
    r = client.get("/api/run/auth/google/start", params={"app_redirect": "exp://host/--/auth"})
    assert r.status_code == 503


def test_start_rechaza_redirect_invalido(client, monkeypatch):
    monkeypatch.setattr(ga, "GOOGLE_CLIENT_ID", "cid")
    monkeypatch.setattr(ga, "GOOGLE_CLIENT_SECRET", "secret")
    r = client.get("/api/run/auth/google/start", params={"app_redirect": "https://evil.com"})
    assert r.status_code == 400


def test_callback_feliz_devuelve_token_al_deep_link(client, monkeypatch):
    monkeypatch.setattr(ga, "exchange_code", lambda code: {
        "sub": "g-55", "email": "ana@test.com", "email_verified": True, "name": "Ana",
    })
    state = ga.make_state("exp://host/--/auth")
    r = client.get(
        "/api/run/auth/google/callback",
        params={"state": state, "code": "abc"},
        follow_redirects=False,
    )
    assert r.status_code == 302
    loc = r.headers["location"]
    assert loc.startswith("exp://host/--/auth?")
    assert "token=" in loc and "email=ana%40test.com" in loc


def test_callback_con_error_de_google_vuelve_con_error(client):
    state = ga.make_state("exp://host/--/auth")
    r = client.get(
        "/api/run/auth/google/callback",
        params={"state": state, "error": "access_denied"},
        follow_redirects=False,
    )
    assert r.status_code == 302
    assert "error=access_denied" in r.headers["location"]


def test_callback_state_invalido_400(client):
    r = client.get("/api/run/auth/google/callback", params={"state": "trucho", "code": "x"})
    assert r.status_code == 400
