"""Control de acceso (OWASP API1/API5, ISO A.5.15): toda ruta del portal exige
credenciales salvo las de esta lista blanca. Si aparece una ruta nueva sin
autenticación, este test falla hasta que alguien la declare pública a propósito.

Se prueba por fuera (sin credenciales) y no mirando las dependencias, así vale
aunque la autorización se resuelva dentro del handler."""

import re

import pytest

from cloud.main import app

# Rutas públicas a propósito: lectura de resultados, entrada de cuentas, links
# de mail (llevan token firmado), OAuth de Google y el webhook de Mercado Pago
# (se autentica por firma).
PUBLICAS = {
    ("GET", "/api/races"),
    ("GET", "/api/races/{code}"),
    ("GET", "/api/search"),
    ("GET", "/api/events"),
    ("GET", "/api/run/ranking"),
    ("GET", "/api/run/billing/mode"),
    ("GET", "/api/run/auth/google/start"),
    ("GET", "/api/run/auth/google/callback"),
    ("POST", "/api/auth/register"),
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/password/forgot"),
    ("POST", "/api/auth/password/reset"),
    ("POST", "/api/auth/verify"),
    ("POST", "/api/run/billing/webhook"),
}

# Rutas cuyo cuerpo se valida antes que la credencial: con `{}` darían 422 y no
# probarían nada, así que se les manda un cuerpo válido.
CUERPOS = {
    ("POST", "/api/publish"): {"source_id": "ct-x", "name": "x", "distances": [10.0], "results": []},
    ("POST", "/api/events"): {"source_id": "ct-x", "name": "x"},
}


def _rutas():
    esquema = app.openapi()["paths"]
    return sorted((m.upper(), p) for p, ops in esquema.items() for m in ops)


@pytest.mark.parametrize(("metodo", "path"), [r for r in _rutas() if r not in PUBLICAS])
def test_ruta_no_publica_rechaza_pedidos_sin_credenciales(client, metodo, path):
    url = re.sub(r"\{[a-z_]+\}", "1", path)
    r = client.request(metodo, url, json=CUERPOS.get((metodo, path), {}))
    assert r.status_code in (401, 403), f"{metodo} {path} respondió {r.status_code} sin credenciales"


def test_la_lista_blanca_no_tiene_rutas_que_ya_no_existen():
    assert PUBLICAS <= set(_rutas())
