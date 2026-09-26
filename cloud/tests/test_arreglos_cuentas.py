"""Regresiones de cuentas (revisión): ids reutilizados, toma de cuenta previa
vía Google, admins de CT_ADMIN_EMAILS y login CSRF del flujo web de Google."""
import time
import urllib.parse

from fastapi.testclient import TestClient
from sqlalchemy import select

import cloud.google_auth as ga
from cloud.main import _ensure_admins, app
from cloud.models import PortalUser
from cloud.security import make_token
from cloud.tests.conftest import make_user


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


# ── 5. Ids reutilizados ───────────────────────────────────────────────────────

def test_registro_fija_tokens_valid_from(client, db):
    antes = int(time.time())
    make_user(client, email="alta@test.com")
    u = db.scalar(select(PortalUser).where(PortalUser.email == "alta@test.com"))
    assert u.tokens_valid_from is not None and u.tokens_valid_from >= antes


def test_token_anterior_al_alta_no_abre_la_cuenta(client, db):
    """Simula un token viejo de una cuenta borrada con el mismo id: tiene un
    iat anterior al alta de la cuenta actual."""
    make_user(client, email="reuso@test.com")
    u = db.scalar(select(PortalUser).where(PortalUser.email == "reuso@test.com"))
    viejo = make_token(u.id, iat=u.tokens_valid_from - 3600)
    assert client.get("/api/run/profile", headers=_auth(viejo)).status_code == 401


def test_token_del_mismo_segundo_del_alta_vale(client, db):
    make_user(client, email="mismoseg@test.com")
    u = db.scalar(select(PortalUser).where(PortalUser.email == "mismoseg@test.com"))
    tok = make_token(u.id, iat=u.tokens_valid_from)
    assert client.get("/api/run/profile", headers=_auth(tok)).status_code == 200


def test_alta_por_google_fija_tokens_valid_from(db):
    antes = int(time.time())
    u = ga.upsert_google_user(db, sub="g-alta", email="galta@test.com", name=None, picture=None)
    assert u.tokens_valid_from is not None and u.tokens_valid_from >= antes


def test_portal_users_usa_autoincrement_en_bases_nuevas():
    from cloud.models import PortalUser as PU
    assert PU.__table__.dialect_options["sqlite"]["autoincrement"] is True


# ── 6. Toma de cuenta previa ──────────────────────────────────────────────────

def test_vincular_google_anula_la_contrasenia_y_las_sesiones_del_que_registro(client, db, monkeypatch):
    # El atacante registra el email de la víctima (el registro no lo verifica).
    r = client.post("/api/auth/register", json={
        "email": "victima@test.com", "password": "delatacante1", "full_name": "X"})
    token_atacante = r.json()["token"]
    assert client.get("/api/run/profile", headers=_auth(token_atacante)).status_code == 200

    # La víctima entra con Google (email verificado por Google).
    monkeypatch.setattr(ga, "exchange_code", lambda code: {
        "sub": "g-victima", "email": "victima@test.com", "email_verified": True, "name": "Víctima"})
    r = client.get("/api/run/auth/google/callback",
                   params={"state": ga.make_state("liverun://auth"), "code": "c"},
                   follow_redirects=False)
    assert r.status_code == 302
    q = urllib.parse.parse_qs(urllib.parse.urlparse(r.headers["location"]).query)
    token_victima = q["token"][0]

    # El atacante perdió la contraseña y su sesión; la víctima entra.
    assert client.post("/api/auth/login", json={
        "email": "victima@test.com", "password": "delatacante1"}).status_code == 401
    assert client.get("/api/run/profile", headers=_auth(token_atacante)).status_code == 401
    assert client.get("/api/run/profile", headers=_auth(token_victima)).status_code == 200


def test_admin_solo_se_promueve_con_google(client, db, monkeypatch):
    monkeypatch.setenv("CT_ADMIN_EMAILS", "jefe@test.com, otro@test.com")
    make_user(client, email="jefe@test.com")          # sin Google: email no verificado
    _ensure_admins()
    u = db.scalar(select(PortalUser).where(PortalUser.email == "jefe@test.com"))
    assert not u.is_admin

    u.google_id = "g-jefe"
    db.commit()
    _ensure_admins()
    db.refresh(u)
    assert u.is_admin


def test_admin_se_revoca_si_sale_de_la_lista(client, db, monkeypatch):
    make_user(client, email="exadmin@test.com")
    u = db.scalar(select(PortalUser).where(PortalUser.email == "exadmin@test.com"))
    u.google_id = "g-ex"
    u.is_admin = 1
    db.commit()
    monkeypatch.setenv("CT_ADMIN_EMAILS", "otro@test.com")
    _ensure_admins()
    db.refresh(u)
    assert not u.is_admin

    u.is_admin = 1
    db.commit()
    monkeypatch.delenv("CT_ADMIN_EMAILS", raising=False)
    _ensure_admins()
    db.refresh(u)
    assert not u.is_admin


def test_login_google_de_email_admin_lo_promueve(db, monkeypatch):
    monkeypatch.setenv("CT_ADMIN_EMAILS", "gadmin@test.com")
    u = ga.upsert_google_user(db, sub="g-adm", email="gadmin@test.com", name=None, picture=None)
    assert u.is_admin


# ── 7. Login CSRF del flujo web ───────────────────────────────────────────────

def _state_de(location: str) -> str:
    return urllib.parse.parse_qs(urllib.parse.urlparse(location).query)["state"][0]


def _config_google(monkeypatch):
    monkeypatch.setattr(ga, "GOOGLE_CLIENT_ID", "cid")
    monkeypatch.setattr(ga, "GOOGLE_CLIENT_SECRET", "secret")
    monkeypatch.setattr(ga, "exchange_code", lambda code: {
        "sub": "g-web", "email": "web@test.com", "email_verified": True, "name": "Web"})


def test_flujo_web_exige_la_cookie_del_navegador_que_lo_empezo(monkeypatch):
    _config_google(monkeypatch)
    web = ga.PUBLIC_URL + "/"
    atacante = TestClient(app)
    r = atacante.get("/api/run/auth/google/start", params={"app_redirect": web},
                     follow_redirects=False)
    assert r.status_code == 302
    assert ga.NONCE_COOKIE in r.headers.get("set-cookie", "")
    state = _state_de(r.headers["location"])

    # La víctima abre el callback que le pasó el atacante: sin su cookie, 400.
    victima = TestClient(app)
    r = victima.get("/api/run/auth/google/callback", params={"state": state, "code": "c"},
                    follow_redirects=False)
    assert r.status_code == 400

    # El mismo navegador que arrancó el login sí completa.
    r = atacante.get("/api/run/auth/google/callback", params={"state": state, "code": "c"},
                     follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"].startswith(web) and "token=" in r.headers["location"]


def test_state_web_sin_nonce_no_sirve():
    """Un state web armado sin nonce (p. ej. de antes del arreglo) se rechaza."""
    state = ga.make_state(ga.PUBLIC_URL + "/")
    assert ga.verify_state(state) is None
    assert ga.verify_state(state, browser_nonce="cualquiera") is None


def test_flujo_de_app_no_requiere_cookie(monkeypatch):
    """App móvil y escritorio siguen sin cookie (ver google_start)."""
    _config_google(monkeypatch)
    for destino in ("liverun://auth", "http://127.0.0.1:53111/cb"):
        c = TestClient(app)
        r = c.get("/api/run/auth/google/start", params={"app_redirect": destino},
                  follow_redirects=False)
        assert ga.NONCE_COOKIE not in r.headers.get("set-cookie", "")
        r = TestClient(app).get("/api/run/auth/google/callback",
                                params={"state": _state_de(r.headers["location"]), "code": "c"},
                                follow_redirects=False)
        assert r.status_code == 302 and "token=" in r.headers["location"]
