"""Config del portal en el escritorio: la variable CT_PUBLISH_KEY de la PC pisa
la clave guardada, y la UI tiene que poder avisarlo (key_from_env)."""
import pytest

from backend.core import cloud_config


@pytest.fixture
def config_aislada(tmp_path, monkeypatch):
    """Config sin archivo ni variables heredadas del entorno del test."""
    monkeypatch.setattr(cloud_config, "_CONFIG_PATH", tmp_path / "chronotrack_cloud.json")
    monkeypatch.setattr(cloud_config, "_DEFAULTS", {"url": "http://127.0.0.1:8055", "api_key": ""})
    monkeypatch.delenv("CT_PUBLISH_KEY", raising=False)
    monkeypatch.delenv("CT_CLOUD_URL", raising=False)


def test_get_avisa_cuando_la_clave_viene_de_la_variable_de_entorno(client, config_aislada, monkeypatch):
    monkeypatch.setenv("CT_PUBLISH_KEY", "lr_pub_de_la_variable")
    d = client.get("/api/v1/cloud/config").json()
    assert d["key_from_env"] is True
    assert d["configured"] is True
    assert "lr_pub_de_la_variable" not in str(d)


def test_get_sin_variable_ni_clave_guardada(client, config_aislada):
    d = client.get("/api/v1/cloud/config").json()
    assert d["key_from_env"] is False
    assert d["configured"] is False


def test_put_guarda_la_clave_y_no_la_devuelve_en_claro(client, config_aislada):
    r = client.put("/api/v1/cloud/config", json={"url": "https://portal.test/", "api_key": "lr_pub_abcdefgh1234"})
    d = r.json()
    assert r.status_code == 200
    assert d["configured"] is True and d["key_from_env"] is False
    assert d["url"] == "https://portal.test"
    assert d["api_key_masked"].endswith("1234") and "lr_pub_abcdefgh" not in str(d)


def test_put_con_variable_de_entorno_sigue_avisando_que_pisa_lo_guardado(client, config_aislada, monkeypatch):
    client.put("/api/v1/cloud/config", json={"api_key": "lr_pub_guardada"})
    monkeypatch.setenv("CT_PUBLISH_KEY", "global-vieja")
    assert cloud_config.load_config()["api_key"] == "global-vieja"
    assert client.get("/api/v1/cloud/config").json()["key_from_env"] is True
