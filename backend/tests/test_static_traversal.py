"""El catch-all del SPA no debe servir archivos fuera de frontend/dist."""
import asyncio
from pathlib import Path

import pytest

import backend.main as bm

pytestmark = pytest.mark.skipif(
    not bm.STATIC.exists(), reason="requiere el build del frontend (frontend/dist)"
)


def test_spa_confina_el_path_al_directorio_estatico():
    # full_path llega URL-decodificado: "%2e%2e/" ya es "../" en el handler.
    # Sin el confinamiento esto devolvía cualquier archivo del disco (p. ej.
    # chronotrack_cloud.json con la API key de publicación).
    resp = asyncio.run(bm.serve_spa("../../backend/main.py"))
    assert str(resp.path).endswith("index.html")


def test_spa_sigue_sirviendo_archivos_del_build():
    resp = asyncio.run(bm.serve_spa("index.html"))
    assert Path(resp.path) == bm.STATIC.resolve() / "index.html"
