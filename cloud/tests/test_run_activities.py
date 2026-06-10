"""Actividades de ChronoTrack Run: creación, dedupe por client_uuid, listado y detalle."""
from datetime import datetime, timedelta

from cloud.tests.conftest import make_user


def crear(client, headers, uuid="uuid-0001-test", started=None, dist=5000.0, dur=1500, **extra):
    body = {
        "client_uuid": uuid,
        "started_at": (started or datetime.now()).isoformat(),
        "duration_s": dur,
        "distance_m": dist,
        **extra,
    }
    return client.post("/api/run/activities", json=body, headers=headers)


def test_crear_actividad_calcula_ritmo(client):
    h = make_user(client)
    r = crear(client, h, dist=5000.0, dur=1500)  # 5 km en 25 min
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["duplicated"] is False
    assert data["avg_pace_s_per_km"] == 300.0  # 5:00 min/km


def test_dedupe_por_client_uuid(client):
    h = make_user(client)
    assert crear(client, h, uuid="repetida").json()["duplicated"] is False
    r = crear(client, h, uuid="repetida")
    assert r.status_code == 200
    assert r.json()["duplicated"] is True
    assert len(client.get("/api/run/activities", headers=h).json()) == 1


def test_mismo_uuid_distinto_usuario_no_choca(client):
    h1 = make_user(client, email="a@test.com")
    h2 = make_user(client, email="b@test.com")
    assert crear(client, h1, uuid="compartida").json()["duplicated"] is False
    assert crear(client, h2, uuid="compartida").json()["duplicated"] is False


def test_listado_ordenado_y_liviano(client):
    h = make_user(client)
    base = datetime(2026, 6, 1, 8, 0)
    for i in range(3):
        crear(client, h, uuid=f"u-{i}", started=base + timedelta(days=i))
    acts = client.get("/api/run/activities", headers=h).json()
    assert [a["client_uuid"] for a in acts] == ["u-2", "u-1", "u-0"]  # más reciente primero
    assert "polyline" not in acts[0]  # el listado no arrastra el recorrido


def test_detalle_con_splits_y_polyline(client):
    h = make_user(client)
    r = crear(client, h, splits=[290.5, 300.2], polyline="abc123xyz")
    act_id = r.json()["id"]
    detail = client.get(f"/api/run/activities/{act_id}", headers=h).json()
    assert detail["splits"] == [290.5, 300.2]
    assert detail["polyline"] == "abc123xyz"


def test_actividad_ajena_404(client):
    h1 = make_user(client, email="a@test.com")
    h2 = make_user(client, email="b@test.com")
    act_id = crear(client, h1).json()["id"]
    assert client.get(f"/api/run/activities/{act_id}", headers=h2).status_code == 404


def test_summary_semana_y_mes(client):
    h = make_user(client)
    now = datetime.now()
    crear(client, h, uuid="hoy", started=now, dist=5000.0)
    s = client.get("/api/run/summary", headers=h).json()
    assert s["week"]["days_run"] == 1
    assert s["week"]["goal"] == 3
    assert s["week"]["km"] == 5.0
    assert s["month"]["activities"] == 1
    assert s["month"]["run_dates"] == [now.date().isoformat()]
