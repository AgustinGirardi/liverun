"""/api/health: lo que Render consulta para saber si el portal está vivo.
Toca la base (un SELECT 1) pero no lista carreras, así no crece con los datos."""

from pathlib import Path


def test_health_ok_con_base_sana(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_health_503_si_la_base_falla(client, monkeypatch):
    import cloud.main as cm

    def _caida():
        raise RuntimeError("base caída")

    monkeypatch.setattr(cm, "SessionLocal", _caida)
    r = client.get("/api/health")
    assert r.status_code == 503


def test_render_yaml_usa_el_health_check_liviano():
    yaml = (Path(__file__).parents[2] / "render.yaml").read_text(encoding="utf-8")
    assert "healthCheckPath: /api/health" in yaml
