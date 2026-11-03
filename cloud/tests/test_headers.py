"""Headers y CORS (OWASP A05, CIS 4): los headers defensivos que faltaban, CORS
acotado a lo que usa la app y arranque que falla sin CT_PUBLIC_URL en producción."""

import pytest

from cloud import main
from cloud.deps import PUBLIC_URL


def test_headers_nuevos_en_las_respuestas(client):
    h = client.get("/api/health").headers
    assert "camera=()" in h["Permissions-Policy"]
    assert "microphone=()" in h["Permissions-Policy"]
    assert h["Cross-Origin-Opener-Policy"] == "same-origin"
    assert h["Cross-Origin-Resource-Policy"] == "same-origin"


def test_los_headers_viejos_siguen(client):
    h = client.get("/api/health").headers
    assert h["X-Content-Type-Options"] == "nosniff"
    assert h["X-Frame-Options"] == "DENY"
    assert "frame-ancestors 'none'" in h["Content-Security-Policy"]


def _preflight(client, metodo="GET", headers="authorization", origen=PUBLIC_URL):
    return client.options(
        "/api/races",
        headers={
            "Origin": origen,
            "Access-Control-Request-Method": metodo,
            "Access-Control-Request-Headers": headers,
        },
    )


def test_cors_acepta_lo_que_usa_la_app(client):
    r = _preflight(client, "POST", "authorization,content-type,x-api-key")
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == PUBLIC_URL


@pytest.mark.parametrize("metodo", ["TRACE", "CONNECT"])
def test_cors_rechaza_metodos_que_la_app_no_usa(client, metodo):
    assert _preflight(client, metodo).status_code == 400


def test_cors_rechaza_headers_arbitrarios(client):
    assert _preflight(client, "GET", "x-header-inventado").status_code == 400


def test_cors_no_devuelve_comodines(client):
    r = _preflight(client, "POST", "authorization")
    assert "*" not in r.headers.get("access-control-allow-methods", "")
    assert "*" not in r.headers.get("access-control-allow-headers", "")


def test_cors_rechaza_origenes_ajenos(client):
    assert _preflight(client, origen="https://evil.example").status_code == 400


def _produccion_con_secretos(monkeypatch):
    monkeypatch.setenv("CT_PRODUCCION", "1")
    monkeypatch.setattr("cloud.security.SECRET", "un-secreto-de-prueba-largo")
    monkeypatch.setattr(main, "PUBLISH_API_KEY", "una-clave-de-prueba")


def test_produccion_sin_public_url_frena_el_arranque(monkeypatch):
    _produccion_con_secretos(monkeypatch)
    monkeypatch.delenv("CT_PUBLIC_URL", raising=False)
    with pytest.raises(RuntimeError, match="CT_PUBLIC_URL"):
        main._startup()


def test_produccion_con_public_url_arranca(monkeypatch):
    _produccion_con_secretos(monkeypatch)
    monkeypatch.setenv("CT_PUBLIC_URL", "https://liverun.example")
    main._startup()
