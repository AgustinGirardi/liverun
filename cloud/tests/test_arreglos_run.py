"""Regresiones de la API de Run y del portal (revisión): validación de
actividades, fechas en hora argentina, 'Z' en los datetimes, reclamos al
republicar y arranque por lifespan."""
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

import cloud.run as run
from cloud.tests.conftest import make_user, publish_race


def _ahora():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _crear(client, h, uuid="u-1", started=None, dur=1500, dist=5000.0):
    return client.post("/api/run/activities", headers=h, json={
        "client_uuid": uuid,
        "started_at": (started or _ahora() - timedelta(hours=1)).isoformat() + "Z",
        "duration_s": dur, "distance_m": dist,
    })


# ── 8. Actividades creíbles ───────────────────────────────────────────────────

@pytest.mark.parametrize("kw, texto", [
    ({"dur": 1, "dist": 400_000.0}, "corta"),
    ({"dur": 3600, "dist": 101_000.0}, "100 km"),
    ({"dur": 600, "dist": 5000.0}, "ritmo"),                  # 2:00 min/km
    ({"dur": 49 * 3600, "dist": 1000.0}, "48 horas"),
    ({"started": datetime(2099, 1, 1)}, "futuro"),
    ({"started": datetime(2020, 1, 1)}, "más de un año"),
])
def test_actividad_trucha_da_422_en_castellano(client, kw, texto):
    h = make_user(client)
    r = _crear(client, h, **kw)
    assert r.status_code == 422
    assert texto in r.json()["detail"]


def test_actividad_normal_y_tolerancia_de_reloj(client):
    h = make_user(client)
    assert _crear(client, h, uuid="ok").status_code == 200
    # Reloj del teléfono 5 min adelantado: se acepta.
    assert _crear(client, h, uuid="adelantada", started=_ahora() + timedelta(minutes=5)).status_code == 200
    # Ritmo justo en el límite (2:30 min/km) también.
    assert _crear(client, h, uuid="limite", dur=1500, dist=10_000.0).status_code == 200


def test_tope_diario(client):
    h = make_user(client)
    # Mediodía argentino de ayer: las cuatro caen el mismo día.
    base = run.inicio_dia_ar_utc(run.hoy_ar() - timedelta(days=1)) + timedelta(hours=12)
    for i in range(3):
        assert _crear(client, h, uuid=f"d{i}", started=base + timedelta(minutes=i),
                      dur=5 * 3600, dist=45_000.0).status_code == 200
    r = _crear(client, h, uuid="d3", started=base + timedelta(minutes=4), dur=5 * 3600, dist=20_000.0)
    assert r.status_code == 422 and "por día" in r.json()["detail"]


# ── 9. Hora argentina y 'Z' ───────────────────────────────────────────────────

def test_fecha_ar_de_un_domingo_a_la_noche():
    # Domingo 20/9/2026 22:00 en Argentina = lunes 21/9 01:00 UTC.
    assert run.fecha_ar(datetime(2026, 9, 21, 1, 0)) == date(2026, 9, 20)
    assert run.inicio_dia_ar_utc(date(2026, 9, 21)) == datetime(2026, 9, 21, 3, 0)


def _domingo_pasado():
    hoy = run.hoy_ar()
    return hoy - timedelta(days=(hoy.weekday() + 1) % 7 or 7) - timedelta(days=7)


def test_salida_del_domingo_a_la_noche_suma_a_esa_semana(client, monkeypatch):
    domingo = _domingo_pasado()
    lunes_utc = datetime(domingo.year, domingo.month, domingo.day) + timedelta(days=1, hours=1)
    h = make_user(client)
    assert _crear(client, h, started=lunes_utc).status_code == 200
    monkeypatch.setattr(run, "hoy_ar", lambda: domingo)
    s = client.get("/api/run/summary", headers=h).json()
    assert s["week"]["days_run"] == 1
    assert s["month"]["run_dates"] == [domingo.isoformat()]


def test_ranking_de_la_semana_en_hora_argentina(client, monkeypatch):
    domingo = _domingo_pasado()
    lunes_utc = datetime(domingo.year, domingo.month, domingo.day) + timedelta(days=1, hours=1)
    h = make_user(client, email="rk@test.com", username="rkrk")
    assert _crear(client, h, started=lunes_utc).status_code == 200
    # Parado en el lunes siguiente: la salida fue el domingo, semana anterior.
    monkeypatch.setattr(run, "hoy_ar", lambda: domingo + timedelta(days=1))
    r = client.get("/api/run/ranking?period=week&scope=friends", headers=h).json()
    assert r["entries"][0]["km"] == 0
    monkeypatch.setattr(run, "hoy_ar", lambda: domingo)
    r = client.get("/api/run/ranking?period=week&scope=friends", headers=h).json()
    assert r["entries"][0]["km"] == 5.0 and r["entries"][0]["days_run"] == 1
    r = client.get("/api/run/ranking?period=week&scope=global", headers=h).json()
    assert r["entries"][0]["km"] == 5.0 and r["entries"][0]["days_run"] == 1


def test_datetimes_salen_con_z(client):
    h = make_user(client)
    act = _crear(client, h).json()
    assert act["started_at"].endswith("Z")
    assert client.get("/api/run/activities", headers=h).json()[0]["started_at"].endswith("Z")
    prof = client.get("/api/run/profile", headers=h).json()
    assert prof["trial_ends_at"].endswith("Z")


# ── 10. Republicar no pasa reclamos a otra persona ────────────────────────────

def _res(bib, nombre):
    return {"bib_number": bib, "full_name": nombre, "distance_km": 10.0,
            "net_time_ns": 1_800_000_000_000, "position": 1, "status": "FINISHER"}


def _reclamar(client, code):
    h = make_user(client, email="ana@test.com", full_name="Ana Gomez")
    r = client.post("/api/claim", headers=h,
                    json={"code": code, "bib_number": "7", "last_name": "Gomez"})
    assert r.status_code == 200
    return h


def test_dorsales_intercambiados_el_reclamo_sigue_a_la_persona(client):
    pub = publish_race(client, results=[_res("7", "Ana Gomez"), _res("8", "Luis Perez")])
    h = _reclamar(client, pub["code"])
    # El organizador corrige: los dorsales estaban cruzados.
    publish_race(client, results=[_res("7", "Luis Perez"), _res("8", "Ana Gomez")])
    mios = client.get("/api/me/results", headers=h).json()["results"]
    assert [(m["bib_number"], m["full_name"]) for m in mios] == [("8", "Ana Gomez")]


def test_dorsal_reasignado_a_otro_no_arrastra_el_reclamo(client):
    pub = publish_race(client, results=[_res("7", "Ana Gomez")])
    h = _reclamar(client, pub["code"])
    publish_race(client, results=[_res("7", "Carla Diaz")])
    assert client.get("/api/me/results", headers=h).json()["results"] == []


def test_correccion_de_nombre_conserva_el_reclamo(client):
    pub = publish_race(client, results=[_res("7", "Ana Gomez")])
    h = _reclamar(client, pub["code"])
    publish_race(client, results=[_res("7", "Ana María Gómez")])
    assert len(client.get("/api/me/results", headers=h).json()["results"]) == 1


# ── 13 + migración. Arranque por lifespan ─────────────────────────────────────

def test_lifespan_corre_las_migraciones_y_agrega_granted_s(client):
    from cloud.db import engine
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE run_billing_payments"))
        conn.execute(text(
            "CREATE TABLE run_billing_payments (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, "
            "mp_payment_id VARCHAR(64) NOT NULL UNIQUE, amount NUMERIC(12,2), status VARCHAR(20), "
            "created_at DATETIME)"))
        conn.execute(text("INSERT INTO run_billing_payments (user_id, mp_payment_id, status) "
                          "VALUES (1, 'viejo', 'approved')"))
    for _ in range(2):   # idempotente: dos arranques seguidos
        with TestClient(run_app()) as c:
            assert c.get("/api/races").status_code == 200
    with engine.begin() as conn:
        cols = [r[1] for r in conn.execute(text("PRAGMA table_info(run_billing_payments)"))]
        filas = conn.execute(text("SELECT mp_payment_id, granted_s FROM run_billing_payments")).all()
    assert "granted_s" in cols
    assert filas == [("viejo", None)]    # los datos existentes quedan intactos


def run_app():
    from cloud.main import app
    return app
