"""Perfil de ChronoTrack Run: username, meta semanal."""
from cloud.tests.conftest import make_user


def test_perfil_por_defecto(client):
    h = make_user(client)
    r = client.get("/api/run/profile", headers=h)
    assert r.status_code == 200
    data = r.json()
    assert data["username"] is None
    assert data["weekly_goal"] == 3


def test_setear_username_y_meta(client):
    h = make_user(client)
    r = client.patch("/api/run/profile", json={"username": "Agus.Girardi", "weekly_goal": 5}, headers=h)
    assert r.status_code == 200
    data = r.json()
    assert data["username"] == "agus.girardi"  # se normaliza a minúsculas
    assert data["weekly_goal"] == 5


def test_username_invalido(client):
    h = make_user(client)
    for bad in ["ab", "con espacios", "ñandu", "x" * 31, "hola-chau"]:
        r = client.patch("/api/run/profile", json={"username": bad}, headers=h)
        assert r.status_code == 400, bad


def test_username_duplicado(client):
    make_user(client, email="uno@test.com", username="corredor1")
    h2 = make_user(client, email="dos@test.com")
    r = client.patch("/api/run/profile", json={"username": "corredor1"}, headers=h2)
    assert r.status_code == 409


def test_meta_fuera_de_rango(client):
    h = make_user(client)
    assert client.patch("/api/run/profile", json={"weekly_goal": 0}, headers=h).status_code == 422
    assert client.patch("/api/run/profile", json={"weekly_goal": 8}, headers=h).status_code == 422


def test_sin_token_401(client):
    assert client.get("/api/run/profile").status_code == 401
