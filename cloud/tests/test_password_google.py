"""Contraseña en cuentas de Google: quien entra solo con Google nunca eligió
una (el hash es de un valor al azar), así que puede crearla sin "la actual".
Quien sí eligió una la sigue necesitando, y las cuentas viejas que no se sabe
también."""
from sqlalchemy import text

from cloud.db import engine
from cloud.main import _ensure_password_set_column
from cloud.models import PortalUser
from cloud.security import make_token
from cloud.tests.conftest import make_user
import cloud.google_auth as ga

NUEVA = "otraClave456"


def _headers(user):
    # Emitido en el corte de sesiones, igual que el callback real de Google.
    return {"Authorization": f"Bearer {make_token(user.id, iat=user.tokens_valid_from)}"}


def _perfil(client, h):
    r = client.get("/api/run/profile", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def test_cuenta_nueva_de_google_crea_contrasena_sin_la_actual(client, db):
    u = ga.upsert_google_user(db, "sub-1", "google@test.com", "Ana Google", None)
    h = _headers(u)
    assert _perfil(client, h)["has_password"] is False

    r = client.post("/api/auth/password", headers=h, json={"new_password": NUEVA})
    assert r.status_code == 200, r.text
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    assert _perfil(client, h)["has_password"] is True
    assert client.post("/api/auth/login",
                       json={"email": "google@test.com", "password": NUEVA}).status_code == 200

    # Ya tiene una: la próxima vez se pide la actual.
    r = client.post("/api/auth/password", headers=h, json={"new_password": "terceraClave789"})
    assert r.status_code == 400


def test_registro_con_contrasena_la_sigue_pidiendo(client):
    h = make_user(client, email="clasica@test.com")
    assert _perfil(client, h)["has_password"] is True
    r = client.post("/api/auth/password", headers=h, json={"new_password": NUEVA})
    assert r.status_code == 400


def test_google_toma_una_cuenta_sin_verificar_y_anula_la_contrasena(client, db):
    make_user(client, email="tomada@test.com")
    u = ga.upsert_google_user(db, "sub-2", "tomada@test.com", "Dueño Real", None)
    assert u.password_set == 0
    assert _perfil(client, _headers(u))["has_password"] is False


def test_migracion_marca_solo_las_cuentas_sin_google(db):
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE portal_users DROP COLUMN password_set"))
        conn.execute(text("INSERT INTO portal_users (email, password_hash, is_admin, weekly_goal) "
                          "VALUES ('vieja@test.com', 'x', 0, 3)"))
        conn.execute(text("INSERT INTO portal_users (email, password_hash, google_id, is_admin, weekly_goal) "
                          "VALUES ('vieja-google@test.com', 'x', 'sub-9', 0, 3)"))
    _ensure_password_set_column()
    _ensure_password_set_column()  # idempotente
    por_email = {u.email: u.password_set for u in db.query(PortalUser)}
    assert por_email == {"vieja@test.com": 1, "vieja-google@test.com": None}


def test_cuenta_vieja_de_google_sin_dato_pide_la_actual(client, db):
    u = ga.upsert_google_user(db, "sub-3", "dudosa@test.com", "Sin Dato", None)
    u.password_set = None
    db.commit()
    h = _headers(u)
    assert _perfil(client, h)["has_password"] is None
    assert client.post("/api/auth/password", headers=h,
                       json={"new_password": NUEVA}).status_code == 400
