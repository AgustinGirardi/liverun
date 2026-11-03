"""Cambio de contraseña: validaciones y cierre de las sesiones abiertas."""

import time

from cloud.security import SECRET, make_token, verify_token
from cloud.tests.conftest import make_user

ACTUAL = "secreta123"
NUEVA = "otraClave456"


def _cambiar(client, headers, actual=ACTUAL, nueva=NUEVA):
    return client.post("/api/auth/password", headers=headers, json={"current_password": actual, "new_password": nueva})


def test_cambia_la_contrasenia_y_permite_entrar_con_la_nueva(client):
    h = make_user(client, email="cambio@test.com")
    r = _cambiar(client, h)
    assert r.status_code == 200, r.text
    assert r.json()["token"]

    assert client.post("/api/auth/login", json={"email": "cambio@test.com", "password": NUEVA}).status_code == 200
    assert client.post("/api/auth/login", json={"email": "cambio@test.com", "password": ACTUAL}).status_code == 401


def test_rechaza_si_la_actual_no_coincide(client):
    h = make_user(client, email="malactual@test.com")
    r = _cambiar(client, h, actual="noEsLaMia999")
    assert r.status_code == 400
    # y la contraseña real sigue siendo la de antes
    assert client.post("/api/auth/login", json={"email": "malactual@test.com", "password": ACTUAL}).status_code == 200


def test_rechaza_si_la_nueva_es_igual_a_la_actual(client):
    h = make_user(client, email="misma@test.com")
    assert _cambiar(client, h, nueva=ACTUAL).status_code == 400


def test_rechaza_una_nueva_demasiado_corta(client):
    h = make_user(client, email="corta@test.com")
    assert _cambiar(client, h, nueva="1234567").status_code == 422


def test_requiere_autenticacion(client):
    r = client.post("/api/auth/password", json={"current_password": ACTUAL, "new_password": NUEVA})
    assert r.status_code == 401


def test_cierra_las_sesiones_abiertas_pero_no_la_propia(client):
    """El token viejo (otro dispositivo) deja de servir; el que devuelve el
    cambio sigue andando, para no echar a quien lo hizo."""
    viejo = make_user(client, email="sesiones@test.com")
    assert client.get("/api/run/profile", headers=viejo).status_code == 200

    r = _cambiar(client, viejo)
    nuevo = {"Authorization": f"Bearer {r.json()['token']}"}

    assert client.get("/api/run/profile", headers=viejo).status_code == 401
    assert client.get("/api/run/profile", headers=nuevo).status_code == 200


def test_rechaza_tokens_del_formato_viejo(client, db):
    """El formato de 3 partes (sin iat) se retiró en el hardening de sesiones:
    esas sesiones piden login de nuevo, ni siquiera con la firma bien."""
    import hashlib
    import hmac as _hmac
    from sqlalchemy import select
    from cloud.models import PortalUser

    make_user(client, email="viejo@test.com")
    uid = db.scalar(select(PortalUser).where(PortalUser.email == "viejo@test.com")).id
    payload = f"{uid}.{int(time.time()) + 3600}"
    sig = _hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    antiguo = {"Authorization": f"Bearer {payload}.{sig}"}

    assert verify_token(f"{payload}.{sig}") is None
    assert client.get("/api/run/profile", headers=antiguo).status_code == 401


def test_token_nuevo_lleva_iat(client):
    antes = int(time.time())
    uid, iat = verify_token(make_token(7))
    assert uid == 7 and iat >= antes
