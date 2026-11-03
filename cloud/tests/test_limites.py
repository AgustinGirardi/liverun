"""Tamaños de entrada (OWASP API4, ASVS V5): un body o una lista sin tope es un
pedido barato que le cuesta caro al servidor."""

from cloud.tests.conftest import PUBLISH_KEY, make_user

CLAVE = {"X-API-Key": PUBLISH_KEY}
JSON = {"Content-Type": "application/json"}


def _resultado(i):
    return {"bib_number": str(i), "full_name": "Juan Perez", "net_time_ns": 1, "status": "FINISHER"}


def test_body_enorme_se_corta_con_413(client):
    relleno = "x" * (20 * 1024 * 1024)
    cuerpo = ('{"source_id": "ct-grande", "name": "' + relleno + '"}').encode()
    r = client.post("/api/publish", content=cuerpo, headers={**CLAVE, **JSON})
    assert r.status_code == 413


def test_413_si_el_content_length_declarado_ya_excede_el_tope(client):
    r = client.post("/api/publish", content=b"{}", headers={**CLAVE, **JSON, "Content-Length": str(50 * 1024 * 1024)})
    assert r.status_code == 413


def test_publicar_con_demasiados_resultados_se_rechaza(client):
    payload = {
        "source_id": "ct-muchos",
        "name": "Carrera",
        "distances": [10.0],
        "results": [_resultado(i) for i in range(50_001)],
    }
    r = client.post("/api/publish", json=payload, headers=CLAVE)
    assert r.status_code in (413, 422)


def test_publicar_un_lote_normal_sigue_andando(client):
    payload = {
        "source_id": "ct-normal",
        "name": "Carrera",
        "distances": [10.0],
        "results": [_resultado(i) for i in range(2_000)],
    }
    assert client.post("/api/publish", json=payload, headers=CLAVE).status_code == 200


def test_avatar_que_no_es_una_imagen_se_rechaza(client):
    h = make_user(client)
    falso = ("a.png", b"no soy una imagen" * 10, "image/png")
    r = client.post("/api/run/profile/avatar", files={"file": falso}, headers=h)
    assert r.status_code in (400, 415, 422)


def test_avatar_demasiado_grande_se_rechaza(client):
    h = make_user(client)
    grande = ("a.png", b"\x89PNG\r\n\x1a\n" + b"0" * (6 * 1024 * 1024), "image/png")
    r = client.post("/api/run/profile/avatar", files={"file": grande}, headers=h)
    assert r.status_code in (400, 413, 422)
