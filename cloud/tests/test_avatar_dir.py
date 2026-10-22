"""Dónde guarda el portal los avatares: junto a la base (Render) o en CT_AVATAR_DIR
(Cloud Run, donde la carpeta es un bucket montado)."""

from cloud import run


def test_ct_avatar_dir_tiene_prioridad(tmp_path, monkeypatch):
    destino = tmp_path / "bucket" / "avatars"
    monkeypatch.setenv("CT_AVATAR_DIR", str(destino))
    assert run.avatar_dir() == destino
    assert destino.is_dir()


def test_sin_ct_avatar_dir_van_junto_a_la_base_sqlite(tmp_path, monkeypatch):
    monkeypatch.delenv("CT_AVATAR_DIR", raising=False)
    monkeypatch.setattr(run, "DB_URL", f"sqlite:///{tmp_path / 'cloud.db'}")
    assert run.avatar_dir() == tmp_path / "avatars"


def test_ct_avatar_dir_vacio_se_ignora(tmp_path, monkeypatch):
    monkeypatch.setenv("CT_AVATAR_DIR", "  ")
    monkeypatch.setattr(run, "DB_URL", f"sqlite:///{tmp_path / 'cloud.db'}")
    assert run.avatar_dir() == tmp_path / "avatars"
