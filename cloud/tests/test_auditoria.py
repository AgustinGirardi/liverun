"""Auditoría de eventos (SOC 2 CC7.2, ISO A.8.15, NIST AU): una fila en
`audit_events` y una línea JSON en el log por cada evento sensible, sin PII.

Los valores "sentinela" (email, nombre, contraseña, token, key) son strings
únicos: si aparecen en alguna fila o en el log, se filtró un dato personal."""

import json
import logging

import pytest
from sqlalchemy import select

from cloud import audit
from cloud import google_auth as ga
from cloud.models import AuditEvent, PortalUser
from cloud.security import make_mail_token
from cloud.tests.conftest import make_user, verificar_email

EMAIL = "sentinela.email@dominio-secreto.test"
NOMBRE = "Nombre Sentinela Unico"
PASSWORD = "clave-sentinela-9X7"
IP_CLIENTE = {"X-Forwarded-For": "203.0.113.77"}


def _eventos(db, accion=None):
    db.expire_all()
    stmt = select(AuditEvent).order_by(AuditEvent.id)
    if accion:
        stmt = stmt.where(AuditEvent.action == accion)
    return db.scalars(stmt).all()


def _una(db, accion):
    filas = _eventos(db, accion)
    assert len(filas) == 1, f"{accion}: {len(filas)} eventos"
    return filas[0]


def _admin(client, db):
    h = make_user(client, email="admin@test.com", username="boss")
    u = db.scalar(select(PortalUser).where(PortalUser.email == "admin@test.com"))
    u.is_admin = 1
    db.commit()
    return h, u.id


def _usuario(client, db):
    h = make_user(client, email=EMAIL, password=PASSWORD, full_name=NOMBRE)
    uid = db.scalar(select(PortalUser.id).where(PortalUser.email == EMAIL))
    return h, uid


# ── Autenticación ────────────────────────────────────────────────────────────


def test_registro_deja_un_evento_con_el_id_y_sin_datos_personales(client, db):
    _, uid = _usuario(client, db)
    e = _una(db, "register")
    assert (e.result, e.actor_type, e.user_id, e.target) == ("ok", "user", uid, f"user:{uid}")
    assert e.created_at is not None


def test_login_ok(client, db):
    _, uid = _usuario(client, db)
    r = client.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200
    e = _una(db, "login_ok")
    assert (e.result, e.user_id) == ("ok", uid)


def test_login_fail_con_cuenta_existente_guarda_el_id_y_una_huella(client, db):
    _, uid = _usuario(client, db)
    client.post("/api/auth/login", json={"email": EMAIL, "password": "mala-mala-1"})
    e = _una(db, "login_fail")
    assert (e.result, e.actor_type, e.user_id) == ("fail", "anon", uid)
    assert e.detail == f"email:{audit.huella_email(EMAIL)}"


def test_login_fail_con_email_inexistente_no_tiene_user_id_pero_si_huella(client, db):
    client.post("/api/auth/login", json={"email": "nadie@dominio-secreto.test", "password": "x" * 9})
    e = _una(db, "login_fail")
    assert e.user_id is None
    assert e.detail == f"email:{audit.huella_email('nadie@dominio-secreto.test')}"


def test_la_huella_es_estable_sin_importar_mayusculas_y_no_es_el_email():
    h = audit.huella_email("  Ana@Test.com ")
    assert h == audit.huella_email("ana@test.com")
    assert "ana" not in h and len(h) == 16
    assert h != audit.huella_email("otra@test.com")


def test_login_locked_deja_rastro_tras_los_fallos_maximos(client, db):
    _usuario(client, db)
    for _ in range(5):
        client.post("/api/auth/login", json={"email": EMAIL, "password": "mala-mala-1"})
    r = client.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 429
    e = _una(db, "login_locked")
    assert (e.result, e.actor_type) == ("fail", "anon")
    assert len(_eventos(db, "login_fail")) == 5


def test_logout(client, db):
    h, uid = _usuario(client, db)
    assert client.post("/api/auth/logout", headers=h).status_code == 200
    assert _una(db, "logout").user_id == uid


def test_cambio_de_contrasena(client, db):
    h, uid = _usuario(client, db)
    r = client.post(
        "/api/auth/password", json={"current_password": PASSWORD, "new_password": "otra-clave-8Z"}, headers=h
    )
    assert r.status_code == 200
    assert _una(db, "password_change").user_id == uid


def test_reset_de_contrasena(client, db):
    _, uid = _usuario(client, db)
    user = db.scalar(select(PortalUser).where(PortalUser.id == uid))
    token = make_mail_token("reset", user.id, user.email, password_hash=user.password_hash)
    r = client.post("/api/auth/password/reset", json={"token": token, "new_password": "nueva-clave-5Q"})
    assert r.status_code == 200
    assert _una(db, "password_reset").user_id == uid


def test_verificacion_de_email(client, db):
    _, uid = _usuario(client, db)
    verificar_email(client, EMAIL)
    assert _una(db, "email_verified").user_id == uid


def test_borrado_de_cuenta_sobrevive_al_borrado(client, db):
    h, uid = _usuario(client, db)
    assert client.delete("/api/auth/account", headers=h).status_code == 200
    assert db.scalar(select(PortalUser).where(PortalUser.id == uid)) is None
    e = _una(db, "account_deleted")
    assert (e.result, e.user_id) == ("ok", uid)


def test_google_login_y_vinculacion(client, db, monkeypatch):
    make_user(client, email="ana@test.com")
    monkeypatch.setattr(
        ga, "exchange_code", lambda code: {"sub": "g-1", "email": "ana@test.com", "email_verified": True, "name": "Ana"}
    )
    r = client.get(
        "/api/run/auth/google/callback",
        params={"state": ga.make_state("liverun://auth"), "code": "abc"},
        follow_redirects=False,
    )
    assert r.status_code == 302
    assert _una(db, "google_link").result == "ok"
    ga_state = ga.make_state("liverun://auth")
    client.get("/api/run/auth/google/callback", params={"state": ga_state, "code": "abc"}, follow_redirects=False)
    assert len(_eventos(db, "google_login")) == 1


def test_google_cuenta_nueva(client, db, monkeypatch):
    monkeypatch.setattr(
        ga, "exchange_code", lambda code: {"sub": "g-2", "email": "nueva@test.com", "email_verified": True}
    )
    client.get(
        "/api/run/auth/google/callback",
        params={"state": ga.make_state("liverun://auth"), "code": "abc"},
        follow_redirects=False,
    )
    assert _una(db, "register").detail == "google"


# ── Claves de organizador y acciones de admin ────────────────────────────────


def test_ciclo_de_vida_de_una_clave_de_publicacion(client, db):
    h, admin_id = _admin(client, db)
    creada = client.post("/api/run/admin/publish-keys", json={"name": "Club Norte"}, headers=h).json()
    kid = creada["id"]
    client.post(f"/api/run/admin/publish-keys/{kid}/rotate", headers=h)
    client.post(f"/api/run/admin/publish-keys/{kid}/revoke", headers=h)
    for accion in ("publish_key_created", "publish_key_rotated", "publish_key_revoked"):
        e = _una(db, accion)
        assert (e.result, e.actor_type, e.user_id, e.target) == ("ok", "admin", admin_id, f"key:{kid}")


def test_revocar_dos_veces_audita_una_sola(client, db):
    h, _ = _admin(client, db)
    kid = client.post("/api/run/admin/publish-keys", json={"name": "Club"}, headers=h).json()["id"]
    client.post(f"/api/run/admin/publish-keys/{kid}/revoke", headers=h)
    client.post(f"/api/run/admin/publish-keys/{kid}/revoke", headers=h)
    assert len(_eventos(db, "publish_key_revoked")) == 1


def test_grant_y_cupones_de_admin(client, db):
    h, admin_id = _admin(client, db)
    _, uid = _usuario(client, db)
    client.post(f"/api/run/admin/users/{uid}/grant", json={"months": 2}, headers=h)
    cupon = client.post(
        "/api/run/admin/coupons", json={"code": "REGALO2026", "kind": "free_months", "months": 1}, headers=h
    ).json()
    client.post(f"/api/run/admin/coupons/{cupon['id']}/toggle", headers=h)
    g = _una(db, "admin_grant")
    assert (g.actor_type, g.user_id, g.target) == ("admin", admin_id, f"user:{uid}")
    assert _una(db, "coupon_created").target == f"coupon:{cupon['id']}"
    assert _una(db, "coupon_toggled").target == f"coupon:{cupon['id']}"
    assert "REGALO2026" not in json.dumps([(e.target, e.detail) for e in _eventos(db)])


# ── IP truncada ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "ip, esperada",
    [
        ("203.0.113.77", "203.0.113.0/24"),
        ("2001:db8:abcd:1234:5678::9", "2001:db8:abcd::/48"),
        ("::ffff:203.0.113.77", "203.0.113.0/24"),
        ("unknown", None),
        ("testclient", None),
        ("", None),
        (None, None),
    ],
)
def test_ip_truncada(ip, esperada):
    assert audit.ip_truncada(ip) == esperada


def test_el_evento_guarda_la_ip_truncada_y_no_la_completa(client, db):
    client.post("/api/auth/login", json={"email": "x@test.com", "password": "y" * 9}, headers=IP_CLIENTE)
    e = _una(db, "login_fail")
    assert e.ip == "203.0.113.0/24"


def test_no_se_confia_en_un_header_falsificado_del_cliente(client, db):
    # CF-Connecting-IP solo vale si quien habla es Cloudflare (reusa _client_ip).
    client.post(
        "/api/auth/login",
        json={"email": "x@test.com", "password": "y" * 9},
        headers={"CF-Connecting-IP": "198.51.100.9"},
    )
    assert _una(db, "login_fail").ip is None


# ── Sin datos personales ─────────────────────────────────────────────────────


def test_ni_las_filas_ni_el_log_contienen_datos_personales(client, db, caplog):
    caplog.set_level(logging.INFO, logger="cloud.audit")
    h, uid = _usuario(client, db)
    token = h["Authorization"].split(" ", 1)[1]
    client.post("/api/auth/login", json={"email": EMAIL, "password": "mala-mala-1"}, headers=IP_CLIENTE)
    client.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, headers=IP_CLIENTE)
    client.post("/api/auth/password", json={"current_password": PASSWORD, "new_password": "otra-clave-8Z"}, headers=h)
    verificar_email(client, EMAIL)
    ah, _ = _admin(client, db)
    creada = client.post("/api/run/admin/publish-keys", json={"name": "Club"}, headers=ah).json()
    rotada = client.post(f"/api/run/admin/publish-keys/{creada['id']}/rotate", headers=ah).json()
    client.delete("/api/auth/account", headers=h)

    filas = json.dumps([(e.action, e.result, e.actor_type, e.user_id, e.target, e.ip, e.detail) for e in _eventos(db)])
    log = "\n".join(r.getMessage() for r in caplog.records if r.name == "cloud.audit")
    assert log, "no salió ninguna línea al logger cloud.audit"
    secretos = [EMAIL, NOMBRE, PASSWORD, "otra-clave-8Z", token, creada["key"], rotada["key"], creada["prefix"]]
    for secreto in secretos:
        assert secreto not in filas, f"{secreto!r} está en audit_events"
        assert secreto not in log, f"{secreto!r} está en el log de auditoría"


def test_cada_linea_del_log_es_json_valido(client, db, caplog):
    caplog.set_level(logging.INFO, logger="cloud.audit")
    _usuario(client, db)
    client.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, headers=IP_CLIENTE)
    lineas = [json.loads(r.getMessage()) for r in caplog.records if r.name == "cloud.audit"]
    ok = [x for x in lineas if x["action"] == "login_ok"]
    assert len(ok) == 1
    assert {"ts", "action", "result", "actor_type", "user_id", "target", "ip", "detail"} <= set(ok[0])
    assert ok[0]["ip"] == "203.0.113.0/24"


def test_el_filtro_de_redaccion_tapa_emails_y_bearer(caplog):
    log = logging.getLogger("cloud.audit")
    caplog.set_level(logging.INFO, logger="cloud.audit")
    log.info("fallo de ana@test.com con Bearer abc.def-123 y otra cosa")
    visto = [r.getMessage() for r in caplog.records][-1]
    assert "ana@test.com" not in visto and "abc.def-123" not in visto
    assert visto.count("[redactado]") == 2


def test_los_campos_largos_se_recortan_para_no_romper_la_fila(client, db):
    e = audit.registrar(db, "x" * 80, "ok", detalle="d" * 500, target="t" * 100)
    db.commit()
    fila = db.scalars(select(AuditEvent)).one()
    assert e is not None and len(fila.detail) <= 200 and len(fila.target) <= 64 and len(fila.action) <= 40


# ── La auditoría no rompe la acción ──────────────────────────────────────────


def test_si_registrar_falla_el_login_sigue_respondiendo_200(client, db, monkeypatch, caplog):
    _usuario(client, db)

    def _rompe(_ip):
        raise RuntimeError("falla simulada de auditoría")

    monkeypatch.setattr(audit, "ip_truncada", _rompe)
    r = client.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, headers=IP_CLIENTE)
    assert r.status_code == 200
    assert _eventos(db, "login_ok") == []
    assert any(rec.levelno == logging.ERROR and "auditar" in rec.getMessage() for rec in caplog.records)


def test_si_registrar_falla_el_registro_de_la_cuenta_sigue_andando(client, db, monkeypatch):
    monkeypatch.setattr(audit, "ip_truncada", lambda _ip: 1 / 0)
    r = client.post("/api/auth/register", json={"email": "a@test.com", "password": PASSWORD})
    assert r.status_code == 200
    assert db.scalar(select(PortalUser).where(PortalUser.email == "a@test.com")) is not None
