"""Regresiones de la auditoría de seguridad previa a abrir el repo.

Cada test acá corresponde a un hallazgo concreto: si alguno vuelve a fallar,
es que se reintrodujo la vulnerabilidad, no que cambió un detalle de estilo.
"""
import hashlib

from sqlalchemy import select

from cloud.models import PublishedRace
from cloud.tests.conftest import PUBLISH_KEY, make_user, publish_race


def _h(email):
    return hashlib.sha256(("chronotrack-v1:" + email.strip().lower()).encode()).hexdigest()


def _resultado(name="Juan Perez", bib="1", email=None):
    r = {"bib_number": bib, "full_name": name, "distance_km": 10.0,
         "net_time_ns": 1_800_000_000_000, "position": 1, "status": "FINISHER"}
    if email:
        r["email_hash"] = _h(email)
    return r


# ── ALTO-1: propiedad de la carrera y key del organizador ────────────────────

def test_publicar_graba_el_dueno_de_la_carrera(client, db):
    publish_race(client, source_id="ct-1", results=[_resultado()])
    race = db.scalar(select(PublishedRace).where(PublishedRace.source_id == "ct-1"))
    assert race.owner_key_hash == hashlib.sha256(PUBLISH_KEY.encode()).hexdigest()


def test_no_se_puede_pisar_la_carrera_de_otro_organizador(client, db):
    publish_race(client, source_id="ct-1", results=[_resultado()])
    # Simula que la carrera fue publicada con OTRA key (futuro multi-organizador).
    race = db.scalar(select(PublishedRace).where(PublishedRace.source_id == "ct-1"))
    race.owner_key_hash = hashlib.sha256(b"la-key-de-otro").hexdigest()
    db.commit()

    payload = {"source_id": "ct-1", "name": "Secuestrada", "distances": [10.0], "results": []}
    r = client.post("/api/publish", json=payload, headers={"X-API-Key": PUBLISH_KEY})
    assert r.status_code == 403

    r = client.delete("/api/publish/ct-1", headers={"X-API-Key": PUBLISH_KEY})
    assert r.status_code == 403
    # Y la carrera sigue viva, con su nombre original.
    db.expire_all()
    assert db.scalar(select(PublishedRace).where(PublishedRace.source_id == "ct-1")) is not None


# ── BAJO-4: header no-ASCII devuelve 403, no un 500 ──────────────────────────

def test_api_key_no_ascii_da_403_y_no_rompe(client):
    payload = {"source_id": "ct-x", "name": "X", "distances": [10.0], "results": []}
    # En bytes: httpx no deja mandar un str no-ASCII, pero por la red llega así
    # y Starlette lo decodifica en latin-1 (que es donde reventaba compare_digest).
    r = client.post("/api/publish", json=payload, headers={"X-API-Key": "á".encode("latin-1")})
    assert r.status_code == 403


# ── MEDIO-2: comodines escapados en la búsqueda pública ──────────────────────

def test_busqueda_no_interpreta_comodines_del_usuario(client):
    publish_race(client, source_id="ct-1", results=[_resultado(name="Juan Perez")])
    # '%' como texto literal no debe matchear a todo el mundo.
    r = client.get("/api/search", params={"q": "%%"})
    assert r.status_code == 200
    assert r.json()["results"] == []
    # La búsqueda normal sigue funcionando.
    assert len(client.get("/api/search", params={"q": "perez"}).json()["results"]) == 1


# ── MEDIO-4: el apellido tiene que ser una palabra completa ──────────────────

def test_no_se_puede_reclamar_un_resultado_con_una_letra(client):
    pub = publish_race(client, source_id="ct-1", results=[_resultado(name="Juan Perez")])
    rid = client.get("/api/search", params={"q": "perez"}).json()["results"][0]["result_id"]
    h = make_user(client, email="ladron@test.com", full_name="Otro Nombre")

    # Substring de una letra: antes alcanzaba para quedarse con el resultado.
    r = client.post("/api/me/claim", json={"result_id": rid, "last_name": "a"}, headers=h)
    assert r.status_code == 403
    # Y por el otro camino (código + dorsal + apellido) tampoco.
    r = client.post("/api/claim", json={"code": pub["code"], "bib_number": "1", "last_name": "a"}, headers=h)
    assert r.status_code == 404

    # El apellido real sí funciona.
    r = client.post("/api/me/claim", json={"result_id": rid, "last_name": "Perez"}, headers=h)
    assert r.status_code == 200


# ── MEDIO-5: email_hash validado y autolink con coincidencia de nombre ───────

def test_email_hash_tiene_que_ser_sha256_hex(client):
    payload = {"source_id": "ct-1", "name": "X", "distances": [10.0],
               "results": [dict(_resultado(), email_hash="no-es-un-hash")]}
    r = client.post("/api/publish", json=payload, headers={"X-API-Key": PUBLISH_KEY})
    assert r.status_code == 422


def test_autolink_exige_que_el_nombre_coincida(client):
    # Un resultado ajeno marcado con el email_hash de la víctima.
    publish_race(client, source_id="ct-1", results=[
        _resultado(name="Persona Inventada", email="victima@test.com")])
    r = client.post("/api/auth/register", json={
        "email": "victima@test.com", "password": "supersecreta", "full_name": "Ana Gomez"})
    assert r.json()["linked"] == 0
    me = client.get("/api/me/results", headers={"Authorization": f"Bearer {r.json()['token']}"})
    assert me.json()["results"] == []


def test_autolink_sigue_funcionando_con_el_nombre_correcto(client):
    publish_race(client, source_id="ct-1", results=[
        _resultado(name="Ana Gomez", email="ana@test.com")])
    r = client.post("/api/auth/register", json={
        "email": "ana@test.com", "password": "supersecreta", "full_name": "Ana Gomez"})
    assert r.json()["linked"] == 1


# ── MEDIO-1: el login no dice si el email existe ─────────────────────────────

def test_login_no_distingue_email_inexistente_de_password_incorrecta(client):
    make_user(client, email="existe@test.com", password="secreta123")
    a = client.post("/api/auth/login", json={"email": "existe@test.com", "password": "mala"})
    b = client.post("/api/auth/login", json={"email": "nadie@test.com", "password": "mala"})
    assert a.status_code == b.status_code == 401
    assert a.json()["detail"] == b.json()["detail"]


# ── BAJO-2: cabeceras defensivas ─────────────────────────────────────────────

def test_csp_presente_y_sin_unsafe_eval(client):
    csp = client.get("/api/races").headers["content-security-policy"]
    assert "frame-ancestors 'none'" in csp
    assert "object-src 'none'" in csp
    assert "base-uri 'none'" in csp
    assert "unsafe-eval" not in csp
