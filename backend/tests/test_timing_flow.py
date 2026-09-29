"""Flujo básico de cronometraje: largada → captura → asignación → resultados."""
from backend.tests.conftest import make_runner, make_race, register


def test_capture_assign_and_results(client):
    runner = make_runner(client)
    race = make_race(client)
    register(client, race["id"], runner["id"], bib="7", distance_km=10.0)

    assert client.post(f"/api/v1/races/{race['id']}/start").status_code == 200

    cap = client.post(f"/api/v1/races/{race['id']}/capture")
    assert cap.status_code == 200
    capture_id = cap.json()["id"]

    assign = client.post(
        f"/api/v1/races/{race['id']}/captures/{capture_id}/assign",
        json={"bib_number": "7"},
    )
    assert assign.status_code == 200, assign.text
    body = assign.json()
    assert body["bib_number"] == "7"
    assert body["position"] == 1
    assert body["net_time_ns"] is not None

    results = client.get(f"/api/v1/races/{race['id']}/results").json()
    assert results["total_finishers"] == 1
    assert results["results"][0]["bib_number"] == "7"


def test_assign_same_bib_twice_rejected(client):
    runner = make_runner(client)
    race = make_race(client)
    register(client, race["id"], runner["id"], bib="7")

    client.post(f"/api/v1/races/{race['id']}/start")
    c1 = client.post(f"/api/v1/races/{race['id']}/capture").json()
    c2 = client.post(f"/api/v1/races/{race['id']}/capture").json()

    assert client.post(
        f"/api/v1/races/{race['id']}/captures/{c1['id']}/assign", json={"bib_number": "7"}
    ).status_code == 200
    r = client.post(
        f"/api/v1/races/{race['id']}/captures/{c2['id']}/assign", json={"bib_number": "7"}
    )
    assert r.status_code == 400


def test_assign_response_includes_distance_km(client):
    """La respuesta de asignar trae la distancia: propia de la inscripción o, si falta, la de la carrera."""
    race = make_race(client)
    # RaceCreate no trae distance_km: se fija por PATCH.
    assert client.patch(f"/api/v1/races/{race['id']}", json={"distance_km": 42.0}).status_code == 200
    r1 = make_runner(client)
    r2 = make_runner(client, first="Bea")
    register(client, race["id"], r1["id"], bib="1", distance_km=21.0)
    register(client, race["id"], r2["id"], bib="2", distance_km=None)

    client.post(f"/api/v1/races/{race['id']}/start")
    c1 = client.post(f"/api/v1/races/{race['id']}/capture").json()
    c2 = client.post(f"/api/v1/races/{race['id']}/capture").json()

    a1 = client.post(f"/api/v1/races/{race['id']}/captures/{c1['id']}/assign", json={"bib_number": "1"})
    a2 = client.post(f"/api/v1/races/{race['id']}/captures/{c2['id']}/assign", json={"bib_number": "2"})
    assert a1.status_code == 200, a1.text
    assert a2.status_code == 200, a2.text
    assert a1.json()["distance_km"] == 21.0
    assert a2.json()["distance_km"] == 42.0


def test_assign_response_distance_zero_is_none(client):
    """Carrera con distancia 0 y sin distancia propia: la respuesta manda None, como get_results."""
    race = make_race(client)
    assert client.patch(f"/api/v1/races/{race['id']}", json={"distance_km": 0.0}).status_code == 200
    r1 = make_runner(client)
    register(client, race["id"], r1["id"], bib="1", distance_km=None)
    client.post(f"/api/v1/races/{race['id']}/start")
    c1 = client.post(f"/api/v1/races/{race['id']}/capture").json()
    a1 = client.post(f"/api/v1/races/{race['id']}/captures/{c1['id']}/assign", json={"bib_number": "1"})
    assert a1.status_code == 200, a1.text
    assert a1.json()["distance_km"] is None
