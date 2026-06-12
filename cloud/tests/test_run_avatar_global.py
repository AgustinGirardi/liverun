"""Avatar de perfil y ranking global de ChronoTrack Run."""
import io
from datetime import datetime

from cloud.tests.conftest import make_user

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"0" * 100


def _upload(client, headers, content=PNG_BYTES, mime="image/png"):
    return client.post(
        "/api/run/profile/avatar",
        files={"file": ("foto.png", io.BytesIO(content), mime)},
        headers=headers,
    )


def test_subir_avatar_actualiza_perfil_y_se_sirve(client):
    h = make_user(client)
    r = _upload(client, h)
    assert r.status_code == 200, r.text
    url = r.json()["avatar_url"]
    assert "/avatars/" in url
    # El archivo queda servido como estático (ruta relativa al host del test).
    path = "/" + url.split("/", 3)[3].split("?")[0]
    assert client.get(path).status_code == 200


def test_avatar_rechaza_formato_y_tamano(client):
    h = make_user(client)
    assert _upload(client, h, mime="application/pdf").status_code == 400
    grande = b"x" * (2 * 1024 * 1024 + 1)
    assert _upload(client, h, content=grande).status_code == 413


def _activity(client, headers, uuid, dist):
    return client.post("/api/run/activities", json={
        "client_uuid": uuid, "started_at": datetime.now().isoformat(),
        "duration_s": 1800, "distance_m": dist,
    }, headers=headers)


def test_ranking_global_incluye_a_todos_y_ordena(client):
    h1 = make_user(client, email="ana@test.com", username="ana")
    h2 = make_user(client, email="beto@test.com", username="beto")  # NO son amigos
    _activity(client, h1, "a1", 5000.0)
    _activity(client, h2, "b1", 12000.0)

    rk = client.get("/api/run/ranking?period=week&scope=global", headers=h1).json()
    usernames = [e["username"] for e in rk["entries"]]
    assert usernames == ["beto", "ana"]  # global: aparecen aunque no sean amigos
    assert rk["entries"][0]["position"] == 1
    assert rk["entries"][1]["is_me"] is True


def test_ranking_global_sin_actividad_aparece_en_cero(client):
    make_user(client, email="ana@test.com", username="ana")
    h2 = make_user(client, email="beto@test.com", username="beto")
    rk = client.get("/api/run/ranking?scope=global", headers=h2).json()
    me = [e for e in rk["entries"] if e["is_me"]][0]
    assert me["km"] == 0.0
    assert me["position"] is None


def test_ranking_scope_invalido_400(client):
    h = make_user(client)
    assert client.get("/api/run/ranking?scope=galaxia", headers=h).status_code == 400


def test_ranking_amigos_sigue_funcionando_con_posiciones(client):
    h1 = make_user(client, email="ana@test.com", username="ana")
    make_user(client, email="beto@test.com", username="beto")
    _activity(client, h1, "a1", 5000.0)
    rk = client.get("/api/run/ranking?period=week", headers=h1).json()
    assert rk["scope"] == "friends"
    assert [e["username"] for e in rk["entries"]] == ["ana"]  # beto no es amigo
    assert rk["entries"][0]["position"] == 1
