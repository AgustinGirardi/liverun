def test_publish_and_list_race(client):
    from cloud.tests.conftest import publish_race
    publish_race(client, results=[{
        "bib_number": "1", "full_name": "Juan Perez",
        "distance_km": 10.0, "net_time_ns": 1_800_000_000_000,
        "position": 1, "status": "FINISHER",
    }])
    r = client.get("/api/races")
    assert r.status_code == 200
    races = r.json()
    assert len(races) == 1
    assert races[0]["name"] == "Maratón Test"
    assert races[0]["finishers"] == 1
