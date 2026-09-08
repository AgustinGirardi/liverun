"""Login con Google: state firmado, vinculación de cuentas y callback."""
import pytest
from sqlalchemy import select

import cloud.google_auth as ga
from cloud.models import PortalUser
from cloud.tests.conftest import make_user


# ── state ─────────────────────────────────────────────────────────────────────

def test_state_roundtrip():
    s = ga.make_state("liverun://auth")
    assert ga.verify_state(s) == "liverun://auth"


def test_state_adulterado_o_vencido():
    s = ga.make_state("liverun://auth")
    assert ga.verify_state(s + "x") is None
    vencido = ga.make_state("liverun://auth", now=0)  # expiró hace décadas
    assert ga.verify_state(vencido) is None


def test_state_rechaza_esquemas_no_permitidos():
    assert ga.verify_state(ga.make_state("https://evil.com/phish")) is None
    assert not ga.valid_app_redirect("javascript:alert(1)")
    assert ga.valid_app_redirect("chronotrackrun://auth")


def test_expo_apagado_por_defecto(monkeypatch):
    """exp:// puede apuntar a cualquier proyecto de Expo Go, y el callback vuelve
    con el token en la query: aceptarlo era regalar la sesión a quien armara el
    link. Queda apagado salvo que se encienda a mano en desarrollo."""
    assert not ga.valid_app_redirect("exp://cualquier-proyecto.expo.dev/--/cb")
    assert not ga.valid_app_redirect("exps://192.168.0.99:8081/--/auth")
    # …y el state tampoco lo firma, así que no hay forma de colarlo por el callback.
    assert ga.verify_state(ga.make_state("exp://evil.expo.dev/--/cb")) is None


def test_expo_se_puede_encender_para_desarrollo(monkeypatch):
    monkeypatch.setattr(ga, "ALLOWED_SCHEMES", ga.ALLOWED_SCHEMES + ("exp", "exps"))
    assert ga.valid_app_redirect("exp://192.168.0.99:8081/--/auth")


def test_redirect_al_propio_portal_permitido():
    assert ga.valid_app_redirect(ga.PUBLIC_URL + "/")
    assert ga.valid_app_redirect(ga.PUBLIC_URL + "/?cualquier=cosa")
    # Mismo host con otro esquema u otro host: no.
    assert not ga.valid_app_redirect("http://" + ga.PUBLIC_URL.split("://", 1)[1])
    assert not ga.valid_app_redirect("https://chronotrack-portal.onrender.com.evil.com/")


def test_redirect_loopback_escritorio_permitido():
    assert ga.valid_app_redirect("http://127.0.0.1:8001/api/v1/account/google/callback")
    assert ga.valid_app_redirect("http://localhost:5173/cb")
    # Loopback solo por http y solo al host local; nada de IPs externas.
    assert not ga.valid_app_redirect("http://192.168.0.50:8001/cb")
    assert not ga.valid_app_redirect("https://127.0.0.1.evil.com/cb")


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
        params={"app_redirect": "liverun://auth"},
        follow_redirects=False,
    )
    assert r.status_code == 302
    assert r.headers["location"].startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    assert "state=" in r.headers["location"]


def test_start_sin_config_da_503(client, monkeypatch):
    monkeypatch.setattr(ga, "GOOGLE_CLIENT_ID", "")
    r = client.get("/api/run/auth/google/start", params={"app_redirect": "liverun://auth"})
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
    state = ga.make_state("liverun://auth")
    r = client.get(
        "/api/run/auth/google/callback",
        params={"state": state, "code": "abc"},
        follow_redirects=False,
    )
    assert r.status_code == 302
    loc = r.headers["location"]
    assert loc.startswith("liverun://auth?")
    assert "token=" in loc and "email=ana%40test.com" in loc


def test_callback_con_error_de_google_vuelve_con_error(client):
    state = ga.make_state("liverun://auth")
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
