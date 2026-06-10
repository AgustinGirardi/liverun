"""Amistades y ranking de ChronoTrack Run."""
from datetime import datetime

from cloud.tests.conftest import make_user


def test_solicitud_y_aceptacion(client):
    h1 = make_user(client, email="ana@test.com", username="ana")
    h2 = make_user(client, email="beto@test.com", username="beto")

    r = client.post("/api/run/friends/request", json={"username": "beto"}, headers=h1)
    assert r.status_code == 200
    assert r.json()["status"] == "pending"

    # Beto la ve como entrante y la acepta
    fl = client.get("/api/run/friends", headers=h2).json()
    assert len(fl["incoming"]) == 1
    assert fl["incoming"][0]["username"] == "ana"
    fid = fl["incoming"][0]["friendship_id"]
    r = client.post("/api/run/friends/accept", json={"friendship_id": fid}, headers=h2)
    assert r.json()["status"] == "accepted"

    # Ambos se ven como amigos
    assert client.get("/api/run/friends", headers=h1).json()["friends"][0]["username"] == "beto"
    assert client.get("/api/run/friends", headers=h2).json()["friends"][0]["username"] == "ana"


def test_solicitud_cruzada_equivale_a_aceptar(client):
    h1 = make_user(client, email="ana@test.com", username="ana")
    h2 = make_user(client, email="beto@test.com", username="beto")
    client.post("/api/run/friends/request", json={"username": "beto"}, headers=h1)
    r = client.post("/api/run/friends/request", json={"username": "ana"}, headers=h2)
    assert r.json()["status"] == "accepted"


def test_no_autoamistad_ni_duplicados(client):
    h1 = make_user(client, email="ana@test.com", username="ana")
    make_user(client, email="beto@test.com", username="beto")
    assert client.post("/api/run/friends/request", json={"username": "ana"}, headers=h1).status_code == 400
    client.post("/api/run/friends/request", json={"username": "beto"}, headers=h1)
    assert client.post("/api/run/friends/request", json={"username": "beto"}, headers=h1).status_code == 409


def test_aceptar_solo_el_destinatario(client):
    h1 = make_user(client, email="ana@test.com", username="ana")
    make_user(client, email="beto@test.com", username="beto")
    client.post("/api/run/friends/request", json={"username": "beto"}, headers=h1)
    fid = client.get("/api/run/friends", headers=h1).json()["outgoing"][0]["friendship_id"]
    # Ana (la solicitante) no puede aceptar su propia solicitud
    assert client.post("/api/run/friends/accept", json={"friendship_id": fid}, headers=h1).status_code == 404


def test_busqueda_con_estado_de_relacion(client):
    h1 = make_user(client, email="ana@test.com", username="ana")
    make_user(client, email="beto@test.com", username="beto.runner")
    out = client.get("/api/run/friends/search?q=beto", headers=h1).json()
    assert out[0]["username"] == "beto.runner"
    assert out[0]["relation"] == "none"
    client.post("/api/run/friends/request", json={"username": "beto.runner"}, headers=h1)
    out = client.get("/api/run/friends/search?q=beto", headers=h1).json()
    assert out[0]["relation"] == "pending"


def _activity(client, headers, uuid, dist):
    return client.post("/api/run/activities", json={
        "client_uuid": uuid, "started_at": datetime.now().isoformat(),
        "duration_s": 1800, "distance_m": dist,
    }, headers=headers)


def test_ranking_solo_amigos_aceptados(client):
    h1 = make_user(client, email="ana@test.com", username="ana")
    h2 = make_user(client, email="beto@test.com", username="beto")
    h3 = make_user(client, email="caro@test.com", username="caro")

    # Ana y Beto amigos; Caro solo tiene solicitud pendiente con Ana
    client.post("/api/run/friends/request", json={"username": "beto"}, headers=h1)
    client.post("/api/run/friends/request", json={"username": "ana"}, headers=h2)  # acepta
    client.post("/api/run/friends/request", json={"username": "caro"}, headers=h1)  # pendiente

    _activity(client, h1, "a1", 5000.0)
    _activity(client, h2, "b1", 10000.0)
    _activity(client, h3, "c1", 21000.0)

    rk = client.get("/api/run/ranking?period=week", headers=h1).json()
    usernames = [e["username"] for e in rk["entries"]]
    assert usernames == ["beto", "ana"]  # ordenado por km, sin caro (pendiente)
    assert rk["entries"][0]["km"] == 10.0
    me = [e for e in rk["entries"] if e["is_me"]][0]
    assert me["username"] == "ana"


def test_ranking_period_invalido(client):
    h = make_user(client, username="ana")
    assert client.get("/api/run/ranking?period=year", headers=h).status_code == 400
