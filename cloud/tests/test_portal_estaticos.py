"""Archivos del portal: caché explícita, CSP sin scripts en línea y lo que
necesita la tabla de una carrera."""
from cloud.tests.conftest import publish_race


def test_html_js_y_css_se_revalidan_siempre(client):
    for ruta in ("/", "/js/app.js", "/js/pantallas/inicio.js", "/styles.css"):
        r = client.get(ruta)
        assert r.status_code == 200, ruta
        assert r.headers["cache-control"] == "no-cache", ruta


def test_modulos_con_tipo_javascript(client):
    r = client.get("/js/app.js")
    assert "javascript" in r.headers["content-type"]


def test_imagenes_se_guardan_un_dia(client):
    assert client.get("/logo.svg").headers["cache-control"] == "public, max-age=86400"


def test_la_api_no_lleva_cache_del_portal(client):
    assert "cache-control" not in client.get("/api/races").headers


def test_csp_no_permite_scripts_en_linea(client):
    csp = client.get("/").headers["content-security-policy"]
    script = next(p for p in csp.split(";") if p.strip().startswith("script-src"))
    assert "'unsafe-inline'" not in script


def test_index_no_tiene_handlers_en_linea(client):
    html = client.get("/").text
    assert " onclick=" not in html and "<script>" not in html


def test_detalle_de_carrera_trae_result_id(client):
    publish_race(client, results=[{"bib_number": "7", "full_name": "Ana Gómez", "distance_km": 10.0,
                                   "net_time_ns": 1_800_000_000_000, "position": 1, "status": "FINISHER"}])
    code = client.get("/api/races").json()[0]["code"]
    res = client.get(f"/api/races/{code}").json()["results"][0]
    assert isinstance(res["result_id"], int)
    busq = client.get("/api/search", params={"q": "ana gomez"}).json()["results"][0]
    assert busq["result_id"] == res["result_id"]
