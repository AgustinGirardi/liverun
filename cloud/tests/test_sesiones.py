"""Sesiones y contraseñas (NIST 800-63B, ASVS V2/V3, ISO A.8.5).

Cada test es un hallazgo del plan de hardening: PBKDF2 con las iteraciones que
pide OWASP, token más corto sin el formato viejo, logout en el servidor y
bloqueo por cuenta además del límite por IP."""

import base64
import hashlib
import hmac
import time

from sqlalchemy import select

from cloud import security
from cloud.models import PortalUser
from cloud.tests.conftest import make_user

PASSWORD = "secreta123"


def _iteraciones(guardado: str) -> int:
    return int(guardado.split("$")[1])


def _hash_viejo(password: str, iters: int = 200_000) -> str:
    salt = b"0123456789abcdef"
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iters)
    return f"pbkdf2${iters}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def _login(client, email="runner@test.com", password=PASSWORD, ip=None):
    headers = {"X-Forwarded-For": ip} if ip else {}
    return client.post("/api/auth/login", json={"email": email, "password": password}, headers=headers)


def test_hash_nuevo_usa_al_menos_600_mil_iteraciones():
    assert _iteraciones(security.hash_password(PASSWORD)) >= 600_000


def test_login_rehashea_las_contrasenas_con_pocas_iteraciones(client, db):
    make_user(client)
    user = db.scalar(select(PortalUser))
    user.password_hash = _hash_viejo(PASSWORD)
    db.commit()

    assert _login(client).status_code == 200

    db.expire_all()
    nuevo = db.scalar(select(PortalUser)).password_hash
    assert _iteraciones(nuevo) >= 600_000
    assert security.verify_password(PASSWORD, nuevo)


def test_login_fallido_no_toca_el_hash(client, db):
    make_user(client)
    user = db.scalar(select(PortalUser))
    user.password_hash = _hash_viejo(PASSWORD)
    db.commit()

    assert _login(client, password="otra-clave-mala").status_code == 401

    db.expire_all()
    assert _iteraciones(db.scalar(select(PortalUser)).password_hash) == 200_000


def test_token_de_tres_partes_ya_no_se_acepta():
    exp = int(time.time()) + 3600
    payload = f"1.{exp}"
    sig = hmac.new(security.SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    assert security.verify_token(f"{payload}.{sig}") is None


def test_token_nuevo_sigue_andando():
    assert security.verify_token(security.make_token(7))[0] == 7


def test_el_token_dura_como_mucho_14_dias():
    assert security.TOKEN_TTL <= 14 * 24 * 3600


def test_logout_invalida_el_token_en_el_servidor(client):
    h = make_user(client)
    assert client.get("/api/run/profile", headers=h).status_code == 200

    r = client.post("/api/auth/logout", headers=h)
    assert r.status_code == 200, r.text

    assert client.get("/api/run/profile", headers=h).status_code == 401


def test_logout_sin_sesion_es_401(client):
    assert client.post("/api/auth/logout").status_code == 401


def test_bloqueo_por_cuenta_tras_varios_fallos(client):
    make_user(client, email="a@test.com")
    for _ in range(5):
        assert _login(client, "a@test.com", "mala-mala-1").status_code == 401

    # Con la contraseña correcta también: el bloqueo es de la cuenta.
    assert _login(client, "a@test.com").status_code == 429


def test_el_bloqueo_de_una_cuenta_no_afecta_a_otra(client):
    make_user(client, email="a@test.com")
    make_user(client, email="b@test.com")
    for _ in range(5):
        _login(client, "a@test.com", "mala-mala-1")

    assert _login(client, "b@test.com").status_code == 200


def test_el_bloqueo_tambien_corta_a_quien_cambia_de_ip(client):
    make_user(client, email="a@test.com")
    for i in range(5):
        _login(client, "a@test.com", "mala-mala-1", ip=f"10.0.0.{i}")

    assert _login(client, "a@test.com", ip="10.0.1.1").status_code == 429


def test_un_login_ok_reinicia_la_cuenta_de_fallos(client):
    make_user(client, email="a@test.com")
    for _ in range(4):
        _login(client, "a@test.com", "mala-mala-1")
    assert _login(client, "a@test.com").status_code == 200

    for _ in range(4):
        assert _login(client, "a@test.com", "mala-mala-1").status_code == 401


def test_el_registro_rechaza_contrasenas_comunes(client):
    for comun in ("password", "12345678", "qwertyui", "password123"):
        r = client.post("/api/auth/register", json={"email": f"{comun}@test.com", "password": comun})
        assert r.status_code in (400, 422), f"{comun!r} se aceptó"


def test_cambiar_la_contrasena_rechaza_contrasenas_comunes(client):
    h = make_user(client)
    r = client.post("/api/auth/password", json={"current_password": PASSWORD, "new_password": "12345678"}, headers=h)
    assert r.status_code in (400, 422)
