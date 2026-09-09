"""Avatar de perfil y ranking global de ChronoTrack Run."""
import io
from datetime import datetime

from sqlalchemy import select

import cloud.run as run
from cloud.models import PortalUser
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


def test_avatar_se_guarda_relativo_y_se_sirve_absoluto(client, db):
    """Guardar el host adentro dejaba las filas viejas apuntando al dominio
    anterior para siempre. Se guarda relativo y se absolutiza al responder."""
    h = make_user(client, email="rel@test.com")
    r = _upload(client, h)
    assert r.status_code == 200, r.text

    u = db.scalar(select(PortalUser).where(PortalUser.email == "rel@test.com"))
    assert u.avatar_url.startswith("/avatars/")
    assert r.json()["avatar_url"] == f"{run.PUBLIC_URL}{u.avatar_url}"


def test_migracion_pasa_avatares_viejos_a_relativo(client, db):
    """La migración recorta el host de las filas ya guardadas y no toca la foto
    de Google, que es una URL externa legítima."""
    from cloud.main import _migrar_avatares_a_relativo

    make_user(client, email="viejo@test.com")
    make_user(client, email="google@test.com")
    viejo = db.scalar(select(PortalUser).where(PortalUser.email == "viejo@test.com"))
    goog = db.scalar(select(PortalUser).where(PortalUser.email == "google@test.com"))
    viejo.avatar_url = "https://host-anterior.com/avatars/7.png?v=1"
    goog.avatar_url = "https://lh3.googleusercontent.com/a/foto"
    db.commit()

    _migrar_avatares_a_relativo()
    db.rollback()
    db.refresh(viejo)
    db.refresh(goog)
    assert viejo.avatar_url == "/avatars/7.png?v=1"
    assert goog.avatar_url == "https://lh3.googleusercontent.com/a/foto"
