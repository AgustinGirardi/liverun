"""Configuración de la conexión al portal en la nube (ChronoTrack Cloud).

La URL del portal y la API key de publicación se guardan en un archivo JSON
junto a la base de datos. La API key vive SOLO en el backend de escritorio:
nunca se envía al navegador (la UI sólo recibe una versión enmascarada).
Las variables de entorno CT_CLOUD_URL / CT_PUBLISH_KEY tienen prioridad si están
definidas (útil para despliegues controlados).
"""
import os
import json
from pathlib import Path

from backend.core.database import DB_PATH

_CONFIG_PATH = DB_PATH.parent / "chronotrack_cloud.json"

_DEFAULTS = {
    "url": os.environ.get("CT_CLOUD_URL", "http://127.0.0.1:8055"),
    "api_key": os.environ.get("CT_PUBLISH_KEY", ""),
}


def load_config() -> dict:
    """Devuelve {'url': str, 'api_key': str}. Env vars tienen prioridad."""
    cfg = dict(_DEFAULTS)
    if _CONFIG_PATH.exists():
        try:
            saved = json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))
            if isinstance(saved, dict):
                if saved.get("url"):
                    cfg["url"] = saved["url"]
                if saved.get("api_key"):
                    cfg["api_key"] = saved["api_key"]
        except Exception:
            pass
    # Env vars siempre ganan
    if os.environ.get("CT_CLOUD_URL"):
        cfg["url"] = os.environ["CT_CLOUD_URL"]
    if os.environ.get("CT_PUBLISH_KEY"):
        cfg["api_key"] = os.environ["CT_PUBLISH_KEY"]
    return cfg


def save_config(url: str | None = None, api_key: str | None = None) -> dict:
    """Guarda url / api_key (sólo los provistos no vacíos) y devuelve la config resultante."""
    current = dict(_DEFAULTS)
    if _CONFIG_PATH.exists():
        try:
            saved = json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))
            if isinstance(saved, dict):
                current.update({k: v for k, v in saved.items() if k in current})
        except Exception:
            pass
    if url is not None and url.strip():
        current["url"] = url.strip().rstrip("/")
    if api_key is not None and api_key.strip():
        current["api_key"] = api_key.strip()
    _CONFIG_PATH.write_text(json.dumps(current, indent=2), encoding="utf-8")
    return current


def mask_key(api_key: str) -> str:
    """Versión segura para mostrar en la UI: sólo los últimos 4 caracteres."""
    if not api_key:
        return ""
    if len(api_key) <= 4:
        return "•" * len(api_key)
    return "•" * (len(api_key) - 4) + api_key[-4:]
