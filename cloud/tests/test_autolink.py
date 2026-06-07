import hashlib


def _h(email):
    return hashlib.sha256(("chronotrack-v1:" + email.strip().lower()).encode()).hexdigest()


def _publish_with_email(client, email, bib="1", name="Juan Perez", source_id="ct-race-1"):
    from cloud.tests.conftest import publish_race
    publish_race(client, source_id=source_id, results=[{
        "bib_number": bib, "full_name": name, "distance_km": 10.0,
        "net_time_ns": 1_800_000_000_000, "position": 1,
        "status": "FINISHER", "email_hash": _h(email),
    }])


def test_register_autolinks_matching_results(client):
    _publish_with_email(client, "juan@mail.com")
    r = client.post("/api/auth/register", json={
        "email": "juan@mail.com", "password": "supersecreta", "full_name": "Juan Perez"})
    assert r.status_code == 200
    token = r.json()["token"]
    me = client.get("/api/me/results", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert len(me.json()["results"]) == 1


def test_register_does_not_link_other_emails(client):
    _publish_with_email(client, "otro@mail.com")
    r = client.post("/api/auth/register", json={
        "email": "juan@mail.com", "password": "supersecreta", "full_name": "Juan Perez"})
    token = r.json()["token"]
    me = client.get("/api/me/results", headers={"Authorization": f"Bearer {token}"})
    assert len(me.json()["results"]) == 0


def test_login_links_results_published_after_register(client):
    # Cuenta creada antes de que exista el resultado
    client.post("/api/auth/register", json={
        "email": "juan@mail.com", "password": "supersecreta", "full_name": "Juan Perez"})
    _publish_with_email(client, "juan@mail.com")  # se publica después
    r = client.post("/api/auth/login", json={"email": "juan@mail.com", "password": "supersecreta"})
    token = r.json()["token"]
    me = client.get("/api/me/results", headers={"Authorization": f"Bearer {token}"})
    assert len(me.json()["results"]) == 1


def test_autolink_is_idempotent(client):
    _publish_with_email(client, "juan@mail.com")
    client.post("/api/auth/register", json={
        "email": "juan@mail.com", "password": "supersecreta", "full_name": "Juan Perez"})
    r = client.post("/api/auth/login", json={"email": "juan@mail.com", "password": "supersecreta"})
    assert r.json()["linked"] == 0
    token = r.json()["token"]
    me = client.get("/api/me/results", headers={"Authorization": f"Bearer {token}"})
    assert len(me.json()["results"]) == 1  # no se duplica
