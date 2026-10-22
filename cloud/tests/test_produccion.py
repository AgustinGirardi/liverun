"""Qué significa "producción" para el portal.

Render setea RENDER; Cloud Run no, así que el portal lee CT_PRODUCCION=1. Si el
portal no se reconociera en producción en la plataforma nueva, arrancaría sin
exigir la firma de los webhooks de Mercado Pago, con la cookie de Google sin
Secure, sin HSTS y con /docs abierto. Estos tests lo impiden."""

import os
import subprocess
import sys
from pathlib import Path

import pytest

import cloud.google_auth as ga
import cloud.main as cm
from cloud import billing_routes
from cloud.deps import PUBLIC_URL, en_produccion

RAIZ = Path(__file__).parents[2]


@pytest.fixture
def sin_produccion(monkeypatch):
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.delenv("CT_PRODUCCION", raising=False)


@pytest.fixture
def produccion_cloud_run(monkeypatch):
    """Cloud Run: CT_PRODUCCION=1 y ninguna variable de Render."""
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.setenv("CT_PRODUCCION", "1")


# ── en_produccion() ──────────────────────────────────────────────────────────


def test_sin_variables_no_es_produccion(sin_produccion):
    assert en_produccion() is False


def test_ct_produccion_1_es_produccion(produccion_cloud_run):
    assert en_produccion() is True


def test_render_sigue_siendo_produccion(sin_produccion, monkeypatch):
    monkeypatch.setenv("RENDER", "true")
    assert en_produccion() is True


@pytest.mark.parametrize("valor", ["", "0", "true", "si"])
def test_ct_produccion_solo_vale_con_1(sin_produccion, monkeypatch, valor):
    monkeypatch.setenv("CT_PRODUCCION", valor)
    assert en_produccion() is False


# ── arranque ─────────────────────────────────────────────────────────────────


def test_el_arranque_se_niega_a_usar_los_secretos_por_defecto(produccion_cloud_run, monkeypatch):
    monkeypatch.setattr("cloud.security.SECRET", "dev-insecure-secret-change-me")
    with pytest.raises(RuntimeError, match="Faltan secretos en producción"):
        cm._startup()


def test_el_arranque_se_niega_con_la_clave_de_publicacion_por_defecto(produccion_cloud_run, monkeypatch):
    monkeypatch.setattr("cloud.security.SECRET", "un-secreto-real")
    monkeypatch.setattr(cm, "PUBLISH_API_KEY", "dev-publish-key-change-me")
    with pytest.raises(RuntimeError, match="Faltan secretos en producción"):
        cm._startup()


def test_en_desarrollo_los_secretos_por_defecto_no_frenan_el_arranque(sin_produccion, monkeypatch):
    monkeypatch.setattr("cloud.security.SECRET", "dev-insecure-secret-change-me")
    cm._startup()  # no levanta


# ── webhook de Mercado Pago ──────────────────────────────────────────────────


class _PedidoSinFirma:
    headers: dict = {}


def test_el_webhook_sin_secreto_se_descarta_en_produccion(produccion_cloud_run, monkeypatch):
    monkeypatch.setattr(billing_routes, "MP_WEBHOOK_SECRET", "")
    assert billing_routes._firma_valida(_PedidoSinFirma(), "123") is False


def test_el_webhook_sin_secreto_pasa_en_desarrollo(sin_produccion, monkeypatch):
    monkeypatch.setattr(billing_routes, "MP_WEBHOOK_SECRET", "")
    assert billing_routes._firma_valida(_PedidoSinFirma(), "123") is True


# ── cookie del login con Google ──────────────────────────────────────────────


def _cookie_de_inicio(client, monkeypatch) -> str:
    monkeypatch.setattr(ga, "GOOGLE_CLIENT_ID", "cid")
    monkeypatch.setattr(ga, "GOOGLE_CLIENT_SECRET", "secret")
    r = client.get(
        "/api/run/auth/google/start",
        params={"app_redirect": f"{PUBLIC_URL}/"},
        follow_redirects=False,
    )
    assert r.status_code == 302
    return r.headers["set-cookie"]


def test_la_cookie_de_google_va_secure_en_produccion(client, produccion_cloud_run, monkeypatch):
    assert "secure" in _cookie_de_inicio(client, monkeypatch).lower()


def test_la_cookie_de_google_no_va_secure_en_desarrollo(client, sin_produccion, monkeypatch):
    assert "secure" not in _cookie_de_inicio(client, monkeypatch).lower()


# ── HSTS y docs (se deciden al importar la app: proceso aparte) ───────────────

_SONDA = """
from fastapi.testclient import TestClient
from cloud.main import app
with TestClient(app) as c:
    print(c.get("/docs").status_code, c.get("/openapi.json").status_code,
          "strict-transport-security" in c.get("/api/health").headers)
"""


def _sondear(tmp_path, **env) -> str:
    entorno = {k: v for k, v in os.environ.items() if k not in ("RENDER", "CT_PRODUCCION")}
    entorno.update(
        CT_CLOUD_DB=f"sqlite:///{tmp_path / 'sonda.db'}",
        CT_AVATAR_DIR=str(tmp_path / "avatars"),
        CT_CLOUD_SECRET="secreto-de-la-prueba",
        CT_PUBLISH_KEY="clave-de-la-prueba",
        **env,
    )
    r = subprocess.run([sys.executable, "-c", _SONDA], cwd=RAIZ, env=entorno, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return r.stdout.strip().splitlines()[-1]


def test_en_produccion_con_ct_produccion_no_hay_docs_y_si_hsts(tmp_path):
    assert _sondear(tmp_path, CT_PRODUCCION="1") == "404 404 True"


def test_en_desarrollo_hay_docs_y_no_hay_hsts(tmp_path):
    assert _sondear(tmp_path) == "200 200 False"
