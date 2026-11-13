"""/api/health: lo que Render consulta para saber si el portal está vivo.
Toca la base (un SELECT 1) pero no lista carreras, así no crece con los datos."""

from pathlib import Path

import yaml

VARIABLES_A_MANO = [
    "CT_PUBLIC_URL",
    "CT_SMTP_HOST",
    "CT_SMTP_PORT",
    "CT_SMTP_USER",
    "CT_SMTP_PASSWORD",
    "CT_SMTP_FROM",
]


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


def test_render_yaml_declara_url_y_smtp_para_cargar_a_mano():
    """sync: false y sin value: el valor real se carga en el panel, nunca en el repo."""
    texto = (Path(__file__).parents[2] / "render.yaml").read_text(encoding="utf-8")
    env_vars = yaml.safe_load(texto)["services"][0]["envVars"]
    por_clave = {v["key"]: v for v in env_vars}
    for clave in VARIABLES_A_MANO:
        assert clave in por_clave, f"render.yaml no declara {clave}"
        assert por_clave[clave].get("sync") is False, f"{clave} debe ser sync: false"
        assert "value" not in por_clave[clave], f"{clave} no puede tener value: en el repo"
