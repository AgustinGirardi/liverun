"""Respaldo y restauración: lo que se usa el día de la carrera si algo sale mal."""
from backend.tests.conftest import make_runner, make_race, register

API = "/api/v1"


def test_respaldo_y_restauracion_conservan_la_carrera(client):
    race = make_race(client, name="Carrera respaldada")
    runner = make_runner(client)
    register(client, race["id"], runner["id"], bib="7")
    client.post(f"{API}/races/{race['id']}/start", json={"click_delay_ms": 60_000})
    cap = client.post(f"{API}/races/{race['id']}/capture").json()
    assert client.post(f"{API}/races/{race['id']}/captures/{cap['id']}/assign", json={"bib_number": "7"}).status_code == 200
    antes = client.get(f"{API}/races/{race['id']}/results").json()["results"]

    r = client.get(f"{API}/backup")
    assert r.status_code == 200 and r.content.startswith(b"SQLite format 3")
    respaldo = r.content

    # Algo sale mal después del respaldo: se borra la carrera
    assert client.delete(f"{API}/races/{race['id']}").status_code == 204
    assert client.get(f"{API}/races/{race['id']}").status_code == 404

    r = client.post(f"{API}/restore", files={"file": ("r.ctbackup", respaldo, "application/octet-stream")})
    assert r.status_code == 200, r.text
    # Sin reiniciar: el engine se recrea solo en la próxima consulta
    assert client.get(f"{API}/races/{race['id']}").json()["name"] == "Carrera respaldada"
    assert client.get(f"{API}/races/{race['id']}/results").json()["results"] == antes


def test_restaurar_rechaza_archivos_que_no_son_respaldos(client):
    r = client.post(f"{API}/restore", files={"file": ("x.ctbackup", b"no soy una base", "application/octet-stream")})
    assert r.status_code == 400
