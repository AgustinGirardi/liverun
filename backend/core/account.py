"""Sesión de cuenta ChronoTrack en la app de escritorio.

La app de escritorio es del organizador, pero ahora también puede iniciar
sesión con la MISMA cuenta del portal/app móvil (email+contraseña o Google).
La sesión (token del portal) se guarda en un JSON junto a la base, igual que
la config de la nube. El token nunca se expone al navegador: el SPA solo ve
email y nombre.
"""
import json
import os
import urllib.parse
import urllib.request
from pathlib import Path

from backend.core.database import DB_PATH

_SESSION_PATH = DB_PATH.parent / "chronotrack_account.json"

# Dónde viven las cuentas. La config de nube del organizador (para publicar)
# puede apuntar a otra URL; las cuentas siempre están en el portal público.
DEFAULT_PORTAL = "https://chronotrack-portal.onrender.com"


def portal_base() -> str:
    """URL del portal donde viven las cuentas. Env > config de nube > default."""
    env = os.environ.get("CT_CLOUD_URL")
    if env:
        return env.rstrip("/")
    try:
        from backend.core.cloud_config import load_config
        url = (load_config().get("url") or "").rstrip("/")
        # El default local de publicación (127.0.0.1:8055) no sirve para cuentas.
        if url and "127.0.0.1:8055" not in url and "localhost:8055" not in url:
            return url
    except Exception:
        pass
    return DEFAULT_PORTAL


def _request(method: str, path: str, body: dict | None = None, token: str | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(portal_base() + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read()).get("detail", f"Error {e.code}")
        except Exception:
            detail = f"Error {e.code}"
        raise ValueError(detail)
    except Exception:
        raise ValueError("No se pudo conectar con el portal. Revisá tu internet.")


def load_session() -> dict | None:
    if not _SESSION_PATH.exists():
        return None
    try:
        s = json.loads(_SESSION_PATH.read_text(encoding="utf-8"))
        return s if isinstance(s, dict) and s.get("token") else None
    except Exception:
        return None


def save_session(token: str, email: str, full_name: str | None) -> dict:
    s = {"token": token, "email": email, "full_name": full_name}
    _SESSION_PATH.write_text(json.dumps(s, indent=2), encoding="utf-8")
    return s


def clear_session() -> None:
    _SESSION_PATH.unlink(missing_ok=True)


def public_session() -> dict | None:
    """Sesión sin el token (lo que se le puede mostrar a la UI)."""
    s = load_session()
    if not s:
        return None
    return {"email": s.get("email"), "full_name": s.get("full_name"),
            "portal": portal_base()}


def login(email: str, password: str) -> dict:
    d = _request("POST", "/api/auth/login", {"email": email, "password": password})
    return save_session(d["token"], d.get("email", email), d.get("full_name"))


def register(email: str, password: str, full_name: str | None) -> dict:
    d = _request("POST", "/api/auth/register",
                 {"email": email, "password": password, "full_name": full_name})
    return save_session(d["token"], d.get("email", email), d.get("full_name"))


def google_auth_url(redirect_uri: str) -> str:
    """URL del portal para arrancar el login con Google, volviendo a `redirect_uri`
    (un endpoint loopback de esta misma app)."""
    return f"{portal_base()}/api/run/auth/google/start?app_redirect={urllib.parse.quote(redirect_uri, safe='')}"


def complete_google(token: str) -> dict:
    """Tras el retorno de Google: con el token del portal, trae el perfil y guarda."""
    prof = _request("GET", "/api/run/profile", token=token)
    return save_session(token, prof.get("email", ""), prof.get("full_name"))
