"""API keys de publicación por organizador: emisión, rotación, revocación y
propiedad de las carreras. La CT_PUBLISH_KEY global sigue valiendo hasta que
el admin la rota (la app de escritorio ya instalada no se queda afuera)."""

import hashlib

from sqlalchemy import select

from cloud.models import PortalUser, PublishedRace
from cloud.tests.conftest import PUBLISH_KEY, make_user, publish_race

PAYLOAD = {
    "source_id": "ct-org-1",
    "name": "Carrera A",
    "location": "Córdoba",
    "race_date": "2026-05-01",
    "distances": [10.0],
    "results": [],
}
EVENTO = {"source_id": "ct-ev-1", "name": "Evento A", "distances": [10.0]}


def _admin(client, db):
    h = make_user(client, email="admin@test.com", username="boss")
    u = db.scalar(select(PortalUser).where(PortalUser.email == "admin@test.com"))
    u.is_admin = 1
    db.commit()
    return h


def _crear(client, h, nombre="Club Norte"):
    r = client.post("/api/run/admin/publish-keys", json={"name": nombre}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def _publicar(client, key, payload=PAYLOAD):
    return client.post("/api/publish", json=payload, headers={"X-API-Key": key})


def _evento(client, key, payload=EVENTO):
    return client.post("/api/events", json=payload, headers={"X-API-Key": key})


def _listar(client, h):
    return client.get("/api/run/admin/publish-keys", headers=h).json()


# ── Emisión y administración ─────────────────────────────────────────────────


def test_solo_admin_administra_las_keys(client, db):
    assert client.get("/api/run/admin/publish-keys").status_code == 401
    h = make_user(client)
    assert client.get("/api/run/admin/publish-keys", headers=h).status_code == 403
    assert client.post("/api/run/admin/publish-keys", json={"name": "x"}, headers=h).status_code == 403


def test_crear_devuelve_la_key_una_sola_vez(client, db):
    h = _admin(client, db)
    nueva = _crear(client, h)
    assert nueva["key"].startswith("lr_pub_") and len(nueva["key"]) > 30
    listado = _listar(client, h)
    assert len(listado) == 1
    fila = listado[0]
    assert fila["name"] == "Club Norte" and fila["prefix"] == nueva["key"][:11]
    assert nueva["key"] not in str(listado)  # el listado nunca trae el secreto
    assert fila["revoked_at"] is None and fila["is_legacy"] is False


def test_nombre_vacio_se_rechaza(client, db):
    h = _admin(client, db)
    assert client.post("/api/run/admin/publish-keys", json={"name": "  "}, headers=h).status_code == 422


def test_key_nueva_publica_y_queda_como_dueña(client, db):
    h = _admin(client, db)
    key = _crear(client, h)["key"]
    assert _publicar(client, key).status_code == 200
    race = db.scalar(select(PublishedRace).where(PublishedRace.source_id == "ct-org-1"))
    assert race.owner_key_hash == hashlib.sha256(key.encode()).hexdigest()


def test_key_desconocida_o_vacia_da_403(client, db):
    assert _publicar(client, "lr_pub_inventada").status_code == 403
    assert _publicar(client, "").status_code == 403


def test_last_used_at_se_actualiza_al_publicar(client, db):
    h = _admin(client, db)
    key = _crear(client, h)["key"]
    assert _listar(client, h)[0]["last_used_at"] is None
    _publicar(client, key)
    assert _listar(client, h)[0]["last_used_at"] is not None


# ── Propiedad entre organizadores ────────────────────────────────────────────


def test_un_organizador_no_pisa_ni_borra_las_carreras_de_otro(client, db):
    h = _admin(client, db)
    a, b = _crear(client, h, "A")["key"], _crear(client, h, "B")["key"]
    assert _publicar(client, a).status_code == 200
    assert _publicar(client, b).status_code == 403
    assert client.delete("/api/publish/ct-org-1", headers={"X-API-Key": b}).status_code == 403
    assert client.delete("/api/publish/ct-org-1", headers={"X-API-Key": a}).status_code == 200


def test_un_organizador_no_pisa_el_evento_de_otro(client, db):
    """Bug previo: /api/events no chequeaba dueño, así que con una key por
    organizador cualquiera podía reescribir el evento de otro."""
    h = _admin(client, db)
    a, b = _crear(client, h, "A")["key"], _crear(client, h, "B")["key"]
    assert _evento(client, a).status_code == 200
    assert _evento(client, b, {**EVENTO, "name": "Robado"}).status_code == 403
    race = db.scalar(select(PublishedRace).where(PublishedRace.source_id == "ct-ev-1"))
    assert race.name == "Evento A"
    assert _evento(client, a, {**EVENTO, "name": "Evento A v2"}).status_code == 200


# ── Rotación y revocación ────────────────────────────────────────────────────


def test_rotar_invalida_la_vieja_y_conserva_las_carreras(client, db):
    h = _admin(client, db)
    nueva = _crear(client, h)
    vieja = nueva["key"]
    assert _publicar(client, vieja).status_code == 200
    rot = client.post(f"/api/run/admin/publish-keys/{nueva['id']}/rotate", headers=h)
    assert rot.status_code == 200
    key2 = rot.json()["key"]
    assert key2 != vieja
    assert _publicar(client, vieja).status_code == 403
    assert _publicar(client, key2).status_code == 200  # sigue siendo la dueña
    otra = _crear(client, h, "Otro")["key"]
    assert _publicar(client, otra).status_code == 403  # y nadie más entra
    assert _listar(client, h)[0]["rotated_at"] is not None


def test_revocar_corta_la_publicacion_pero_no_borra_carreras(client, db):
    h = _admin(client, db)
    nueva = _crear(client, h)
    assert _publicar(client, nueva["key"]).status_code == 200
    r = client.post(f"/api/run/admin/publish-keys/{nueva['id']}/revoke", headers=h)
    assert r.status_code == 200
    assert _publicar(client, nueva["key"]).status_code == 403
    assert client.delete("/api/publish/ct-org-1", headers={"X-API-Key": nueva["key"]}).status_code == 403
    assert [c["name"] for c in client.get("/api/races").json()] == ["Carrera A"]
    assert _listar(client, h)[0]["revoked_at"] is not None


def test_una_key_revocada_no_se_puede_rotar(client, db):
    h = _admin(client, db)
    nueva = _crear(client, h)
    client.post(f"/api/run/admin/publish-keys/{nueva['id']}/revoke", headers=h)
    assert client.post(f"/api/run/admin/publish-keys/{nueva['id']}/rotate", headers=h).status_code == 409


def test_rotar_o_revocar_una_inexistente_da_404(client, db):
    h = _admin(client, db)
    assert client.post("/api/run/admin/publish-keys/999/rotate", headers=h).status_code == 404
    assert client.post("/api/run/admin/publish-keys/999/revoke", headers=h).status_code == 404


# ── La key global (CT_PUBLISH_KEY) ───────────────────────────────────────────


def test_la_key_global_sigue_publicando_y_aparece_como_legacy(client, db):
    h = _admin(client, db)
    assert _publicar(client, PUBLISH_KEY).status_code == 200
    listado = _listar(client, h)
    assert [(f["is_legacy"], f["races"]) for f in listado] == [(True, 1)]


def test_rotar_la_legacy_deja_sin_efecto_a_la_global_y_conserva_las_carreras(client, db):
    h = _admin(client, db)
    publish_race(client)  # crea la fila legacy y la carrera ct-race-1
    legacy = _listar(client, h)[0]
    nueva = client.post(f"/api/run/admin/publish-keys/{legacy['id']}/rotate", headers=h).json()["key"]
    assert _publicar(client, PUBLISH_KEY, {**PAYLOAD, "source_id": "ct-x"}).status_code == 403
    assert _publicar(client, nueva, {**PAYLOAD, "source_id": "ct-race-1"}).status_code == 200
    assert _listar(client, h)[0]["races"] == 1


def test_revocar_la_legacy_bloquea_tambien_a_la_global(client, db):
    h = _admin(client, db)
    publish_race(client)
    legacy = _listar(client, h)[0]
    client.post(f"/api/run/admin/publish-keys/{legacy['id']}/revoke", headers=h)
    assert _publicar(client, PUBLISH_KEY).status_code == 403
    assert len(_listar(client, h)) == 1  # no se recrea


def test_las_carreras_previas_a_la_tabla_siguen_siendo_de_la_global(client, db):
    """Una carrera publicada antes de existir publish_keys tiene el hash de la
    global como dueño: la fila legacy, creada después, la reconoce."""
    race = PublishedRace(
        source_id="vieja", code="VIEJA1", name="Vieja", owner_key_hash=hashlib.sha256(PUBLISH_KEY.encode()).hexdigest()
    )
    db.add(race)
    db.commit()
    assert _publicar(client, PUBLISH_KEY, {**PAYLOAD, "source_id": "vieja"}).status_code == 200


def test_init_db_es_idempotente(client):
    from cloud.db import init_db

    init_db()
    init_db()
