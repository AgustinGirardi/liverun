"""Verificación de email y "olvidé mi contraseña": mails, tokens, endpoints,
reglas de Google/admin/autolink y la migración de la columna nueva."""
import base64
import hashlib
import json
import time
import urllib.parse

import pytest
from sqlalchemy import create_engine, select, text

import cloud.google_auth as ga
from cloud import mailer
from cloud.main import _ensure_admins, _ensure_run_columns
from cloud.models import PortalUser
from cloud.security import make_mail_token
from cloud.tests.conftest import make_user, publish_race, verificar_email


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def mails(monkeypatch):
    """Reemplaza el envío real: junta (para, asunto, texto, html, link)."""
    enviados = []
    monkeypatch.setattr(mailer, "enviar", lambda *a: enviados.append(a) or True)
    return enviados


def _token_del_link(link: str, param: str) -> str:
    return urllib.parse.parse_qs(urllib.parse.urlparse(link).query)[param][0]


def _usuario(db, email):
    db.expire_all()
    return db.scalar(select(PortalUser).where(PortalUser.email == email))


def _registrar(client, email="ana@test.com", password="secreta123", full_name="Ana Gomez"):
    r = client.post("/api/auth/register", json={"email": email, "password": password, "full_name": full_name})
    assert r.status_code == 200, r.text
    return r.json()["token"]


# ── Registro y verificación ───────────────────────────────────────────────────

def test_registro_manda_mail_de_verificacion(client, mails):
    token = _registrar(client, full_name="<b>Ana</b> Gomez")
    assert len(mails) == 1
    para, asunto, texto, html, link = mails[0]
    assert para == "ana@test.com"
    assert "/?verificar=" in link and link in texto
    assert "<b>" not in html and "&lt;b&gt;" in html   # nombre escapado
    r = client.post("/api/auth/verify", json={"token": _token_del_link(link, "verificar")},
                    headers=_auth(token))
    assert r.status_code == 200 and r.json()["email_verified"] is True


def test_verificar_sin_sesion_pide_la_contrasena(client, db, mails):
    """El link solo prueba el buzón: sin la sesión de la cuenta hace falta su
    contraseña. Así el dueño de un email no le verifica la cuenta a un intruso
    que la creó con ese email (y no sabe su contraseña)."""
    _registrar(client, password="clave-del-intruso")
    vf = _token_del_link(mails[0][4], "verificar")
    r = client.post("/api/auth/verify", json={"token": vf})
    assert r.status_code == 401
    r = client.post("/api/auth/verify", json={"token": vf, "password": "otra-cosa"})
    assert r.status_code == 401
    assert _usuario(db, "ana@test.com").email_verified_at is None
    r = client.post("/api/auth/verify", json={"token": vf, "password": "clave-del-intruso"})
    assert r.status_code == 200 and r.json()["email_verified"] is True


def test_verificar_con_sesion_de_otra_cuenta_no_alcanza(client, db, mails):
    _registrar(client, email="ana@test.com")
    vf = _token_del_link(mails[0][4], "verificar")
    otra = _registrar(client, email="beto@test.com")
    r = client.post("/api/auth/verify", json={"token": vf}, headers=_auth(otra))
    assert r.status_code == 401
    assert _usuario(db, "ana@test.com").email_verified_at is None


def test_perfil_informa_email_verified(client, mails):
    token = _registrar(client)
    assert client.get("/api/run/profile", headers=_auth(token)).json()["email_verified"] is False
    verificar_email(client, "ana@test.com")
    assert client.get("/api/run/profile", headers=_auth(token)).json()["email_verified"] is True


def test_verify_token_vencido(client, db, mails):
    _registrar(client)
    u = _usuario(db, "ana@test.com")
    viejo = make_mail_token("verificar", u.id, u.email, now=time.time() - 49 * 3600)
    r = client.post("/api/auth/verify", json={"token": viejo})
    assert r.status_code == 400
    assert _usuario(db, "ana@test.com").email_verified_at is None


def test_verify_token_manipulado(client, db, mails):
    _registrar(client)
    otro_token = _registrar(client, email="beto@test.com")  # noqa: F841
    u = _usuario(db, "ana@test.com")
    beto = _usuario(db, "beto@test.com")
    tok = make_mail_token("verificar", u.id, u.email)
    b64, sig = tok.split(".")
    # Cambiar el usuario del payload sin poder refirmar.
    datos = json.loads(base64.urlsafe_b64decode(b64 + "=" * (-len(b64) % 4)))
    datos["u"], datos["e"] = beto.id, beto.email
    b64_malo = base64.urlsafe_b64encode(json.dumps(datos).encode()).decode().rstrip("=")
    for malo in (f"{b64_malo}.{sig}", tok[:-1] + ("0" if tok[-1] != "0" else "1"),
                 "basura", "", "a.b.c", tok + "á"):
        assert client.post("/api/auth/verify", json={"token": malo}).status_code == 400
    assert _usuario(db, "beto@test.com").email_verified_at is None


def test_verify_token_de_otro_proposito(client, db, mails):
    _registrar(client)
    u = _usuario(db, "ana@test.com")
    reset = make_mail_token("reset", u.id, u.email, password_hash=u.password_hash)
    assert client.post("/api/auth/verify", json={"token": reset}).status_code == 400
    verif = make_mail_token("verificar", u.id, u.email)
    r = client.post("/api/auth/password/reset", json={"token": verif, "new_password": "otraclave99"})
    assert r.status_code == 400


def test_verify_token_de_un_email_anterior_no_sirve(client, db, mails):
    _registrar(client)
    u = _usuario(db, "ana@test.com")
    tok = make_mail_token("verificar", u.id, "ana@test.com")
    u.email = "ana.nueva@test.com"
    db.commit()
    assert client.post("/api/auth/verify", json={"token": tok}).status_code == 400


def test_verify_es_idempotente(client, mails):
    _registrar(client)
    verificar_email(client, "ana@test.com")
    verificar_email(client, "ana@test.com")


def test_reenviar_verificacion_con_rate_limit(client, mails):
    token = _registrar(client)
    mails.clear()
    for _ in range(3):
        assert client.post("/api/auth/verify/send", headers=_auth(token)).json()["sent"] is True
    r = client.post("/api/auth/verify/send", headers=_auth(token))
    assert r.status_code == 429 and "Esperá unos minutos" in r.json()["detail"]
    assert len(mails) == 3


def test_reenviar_verificacion_ya_verificado_y_sin_sesion(client, mails):
    token = _registrar(client)
    verificar_email(client, "ana@test.com")
    mails.clear()
    r = client.post("/api/auth/verify/send", headers=_auth(token))
    assert r.json() == {"sent": False, "email_verified": True} and mails == []
    assert client.post("/api/auth/verify/send").status_code == 401


# ── Olvidé mi contraseña ──────────────────────────────────────────────────────

def test_forgot_no_filtra_si_la_cuenta_existe(client, mails):
    _registrar(client)
    mails.clear()
    a = client.post("/api/auth/password/forgot", json={"email": "ana@test.com"})
    b = client.post("/api/auth/password/forgot", json={"email": "nadie@test.com"})
    c = client.post("/api/auth/password/forgot", json={"email": "no es un email"})
    assert a.status_code == b.status_code == c.status_code == 200
    assert a.json() == b.json() == c.json()
    assert "Revisá también spam" in a.json()["message"]
    assert [m[0] for m in mails] == ["ana@test.com"]
    assert "/?reset=" in mails[0][4]


def test_forgot_respeta_rate_limit(client, mails):
    _registrar(client)
    mails.clear()
    # Por email: pasado el tope se sigue respondiendo 200, pero no sale mail.
    for _ in range(4):
        assert client.post("/api/auth/password/forgot", json={"email": "ana@test.com"}).status_code == 200
    assert len(mails) == 3
    # Por IP: 10 pedidos cada 10 minutos (holgado por las IPs compartidas).
    for i in range(6):
        assert client.post("/api/auth/password/forgot", json={"email": f"otro{i}@test.com"}).status_code == 200
    assert client.post("/api/auth/password/forgot", json={"email": "otro@test.com"}).status_code == 429


def _link_de_reset(client, mails, email="ana@test.com"):
    mails.clear()
    client.post("/api/auth/password/forgot", json={"email": email})
    return _token_del_link(mails[-1][4], "reset")


def test_reset_de_un_solo_uso(client, mails):
    _registrar(client)
    tok = _link_de_reset(client, mails)
    r = client.post("/api/auth/password/reset", json={"token": tok, "new_password": "nuevaclave1"})
    assert r.status_code == 200, r.text
    assert r.json()["email"] == "ana@test.com" and r.json()["token"]
    # Mismo link otra vez: la contraseña cambió, así que la firma ya no cierra.
    r = client.post("/api/auth/password/reset", json={"token": tok, "new_password": "otraclave22"})
    assert r.status_code == 400
    assert client.post("/api/auth/login", json={"email": "ana@test.com", "password": "nuevaclave1"}).status_code == 200
    assert client.post("/api/auth/login", json={"email": "ana@test.com", "password": "secreta123"}).status_code == 401


def test_reset_vencido_y_contrasenia_corta(client, db, mails):
    _registrar(client)
    u = _usuario(db, "ana@test.com")
    viejo = make_mail_token("reset", u.id, u.email, password_hash=u.password_hash,
                            now=time.time() - 3601)
    assert client.post("/api/auth/password/reset",
                       json={"token": viejo, "new_password": "nuevaclave1"}).status_code == 400
    tok = _link_de_reset(client, mails)
    assert client.post("/api/auth/password/reset",
                       json={"token": tok, "new_password": "corta"}).status_code == 422


def test_reset_cierra_otras_sesiones_y_marca_verificado(client, db, mails):
    viejo = _registrar(client)
    assert _usuario(db, "ana@test.com").email_verified_at is None
    tok = _link_de_reset(client, mails)
    nuevo = client.post("/api/auth/password/reset",
                        json={"token": tok, "new_password": "nuevaclave1"}).json()["token"]
    assert client.get("/api/run/profile", headers=_auth(viejo)).status_code == 401
    prof = client.get("/api/run/profile", headers=_auth(nuevo))
    assert prof.status_code == 200 and prof.json()["email_verified"] is True


def test_reset_desde_cuenta_solo_google(client, db, mails):
    """Quien entró siempre con Google puede elegir una contraseña con el reset."""
    ga.upsert_google_user(db, sub="g-1", email="gg@test.com", name=None, picture=None)
    tok = _link_de_reset(client, mails, email="gg@test.com")
    assert client.post("/api/auth/password/reset",
                       json={"token": tok, "new_password": "nuevaclave1"}).status_code == 200
    assert client.post("/api/auth/login", json={"email": "gg@test.com", "password": "nuevaclave1"}).status_code == 200


# ── Google sobre cuentas existentes ───────────────────────────────────────────

def test_google_sobre_cuenta_verificada_no_rota_la_contrasenia(client, db, mails):
    token = _registrar(client)
    verificar_email(client, "ana@test.com")
    u = ga.upsert_google_user(db, sub="g-ana", email="ana@test.com", name=None, picture=None)
    assert u.google_id == "g-ana"
    assert client.post("/api/auth/login", json={"email": "ana@test.com", "password": "secreta123"}).status_code == 200
    assert client.get("/api/run/profile", headers=_auth(token)).status_code == 200


def test_google_sobre_cuenta_sin_verificar_rota_y_marca_verificado(client, db, mails):
    token = _registrar(client)
    u = ga.upsert_google_user(db, sub="g-ana", email="ana@test.com", name=None, picture=None)
    assert u.email_verified_at is not None
    assert client.post("/api/auth/login", json={"email": "ana@test.com", "password": "secreta123"}).status_code == 401
    assert client.get("/api/run/profile", headers=_auth(token)).status_code == 401


def test_alta_por_google_nace_verificada(db):
    u = ga.upsert_google_user(db, sub="g-nuevo", email="nuevo@test.com", name=None, picture=None)
    assert u.email_verified_at is not None


# ── Admins ────────────────────────────────────────────────────────────────────

def test_admin_se_promueve_con_email_verificado_sin_google(client, db, monkeypatch, mails):
    monkeypatch.setenv("CT_ADMIN_EMAILS", "jefe@test.com")
    make_user(client, email="jefe@test.com")
    _ensure_admins()
    assert not _usuario(db, "jefe@test.com").is_admin
    verificar_email(client, "jefe@test.com")        # la verificación ya lo promueve
    assert _usuario(db, "jefe@test.com").is_admin
    # Y el arranque lo mantiene (o lo promueve si se agregó después a la lista).
    u = _usuario(db, "jefe@test.com")
    u.is_admin = 0
    db.commit()
    _ensure_admins()
    assert _usuario(db, "jefe@test.com").is_admin
    # Fuera de la lista lo pierde aunque esté verificado.
    monkeypatch.setenv("CT_ADMIN_EMAILS", "otro@test.com")
    _ensure_admins()
    assert not _usuario(db, "jefe@test.com").is_admin


def test_admin_sin_verificar_se_revoca(client, db, monkeypatch, mails):
    monkeypatch.setenv("CT_ADMIN_EMAILS", "jefe@test.com")
    make_user(client, email="jefe@test.com")
    u = _usuario(db, "jefe@test.com")
    u.is_admin = 1
    db.commit()
    _ensure_admins()
    assert not _usuario(db, "jefe@test.com").is_admin


# ── Autolink ──────────────────────────────────────────────────────────────────

def _h(email):
    return hashlib.sha256(("chronotrack-v1:" + email).encode()).hexdigest()


def test_autolink_solo_con_email_verificado(client, mails):
    publish_race(client, results=[{
        "bib_number": "1", "full_name": "Ana Gomez", "distance_km": 10.0,
        "net_time_ns": 1_800_000_000_000, "position": 1,
        "status": "FINISHER", "email_hash": _h("ana@test.com")}])
    token = _registrar(client)
    assert client.post("/api/me/autolink", headers=_auth(token)).json()["linked"] == 0
    assert client.get("/api/me/results", headers=_auth(token)).json()["results"] == []
    assert verificar_email(client, "ana@test.com")["linked"] == 1
    assert len(client.get("/api/me/results", headers=_auth(token)).json()["results"]) == 1


# ── Mailer ────────────────────────────────────────────────────────────────────

def test_mailer_sin_smtp_loguea_y_no_falla(monkeypatch, caplog):
    monkeypatch.delenv("CT_SMTP_HOST", raising=False)
    monkeypatch.delenv("RENDER", raising=False)
    with caplog.at_level("WARNING", logger="cloud.mailer"):
        assert mailer.enviar("a@test.com", "Asunto X", "texto", "<p>html</p>", "http://link/x") is False
    assert "Asunto X" in caplog.text and "http://link/x" in caplog.text


def test_mailer_en_produccion_no_loguea_el_link(monkeypatch, caplog):
    monkeypatch.delenv("CT_SMTP_HOST", raising=False)
    monkeypatch.setenv("RENDER", "true")
    with caplog.at_level("WARNING", logger="cloud.mailer"):
        mailer.enviar("a@test.com", "Asunto X", "texto", "<p>html</p>", "http://link/secreto")
    assert "Asunto X" in caplog.text and "secreto" not in caplog.text


def test_mailer_error_de_smtp_no_propaga(monkeypatch):
    monkeypatch.setenv("CT_SMTP_HOST", "127.0.0.1")
    monkeypatch.setenv("CT_SMTP_PORT", "1")   # nadie escucha: falla la conexión
    assert mailer.enviar("a@test.com", "A", "t", "<p>h</p>") is False


def test_mailer_usa_starttls_y_login(monkeypatch):
    llamadas = []

    class SMTPFalso:
        def __init__(self, host, port, timeout):
            llamadas.append(("conectar", host, port, timeout))
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def ehlo(self): pass
        def has_extn(self, n): return n == "starttls"
        def starttls(self, context): llamadas.append(("starttls",))
        def login(self, u, p): llamadas.append(("login", u, p))
        def send_message(self, msg): llamadas.append(("enviar", msg["To"], msg["From"]))

    monkeypatch.setattr(mailer.smtplib, "SMTP", SMTPFalso)
    monkeypatch.setenv("CT_SMTP_HOST", "smtp.test")
    monkeypatch.setenv("CT_SMTP_PORT", "587")
    monkeypatch.setenv("CT_SMTP_USER", "u@test.com")
    monkeypatch.setenv("CT_SMTP_PASSWORD", "clave")
    monkeypatch.setenv("CT_SMTP_FROM", "LiveRun <no-responder@test.com>")
    assert mailer.enviar("a@test.com", "A", "t", "<p>h</p>") is True
    assert llamadas == [("conectar", "smtp.test", 587, 10), ("starttls",),
                        ("login", "u@test.com", "clave"),
                        ("enviar", "a@test.com", "LiveRun <no-responder@test.com>")]


# ── Migración ─────────────────────────────────────────────────────────────────

def test_migracion_idempotente_con_base_vieja(tmp_path, monkeypatch):
    import cloud.db
    eng = create_engine(f"sqlite:///{tmp_path / 'vieja.db'}")
    with eng.begin() as c:
        c.execute(text("CREATE TABLE portal_users (id INTEGER PRIMARY KEY, email VARCHAR(255) NOT NULL UNIQUE, "
                       "password_hash VARCHAR(255) NOT NULL, full_name VARCHAR(200), created_at DATETIME, "
                       "google_id VARCHAR(64))"))
        c.execute(text("INSERT INTO portal_users (email, password_hash, google_id) VALUES "
                       "('g@test.com', 'x', 'g-1'), ('p@test.com', 'x', NULL)"))
    monkeypatch.setattr(cloud.db, "engine", eng)
    _ensure_run_columns()
    with eng.connect() as c:
        filas = dict(c.execute(text("SELECT email, email_verified_at FROM portal_users")).all())
    assert filas["g@test.com"] is not None
    assert filas["p@test.com"] is None
    _ensure_run_columns()   # segunda vez: no falla ni pisa nada
    with eng.connect() as c:
        cols = [r[1] for r in c.execute(text("PRAGMA table_info(portal_users)"))]
        filas2 = dict(c.execute(text("SELECT email, email_verified_at FROM portal_users")).all())
    assert cols.count("email_verified_at") == 1
    assert filas2 == filas
    eng.dispose()
