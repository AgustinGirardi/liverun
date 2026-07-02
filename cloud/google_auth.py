"""Login con Google para ChronoTrack Run (flujo server-side, apto Expo Go).

La app abre el navegador en /start con su deep link como `app_redirect`;
acá se redirige a Google, Google vuelve a /callback con el código, el
servidor lo canjea (client secret) y devuelve al deep link de la app un
token de sesión propio (cloud/security.py). La app nunca ve secretos.

Config (env): CT_GOOGLE_CLIENT_ID, CT_GOOGLE_CLIENT_SECRET (OAuth Web en
Google Cloud Console) y CT_PUBLIC_URL (URL pública del portal).
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import time
import urllib.parse
import urllib.request
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from cloud.db import get_db
from cloud.models import PortalUser
from cloud.security import SECRET, hash_password, make_token

GOOGLE_CLIENT_ID = os.environ.get("CT_GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("CT_GOOGLE_CLIENT_SECRET", "")
PUBLIC_URL = os.environ.get("CT_PUBLIC_URL", "https://chronotrack-portal.onrender.com").rstrip("/")

# Esquemas de deep link aceptados: la app instalada (liverun; se mantiene el
# scheme viejo por builds anteriores) y Expo Go (exp/exps) — estos últimos se
# pueden apagar al lanzar con CT_ALLOW_EXPO_REDIRECT=0, porque un exp:// puede
# apuntar a CUALQUIER proyecto de Expo Go (vector de phishing del token).
_APP_SCHEMES = ("liverun", "chronotrackrun")
_EXPO_SCHEMES = ("exp", "exps") if os.environ.get("CT_ALLOW_EXPO_REDIRECT", "1") == "1" else ()
ALLOWED_SCHEMES = _EXPO_SCHEMES + _APP_SCHEMES
STATE_TTL_S = 600

router = APIRouter(prefix="/api/run/auth/google", tags=["Run"])


# ── Helpers puros (testeables) ────────────────────────────────────────────────

def valid_app_redirect(url: str) -> bool:
    """Destinos de retorno permitidos tras el login con Google:
    - deep link de la app móvil (exp/exps/chronotrackrun),
    - el propio portal web (mismo origen que PUBLIC_URL),
    - loopback de la app de escritorio (http://127.0.0.1 o localhost, cualquier
      puerto): estándar seguro para apps nativas (RFC 8252)."""
    parsed = urllib.parse.urlparse(url or "")
    scheme = parsed.scheme.lower()
    if scheme in ALLOWED_SCHEMES:
        return True
    # Loopback de escritorio: solo http hacia la máquina local del usuario.
    if scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost"):
        return True
    # Portal web: https + mismo host que PUBLIC_URL (evita open redirect).
    public = urllib.parse.urlparse(PUBLIC_URL)
    return scheme == public.scheme and parsed.netloc == public.netloc


def make_state(app_redirect: str, now: Optional[float] = None) -> str:
    """state firmado (HMAC) que viaja a Google y vuelve: anti-CSRF y además
    transporta el deep link de la app sin guardar estado en el servidor."""
    base = now if now is not None else time.time()
    payload = json.dumps({
        "r": app_redirect,
        "exp": int(base + STATE_TTL_S),
        "n": secrets.token_urlsafe(8),
    })
    b64 = base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")
    sig = hmac.new(SECRET.encode(), b64.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{b64}.{sig}"


def verify_state(state: str, now: Optional[float] = None) -> Optional[str]:
    """Devuelve el app_redirect si el state es válido y no venció; si no, None."""
    try:
        b64, sig = state.split(".")
        good = hmac.new(SECRET.encode(), b64.encode(), hashlib.sha256).hexdigest()[:32]
        if not hmac.compare_digest(good, sig):
            return None
        payload = json.loads(base64.urlsafe_b64decode(b64 + "=" * (-len(b64) % 4)))
        if payload["exp"] < (now if now is not None else time.time()):
            return None
        redirect = payload["r"]
        return redirect if valid_app_redirect(redirect) else None
    except Exception:
        return None


def upsert_google_user(db: Session, sub: str, email: str, name: Optional[str],
                       picture: Optional[str]) -> PortalUser:
    """Busca por google_id; si no, vincula por email (cuenta de portal
    existente); si no, crea la cuenta. Devuelve el usuario."""
    user = db.scalar(select(PortalUser).where(PortalUser.google_id == sub))
    if user:
        return user
    email = email.strip().lower()
    user = db.scalar(select(PortalUser).where(PortalUser.email == email))
    if user:
        user.google_id = sub
        if not user.full_name and name:
            user.full_name = name
        if not user.avatar_url and picture:
            user.avatar_url = picture
        db.commit()
        return user
    user = PortalUser(
        email=email,
        # Sin contraseña utilizable: solo entra con Google (puede setear una
        # después con un reset, si algún día se implementa).
        password_hash=hash_password(secrets.token_urlsafe(32)),
        full_name=name,
        google_id=sub,
        avatar_url=picture,
    )
    db.add(user)
    db.commit()
    return user


def _decode_jwt_payload(id_token: str) -> dict:
    """Payload del id_token SIN verificar firma: viene directo del endpoint
    de token de Google por TLS, así que la firma es redundante acá."""
    b64 = id_token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(b64 + "=" * (-len(b64) % 4)))


def exchange_code(code: str) -> dict:
    """Canjea el authorization code por el id_token en Google y devuelve sus
    claims (sub, email, name, picture...). Se monkeypatchea en tests."""
    body = urllib.parse.urlencode({
        "code": code,
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "redirect_uri": f"{PUBLIC_URL}/api/run/auth/google/callback",
        "grant_type": "authorization_code",
    }).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body, method="POST")
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())
    return _decode_jwt_payload(data["id_token"])


def _app_url(app_redirect: str, **params: str) -> str:
    sep = "&" if urllib.parse.urlparse(app_redirect).query else "?"
    return app_redirect + sep + urllib.parse.urlencode(params)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/start")
def google_start(app_redirect: str):
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        raise HTTPException(503, "Login con Google no configurado (faltan CT_GOOGLE_CLIENT_ID/SECRET)")
    if not valid_app_redirect(app_redirect):
        raise HTTPException(400, "app_redirect inválido")
    auth_url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": f"{PUBLIC_URL}/api/run/auth/google/callback",
        "response_type": "code",
        "scope": "openid email profile",
        "state": make_state(app_redirect),
        "prompt": "select_account",
    })
    return RedirectResponse(auth_url, status_code=302)


@router.get("/callback")
def google_callback(state: str, code: Optional[str] = None, error: Optional[str] = None,
                    db: Session = Depends(get_db)):
    app_redirect = verify_state(state)
    if not app_redirect:
        raise HTTPException(400, "state inválido o vencido; volvé a intentar el login")
    if error or not code:
        return RedirectResponse(_app_url(app_redirect, error=error or "cancelado"), status_code=302)
    try:
        claims = exchange_code(code)
    except Exception:
        return RedirectResponse(_app_url(app_redirect, error="google_exchange"), status_code=302)
    if not claims.get("email") or not claims.get("sub"):
        return RedirectResponse(_app_url(app_redirect, error="google_claims"), status_code=302)
    if claims.get("email_verified") is False:
        return RedirectResponse(_app_url(app_redirect, error="email_no_verificado"), status_code=302)
    user = upsert_google_user(
        db, sub=str(claims["sub"]), email=claims["email"],
        name=claims.get("name"), picture=claims.get("picture"),
    )
    return RedirectResponse(
        _app_url(app_redirect, token=make_token(user.id), email=user.email),
        status_code=302,
    )
