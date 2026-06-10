"""Re-publicar una carrera no debe hacerle perder al corredor sus resultados reclamados."""
from cloud.tests.conftest import publish_race

RESULT = {
    "bib_number": "7", "full_name": "Ana Gomez", "distance_km": 10.0,
    "net_time_ns": 1_800_000_000_000, "position": 1, "status": "FINISHER",
}


def _register_and_claim(client, code):
    r = client.post("/api/auth/register", json={
        "email": "ana@mail.com", "password": "supersecreta", "full_name": "Ana Gomez"})
    token = r.json()["token"]
    c = client.post(
        "/api/claim",
        json={"code": code, "bib_number": "7", "last_name": "Gomez"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert c.status_code == 200 and c.json()["linked"] == 1
    return token


def test_republish_preserves_manual_claims(client):
    pub = publish_race(client, results=[RESULT])
    token = _register_and_claim(client, pub["code"])

    # El organizador corrige un tiempo y vuelve a publicar (mismo dorsal/distancia).
    corrected = dict(RESULT, net_time_ns=1_790_000_000_000)
    publish_race(client, results=[corrected])

    me = client.get("/api/me/results", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    results = me.json()["results"]
    assert len(results) == 1
    assert results[0]["net_time_ns"] == 1_790_000_000_000


def test_republish_drops_claim_if_result_removed(client):
    pub = publish_race(client, results=[RESULT])
    token = _register_and_claim(client, pub["code"])

    # En la re-publicación el dorsal 7 ya no existe: el claim no debe migrar a otro.
    other = dict(RESULT, bib_number="99", full_name="Otro Corredor")
    publish_race(client, results=[other])

    me = client.get("/api/me/results", headers={"Authorization": f"Bearer {token}"})
    assert len(me.json()["results"]) == 0
