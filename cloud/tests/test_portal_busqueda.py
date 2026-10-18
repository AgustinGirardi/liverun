"""Búsqueda del portal: sin acentos, sin orden de palabras, con tope avisado,
y migración de name_norm sobre una base que ya tenía resultados."""
from sqlalchemy import text

from cloud import billing
from cloud.db import engine
from cloud.main import SEARCH_LIMIT, _ensure_name_norm_column, normalizar_nombre
from cloud.tests.conftest import make_user, publish_race


def _res(name, bib, pos=1):
    return {"bib_number": str(bib), "full_name": name, "distance_km": 10.0,
            "net_time_ns": 1_800_000_000_000 + bib, "position": pos, "status": "FINISHER"}


def _nombres(client, q):
    return sorted(r["full_name"] for r in client.get("/api/search", params={"q": q}).json()["results"])


def test_normalizar_nombre():
    assert normalizar_nombre("  José  PÉREZ-Núñez ") == "jose perez nunez"
    assert normalizar_nombre("O'Brien") == "o brien"
    assert normalizar_nombre("%%") == ""


def test_busqueda_ignora_acentos_y_mayusculas(client):
    publish_race(client, results=[_res("José Pérez Núñez", 1), _res("Ana Gómez", 2)])
    assert _nombres(client, "jose perez") == ["José Pérez Núñez"]
    assert _nombres(client, "NUÑEZ") == ["José Pérez Núñez"]
    assert _nombres(client, "gomez") == ["Ana Gómez"]


def test_busqueda_no_depende_del_orden_de_las_palabras(client):
    publish_race(client, results=[_res("José Pérez", 1), _res("José Gómez", 2), _res("Pedro Pérez", 3)])
    assert _nombres(client, "perez jose") == ["José Pérez"]
    # Cada palabra tiene que estar (AND), no alcanza con una.
    assert _nombres(client, "jose") == ["José Gómez", "José Pérez"]


def test_busqueda_de_una_letra_avisa(client):
    publish_race(client, results=[_res("Ana Gómez", 1)])
    d = client.get("/api/search", params={"q": "a"}).json()
    assert d["too_short"] is True
    assert d["results"] == [] and d["races"] == []


def test_busqueda_avisa_cuando_hay_mas_que_el_tope(client):
    muchos = [_res(f"Juan García {i}", i, pos=i) for i in range(1, SEARCH_LIMIT + 6)]
    publish_race(client, results=muchos)
    d = client.get("/api/search", params={"q": "garcia"}).json()
    assert len(d["results"]) == SEARCH_LIMIT
    assert d["truncated"] is True
    d = client.get("/api/search", params={"q": "garcia 7"}).json()
    assert d["truncated"] is False


def test_carrera_por_nombre_sin_acentos_y_por_codigo(client):
    pub = publish_race(client, name="Maratón de Río Cuarto", results=[_res("Ana Gómez", 1)])
    assert [r["code"] for r in client.get("/api/search", params={"q": "maraton rio"}).json()["races"]] == [pub["code"]]
    assert [r["code"] for r in client.get("/api/search", params={"q": pub["code"].lower()}).json()["races"]] == [pub["code"]]


def test_migracion_completa_name_norm_en_una_base_vieja(client):
    publish_race(client, results=[_res("José Pérez", 1), _res("Inés Suárez", 2)])
    # Simula una base publicada antes de la columna: name_norm en NULL.
    with engine.begin() as conn:
        conn.execute(text("UPDATE published_results SET name_norm = NULL"))
    assert _nombres(client, "jose") == []
    _ensure_name_norm_column(lote=1)   # lotes chicos: tiene que recorrer todos
    _ensure_name_norm_column()         # idempotente
    assert _nombres(client, "jose perez") == ["José Pérez"]
    assert _nombres(client, "suarez ines") == ["Inés Suárez"]


def test_republicar_recalcula_name_norm(client):
    publish_race(client, results=[_res("Jose Perez", 1)])
    publish_race(client, results=[_res("Josefina Pérez", 1)])
    assert _nombres(client, "josefina") == ["Josefina Pérez"]


def test_error_de_mercado_pago_no_se_muestra_crudo(client, monkeypatch):
    """El 502 de MP le habla al corredor, no le pasa el error técnico."""
    h = make_user(client, email="mp@test.com")
    monkeypatch.setattr(billing, "MP_ACCESS_TOKEN", "TEST-x")
    monkeypatch.setattr(billing, "usd_ars_rate", lambda strict=False: 1000.0)

    def caido(*a, **k):
        raise billing.MPError("invalid payer_email {\"status\":400}")
    monkeypatch.setattr(billing, "mp_request", caido)
    r = client.post("/api/run/billing/subscribe", headers=h)
    assert r.status_code == 502
    det = r.json()["detail"]
    assert "payer_email" not in det
    assert "No se te cobró nada" in det
