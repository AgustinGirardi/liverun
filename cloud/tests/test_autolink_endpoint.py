import hashlib


def _h(email):
    return hashlib.sha256(("chronotrack-v1:" + email.strip().lower()).encode()).hexdigest()


def _token(client, email="juan@mail.com"):
    r = client.post("/api/auth/register", json={
        "email": email, "password": "supersecreta", "full_name": "Juan Perez"})
    return r.json()["token"]


def test_manual_autolink_picks_up_new_results(client):
    from cloud.tests.conftest import publish_race
    token = _token(client)  # registro sin resultados aún
    # Se publica un resultado del usuario DESPUÉS del registro
    publish_race(client, results=[{
        "bib_number": "1", "full_name": "Juan Perez", "distance_km": 10.0,
        "net_time_ns": 1_800_000_000_000, "position": 1,
        "status": "FINISHER", "email_hash": _h("juan@mail.com")}])
    r = client.post("/api/me/autolink", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["linked"] == 1
    # Segunda llamada no vincula nada nuevo
    r2 = client.post("/api/me/autolink", headers={"Authorization": f"Bearer {token}"})
    assert r2.json()["linked"] == 0


def test_manual_autolink_requires_auth(client):
    r = client.post("/api/me/autolink")
    assert r.status_code == 401
