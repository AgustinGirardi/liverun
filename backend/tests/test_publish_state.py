"""Estado de publicación persistente: published_at / published_code de la carrera."""
import json
import urllib.error

from backend.api import routes
from backend.tests.conftest import make_race, make_runner, register


class _FakeResp:
    status = 200

    def __init__(self, data):
        self._data = data

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        return json.dumps(self._data).encode()


def _portal_ok(monkeypatch):
    monkeypatch.setattr(routes.cloud_config, "load_config",
                        lambda: {"url": "http://portal.test", "api_key": "k"})
    monkeypatch.setattr(routes.urllib.request, "urlopen",
                        lambda req, timeout=30: _FakeResp({"code": "ABC123"}))


def _portal_down(monkeypatch):
    monkeypatch.setattr(routes.cloud_config, "load_config",
                        lambda: {"url": "http://portal.test", "api_key": "k"})

    def boom(req, timeout=30):
        raise urllib.error.URLError("sin conexión")
    monkeypatch.setattr(routes.urllib.request, "urlopen", boom)


def _finished_race(client):
    race = make_race(client)
    register(client, race["id"], make_runner(client)["id"])
    assert client.post(f"/api/v1/races/{race['id']}/start").status_code == 200
    assert client.patch(f"/api/v1/races/{race['id']}", json={"status": "FINISHED"}).status_code == 200
    return race


def _get(client, rid):
    return client.get(f"/api/v1/races/{rid}").json()


def test_new_race_not_published(client):
    race = make_race(client)
    assert race["published_at"] is None
    assert race["published_code"] is None


def test_publish_success_saves_state(client, monkeypatch):
    _portal_ok(monkeypatch)
    race = _finished_race(client)
    r = client.post(f"/api/v1/races/{race['id']}/publish")
    assert r.status_code == 200, r.text
    assert r.json()["published_at"]
    got = _get(client, race["id"])
    assert got["published_code"] == "ABC123"
    assert got["published_at"] is not None


def test_publish_planned_event_saves_state(client, monkeypatch):
    _portal_ok(monkeypatch)
    race = make_race(client)
    assert client.post(f"/api/v1/races/{race['id']}/publish").status_code == 200
    assert _get(client, race["id"])["published_code"] == "ABC123"


def test_publish_failure_keeps_null(client, monkeypatch):
    _portal_down(monkeypatch)
    race = _finished_race(client)
    assert client.post(f"/api/v1/races/{race['id']}/publish").status_code == 502
    got = _get(client, race["id"])
    assert got["published_at"] is None
    assert got["published_code"] is None


def test_duplicate_does_not_copy_publish_state(client, monkeypatch):
    _portal_ok(monkeypatch)
    race = _finished_race(client)
    client.post(f"/api/v1/races/{race['id']}/publish")
    dup = client.post(f"/api/v1/races/{race['id']}/duplicate")
    assert dup.status_code == 201
    assert dup.json()["published_at"] is None
    assert dup.json()["published_code"] is None
