"""Regresiones de la revisión de pérdida de datos (rama arreglos-revision)."""
import asyncio
import csv
import io
import json
import sqlite3
import time

import pytest

from backend.core.database import engine, AsyncSessionLocal, DB_PATH, init_db
from backend.services import email_service
from backend.services.timing_engine import get_engine
from backend.tests.conftest import make_runner, make_race, register

API = "/api/v1"


def _captura(client, race_id, **body):
    r = client.post(f"{API}/races/{race_id}/capture", json=body or None)
    assert r.status_code == 200, r.text
    return r.json()


def _asignar(client, race_id, cap_id, bib):
    return client.post(f"{API}/races/{race_id}/captures/{cap_id}/assign", json={"bib_number": bib})


# ── 1. Captura por HTTP (respaldo del WebSocket) ─────────────────────────────

def test_captura_http_respeta_la_demora_del_cliente(client):
    race = make_race(client)
    antes = time.time_ns()
    cap = _captura(client, race["id"], delay_ms=5000)
    # La captura quedó 5 s antes de la hora del servidor
    assert antes - 6_000_000_000 < cap["captured_ns"] < antes - 4_000_000_000


# ── 2. ERROR por WebSocket con la captura ────────────────────────────────────

def test_ws_error_incluye_capture_id(client):
    race = make_race(client)
    runner = make_runner(client)
    register(client, race["id"], runner["id"], bib="7")
    cap = _captura(client, race["id"])
    with client.websocket_connect(f"{API}/ws/races/{race['id']}/timing") as ws:
        ws.send_text(json.dumps({"action": "assign", "capture_id": cap["id"], "bib": "999"}))
        msg = json.loads(ws.receive_text())
    assert msg["event"] == "ERROR"
    assert msg["data"]["capture_id"] == cap["id"]
    assert "999" in msg["data"]["message"]


# ── 3. No se captura en carreras finalizadas ─────────────────────────────────

def test_captura_rechazada_en_carrera_finalizada(client):
    race = make_race(client)
    client.patch(f"{API}/races/{race['id']}", json={"status": "FINISHED"})
    r = client.post(f"{API}/races/{race['id']}/capture")
    assert r.status_code == 409
    assert client.get(f"{API}/races/{race['id']}/captures").json() == []


# ── 5. results trae capture_id (deshacer tras recargar) ─────────────────────

def test_results_trae_capture_id_y_permite_deshacer(client):
    race = make_race(client)
    runner = make_runner(client)
    register(client, race["id"], runner["id"], bib="7")
    client.post(f"{API}/races/{race['id']}/start")
    cap = _captura(client, race["id"])
    assert _asignar(client, race["id"], cap["id"], "7").status_code == 200

    fila = client.get(f"{API}/races/{race['id']}/results").json()["results"][0]
    assert fila["capture_id"] == cap["id"]
    r = client.post(f"{API}/races/{race['id']}/captures/{fila['capture_id']}/undo")
    assert r.status_code == 200
    assert client.get(f"{API}/races/{race['id']}/results").json()["total_finishers"] == 0


# ── 6. Tiempo bruto / sin largada ────────────────────────────────────────────

def _csv(client, race_id):
    rows = list(csv.reader(io.StringIO(client.get(f"{API}/races/{race_id}/export/csv").text)))
    return rows[0], rows[1]


def test_csv_tiempo_bruto_es_una_duracion(client):
    race = make_race(client)
    runner = make_runner(client)
    register(client, race["id"], runner["id"], bib="7")
    client.post(f"{API}/races/{race['id']}/start", json={"click_delay_ms": 60_000})
    cap = _captura(client, race["id"])
    _asignar(client, race["id"], cap["id"], "7")
    header, fila = _csv(client, race["id"])
    bruto = fila[header.index("Tiempo Bruto")]
    assert bruto.startswith("00:01:0"), bruto  # ~1 minuto, no "497000:..."
    assert fila[header.index("Hora Llegada")].count(":") == 2


def test_csv_sin_largada_no_muestra_numeros_absurdos(client):
    race = make_race(client)
    runner = make_runner(client)
    register(client, race["id"], runner["id"], bib="7")
    cap = _captura(client, race["id"])
    _asignar(client, race["id"], cap["id"], "7")
    header, fila = _csv(client, race["id"])
    assert fila[header.index("Tiempo Neto")] == ""
    assert fila[header.index("Tiempo Bruto")] == ""
    hora = fila[header.index("Hora Llegada")]
    assert len(hora.split(":")[0]) == 2  # hh:mm:ss.cc


def test_email_sin_largada_muestra_hora_de_llegada():
    html = email_service.build_result_email(
        runner_name="Ana", race_name="X", race_date=None, location=None, distance_km=10,
        net_time_ns=None, finish_time_ns=time.time_ns(), position=1, category=None,
    )
    assert "Hora de llegada" in html
    assert "4970" not in html and "4980" not in html  # nada de horas epoch


def test_patch_planned_a_active_sin_largada_rechazado(client):
    race = make_race(client)
    r = client.patch(f"{API}/races/{race['id']}", json={"status": "ACTIVE"})
    assert r.status_code == 400
    # Reabrir una finalizada (aunque se haya corrido sin largada) sigue andando
    client.patch(f"{API}/races/{race['id']}", json={"status": "FINISHED"})
    assert client.patch(f"{API}/races/{race['id']}", json={"status": "ACTIVE"}).status_code == 200


# ── 7. Largada: demora del click, corrección y por distancia ─────────────────

def test_largada_toma_el_instante_del_click(client):
    race = make_race(client)
    antes = time.time_ns()
    r = client.post(f"{API}/races/{race['id']}/start", json={"click_delay_ms": 3000})
    assert r.status_code == 200
    assert antes - 4_000_000_000 < r.json()["race_start_ns"] < antes - 2_000_000_000
    # Segunda largada general: rechazada (para eso está la corrección)
    assert client.post(f"{API}/races/{race['id']}/start").status_code == 400


def test_corregir_largada_recalcula_netos(client):
    race = make_race(client)
    runner = make_runner(client)
    register(client, race["id"], runner["id"], bib="7")
    start = client.post(f"{API}/races/{race['id']}/start").json()["race_start_ns"]
    cap = _captura(client, race["id"])
    _asignar(client, race["id"], cap["id"], "7")

    nuevo = start - 30 * 60 * 1_000_000_000  # la largada real fue 30 min antes
    r = client.post(f"{API}/races/{race['id']}/start/adjust", json={"start_ns": nuevo})
    assert r.status_code == 200, r.text
    assert r.json()["race_start_ns"] == nuevo
    fila = client.get(f"{API}/races/{race['id']}/results").json()["results"][0]
    assert fila["net_time_ns"] == cap["captured_ns"] - nuevo

    # Una largada posterior a una llegada dejaría tiempos negativos
    r = client.post(f"{API}/races/{race['id']}/start/adjust", json={"start_ns": cap["captured_ns"] + 1})
    assert r.status_code == 400
    assert client.get(f"{API}/races/{race['id']}").json()["race_start_ns"] == nuevo


def test_largada_por_distancia(client):
    race = make_race(client)
    a = make_runner(client, first="Ana")
    b = make_runner(client, first="Beto")
    register(client, race["id"], a["id"], bib="21", distance_km=21.0)
    register(client, race["id"], b["id"], bib="10", distance_km=10.0)

    r21 = client.post(f"{API}/races/{race['id']}/start", json={"distance_km": 21.0, "click_delay_ms": 120_000})
    assert r21.status_code == 200, r21.text
    r10 = client.post(f"{API}/races/{race['id']}/start", json={"distance_km": 10.0, "click_delay_ms": 60_000})
    assert r10.status_code == 200, r10.text
    # la misma distancia no larga dos veces
    assert client.post(f"{API}/races/{race['id']}/start", json={"distance_km": 10.0}).status_code == 400

    s21, s10 = r21.json()["start_ns"], r10.json()["start_ns"]
    carrera = client.get(f"{API}/races/{race['id']}").json()
    assert carrera["status"] == "ACTIVE"
    assert carrera["race_start_ns"] == s21  # la primera largada es la general
    assert {s["distance_km"]: s["start_ns"] for s in carrera["starts"]} == {21.0: s21, 10.0: s10}

    c1 = _captura(client, race["id"])
    c2 = _captura(client, race["id"])
    body10 = _asignar(client, race["id"], c1["id"], "10").json()
    assert body10["net_time_ns"] == c1["captured_ns"] - s10
    _asignar(client, race["id"], c2["id"], "21")

    res = {r["bib_number"]: r for r in client.get(f"{API}/races/{race['id']}/results").json()["results"]}
    assert res["10"]["net_time_ns"] == c1["captured_ns"] - s10
    assert res["21"]["net_time_ns"] == c2["captured_ns"] - s21
    assert res["10"]["position"] == 1 and res["21"]["position"] == 1

    # Corregir sólo la de 10K no toca la de 21K
    r = client.post(f"{API}/races/{race['id']}/start/adjust", json={"distance_km": 10.0, "start_ns": s10 - 1_000_000_000})
    assert r.status_code == 200, r.text
    res = {r["bib_number"]: r for r in client.get(f"{API}/races/{race['id']}/results").json()["results"]}
    assert res["10"]["net_time_ns"] == c1["captured_ns"] - s10 + 1_000_000_000
    assert res["21"]["net_time_ns"] == c2["captured_ns"] - s21


def test_borrar_carrera_con_largadas_por_distancia(client):
    race = make_race(client)
    client.post(f"{API}/races/{race['id']}/start", json={"distance_km": 5.0})
    client.patch(f"{API}/races/{race['id']}", json={"status": "FINISHED"})
    assert client.delete(f"{API}/races/{race['id']}").status_code == 204


# ── 8. source_id estable por instalación ────────────────────────────────────

def _db_sql(sql, params=()):
    con = sqlite3.connect(str(DB_PATH))
    try:
        cur = con.execute(sql, params)
        con.commit()
        return cur.fetchall()
    finally:
        con.close()


def test_source_id_uuid_para_nuevas_y_distinto_al_duplicar(client):
    race = make_race(client)
    sid = _db_sql("SELECT cloud_source_id FROM races WHERE id=?", (race["id"],))[0][0]
    assert sid.startswith("ct-") and len(sid) == 35 and sid != f"ct-race-{race['id']}"
    dup = client.post(f"{API}/races/{race['id']}/duplicate").json()
    sid2 = _db_sql("SELECT cloud_source_id FROM races WHERE id=?", (dup["id"],))[0][0]
    assert sid2.startswith("ct-") and sid2 != sid


def test_migracion_conserva_ct_race_id_en_carreras_viejas(client):
    race = make_race(client)
    # Simular una base de la versión anterior: sin la columna ni race_starts
    asyncio.run(engine.dispose())
    _db_sql("ALTER TABLE races DROP COLUMN cloud_source_id")
    _db_sql("DROP TABLE race_starts")

    async def migrar_dos_veces():
        await init_db()
        await init_db()  # idempotente
        await engine.dispose()
    asyncio.run(migrar_dos_veces())

    assert _db_sql("SELECT cloud_source_id FROM races WHERE id=?", (race["id"],))[0][0] == f"ct-race-{race['id']}"
    assert _db_sql("SELECT name FROM sqlite_master WHERE name='race_starts'")


class _PortalFalso:
    """Reemplaza urllib.request.urlopen y guarda lo que se publicó."""
    def __init__(self):
        self.payloads = []

    def __call__(self, req, timeout=None):
        self.payloads.append((req.full_url, json.loads(req.data) if req.data else None))
        portal = self

        class _Resp:
            status = 200
            def read(self_inner):
                return json.dumps({"code": "ABC123", "published_results": 1}).encode()
            def __enter__(self_inner): return self_inner
            def __exit__(self_inner, *a): return False
        return _Resp()


@pytest.fixture
def portal(monkeypatch):
    from backend.api import routes
    falso = _PortalFalso()
    monkeypatch.setattr(routes.cloud_config, "load_config", lambda: {"url": "https://portal.test", "api_key": "k"})
    monkeypatch.setattr(routes.urllib.request, "urlopen", falso)
    return falso


def test_publicar_usa_cloud_source_id_y_distancia_de_dnf(client, portal):
    race = make_race(client)
    client.patch(f"{API}/races/{race['id']}", json={"distance_km": 10.0})
    a = make_runner(client, first="Ana")
    b = make_runner(client, first="Beto")
    register(client, race["id"], a["id"], bib="1", distance_km=None)
    reg_b = register(client, race["id"], b["id"], bib="2", distance_km=None)
    client.patch(f"{API}/races/{race['id']}/registrations/{reg_b['id']}/status", json={"status": "DNF"})
    client.post(f"{API}/races/{race['id']}/start")
    cap = _captura(client, race["id"])
    _asignar(client, race["id"], cap["id"], "1")

    r = client.post(f"{API}/races/{race['id']}/publish")
    assert r.status_code == 200, r.text
    url, payload = portal.payloads[-1]
    sid = _db_sql("SELECT cloud_source_id FROM races WHERE id=?", (race["id"],))[0][0]
    assert payload["source_id"] == sid
    dist = {row["bib_number"]: row["distance_km"] for row in payload["results"]}
    assert dist == {"1": 10.0, "2": 10.0}  # el DNF con el mismo fallback que el finisher


def test_publicar_sin_largada_rechazado(client, portal):
    race = make_race(client)
    runner = make_runner(client)
    register(client, race["id"], runner["id"], bib="7")
    cap = _captura(client, race["id"])
    _asignar(client, race["id"], cap["id"], "7")
    client.patch(f"{API}/races/{race['id']}", json={"status": "FINISHED"})
    r = client.post(f"{API}/races/{race['id']}/publish")
    assert r.status_code == 409
    assert portal.payloads == []


def test_despublicar_al_borrar_usa_cloud_source_id(client, portal):
    race = make_race(client)
    sid = _db_sql("SELECT cloud_source_id FROM races WHERE id=?", (race["id"],))[0][0]
    assert client.delete(f"{API}/races/{race['id']}").status_code == 204
    assert portal.payloads[-1][0].endswith(f"/api/publish/{sid}")


# ── 10. Doble asignación concurrente / capturas de otra carrera ──────────────

def test_asignacion_concurrente_del_mismo_dorsal(client, monkeypatch):
    from sqlalchemy.ext.asyncio import AsyncSession
    commit_original = AsyncSession.commit

    async def commit_lento(self):
        # Fuerza a que las dos asignaciones se intercalen entre el chequeo y el insert.
        await asyncio.sleep(0.05)
        return await commit_original(self)

    race = make_race(client)
    runner = make_runner(client)
    register(client, race["id"], runner["id"], bib="7")
    client.post(f"{API}/races/{race['id']}/start")
    c1 = _captura(client, race["id"])
    c2 = _captura(client, race["id"])

    async def dos_a_la_vez():
        eng = get_engine(race["id"])
        monkeypatch.setattr(AsyncSession, "commit", commit_lento)

        async def asignar(cid):
            async with AsyncSessionLocal() as db:
                try:
                    await eng.assign_bib(db, cid, "7")
                    return "ok"
                except ValueError:
                    return "rechazada"
        try:
            return await asyncio.gather(asignar(c1["id"]), asignar(c2["id"]))
        finally:
            monkeypatch.setattr(AsyncSession, "commit", commit_original)
            await engine.dispose()

    # El engine del TestClient tiene su lock atado a otro loop: usar uno nuevo.
    from backend.services import timing_engine
    timing_engine.reset_engines()
    assert sorted(asyncio.run(dos_a_la_vez())) == ["ok", "rechazada"]
    assert client.get(f"{API}/races/{race['id']}/results").json()["total_finishers"] == 1


def test_no_se_opera_una_captura_de_otra_carrera(client):
    r1 = make_race(client, name="Uno")
    r2 = make_race(client, name="Dos")
    runner = make_runner(client)
    register(client, r2["id"], runner["id"], bib="7")
    cap = _captura(client, r1["id"])
    assert _asignar(client, r2["id"], cap["id"], "7").status_code == 400
    assert client.delete(f"{API}/races/{r2['id']}/captures/{cap['id']}").status_code == 400
    assert client.post(f"{API}/races/{r2['id']}/captures/{cap['id']}/undo").status_code == 400
    # la captura sigue pendiente en su carrera
    assert client.get(f"{API}/races/{r1['id']}/captures?status=PENDING").json()[0]["id"] == cap["id"]


# ── 14. Import de inscriptos ─────────────────────────────────────────────────

def _importar(client, race_id, nombre, contenido: bytes):
    return client.post(f"{API}/races/{race_id}/import", files={"file": (nombre, contenido)})


def test_import_distancias_con_coma_y_sufijo(client):
    race = make_race(client)
    texto = (
        "dorsal,nombre,apellido,distancia\n"
        "1,Ana,Gomez,\"21,1\"\n"
        "2,Beto,Lopez,10K\n"
        "3,Caro,Diaz,5 km\n"
        "4,Dani,Paz,media\n"
    )
    r = _importar(client, race["id"], "inscriptos.csv", texto.encode())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["created"] == 4
    assert len(body["warnings"]) == 1 and "Fila 4" in body["warnings"][0] and "media" in body["warnings"][0]
    regs = {x["bib_number"]: x["distance_km"] for x in client.get(f"{API}/races/{race['id']}/registrations").json()}
    assert regs == {"1": 21.1, "2": 10.0, "3": 5.0, "4": None}


def test_import_con_atletas_duplicados_no_revienta(client):
    make_runner(client, first="Ana", last="Gomez")
    make_runner(client, first="Ana", last="Gomez")
    race = make_race(client)
    r = _importar(client, race["id"], "i.csv", b"dorsal,nombre,apellido\n1,Ana,Gomez\n")
    assert r.status_code == 200, r.text
    assert r.json()["created"] == 1


def test_import_xls_rechazado_con_mensaje(client):
    race = make_race(client)
    r = _importar(client, race["id"], "viejo.xls", b"\xd0\xcf\x11\xe0basura")
    assert r.status_code == 400
    assert ".xlsx" in r.json()["detail"]
