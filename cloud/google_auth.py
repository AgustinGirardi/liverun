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

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from cloud.db import get_db
from cloud.deps import admin_emails
from cloud.models import PortalUser
from cloud.run import ahora_utc
from cloud.security import SECRET, hash_password, make_token

GOOGLE_CLIENT_ID = os.environ.get("CT_GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("CT_GOOGLE_CLIENT_SECRET", "")
PUBLIC_URL = os.environ.get("CT_PUBLIC_URL", "https://chronotrack-portal.onrender.com").rstrip("/")

# Esquemas de deep link aceptados: la app instalada (liverun; se mantiene el
# scheme viejo por builds anteriores) y, sólo si se enciende a mano, Expo Go.
_APP_SCHEMES = ("liverun", "chronotrackrun")
# Por defecto APAGADO: un exp:// puede apuntar a CUALQUIER proyecto de Expo Go,
# y como el callback vuelve con el token en la query, alcanzaba con que la
# victima abriera un link nuestro para que el token de 30 dias terminara en el
# proyecto del atacante. Se enciende a mano (CT_ALLOW_EXPO_REDIRECT=1) solo en
# desarrollo, nunca en produccion.
_EXPO_SCHEMES = ("exp", "exps") if os.environ.get("CT_ALLOW_EXPO_REDIRECT") == "1" else ()
ALLOWED_SCHEMES = _EXPO_SCHEMES + _APP_SCHEMES
STATE_TTL_S = 600

# Cookie que ata el login con Google al navegador que lo empezó (flujo web).
# Sin ella, el state firmado servía en cualquier navegador: un atacante
# arrancaba el login con SU cuenta de Google, frenaba antes del callback y le
# mandaba ese link a la víctima, que quedaba logueada en la cuenta del atacante
# (login CSRF). Path acotado: solo viaja a /start y /callback. SameSite=Lax
# alcanza porque Google vuelve con una navegación GET de primer nivel.
NONCE_COOKIE = "lr_google_nonce"
_COOKIE_PATH = "/api/run/auth/google"
_COOKIE_SECURE = bool(os.environ.get("RENDER"))

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


def is_web_redirect(url: str) -> bool:
    """True si el retorno es el propio portal web (no la app ni el escritorio)."""
    parsed = urllib.parse.urlparse(url or "")
    public = urllib.parse.urlparse(PUBLIC_URL)
    return parsed.scheme.lower() == public.scheme and parsed.netloc == public.netloc


def _hash_nonce(nonce: str) -> str:
    return hashlib.sha256(nonce.encode()).hexdigest()[:32]


def make_state(app_redirect: str, now: Optional[float] = None,
               browser_nonce: Optional[str] = None) -> str:
    """state firmado (HMAC) que viaja a Google y vuelve: transporta el deep
    link de la app sin guardar estado en el servidor.

    `browser_nonce` (flujo web) queda hasheado adentro y el callback exige la
    cookie con el mismo valor: eso es lo que ata el state al navegador."""
    base = now if now is not None else time.time()
    datos = {
        "r": app_redirect,
        "exp": int(base + STATE_TTL_S),
        "n": secrets.token_urlsafe(8),
    }
    if browser_nonce:
        datos["c"] = _hash_nonce(browser_nonce)
    payload = json.dumps(datos)
    b64 = base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")
    sig = hmac.new(SECRET.encode(), b64.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{b64}.{sig}"


def verify_state(state: str, now: Optional[float] = None,
                 browser_nonce: Optional[str] = None) -> Optional[str]:
    """Devuelve el app_redirect si el state es válido y no venció; si no, None.

    Para el flujo web exige además que `browser_nonce` (la cookie) coincida con
    el que quedó en el state. Los flujos de app móvil y escritorio no lo
    exigen todavía (ver google_start)."""
    try:
        b64, sig = state.split(".")
        good = hmac.new(SECRET.encode(), b64.encode(), hashlib.sha256).hexdigest()[:32]
        if not hmac.compare_digest(good, sig):
            return None
        payload = json.loads(base64.urlsafe_b64decode(b64 + "=" * (-len(b64) % 4)))
        if payload["exp"] < (now if now is not None else time.time()):
            return None
        redirect = payload["r"]
        if not valid_app_redirect(redirect):
            return None
        if is_web_redirect(redirect):
            esperado = payload.get("c")
            if not esperado or not browser_nonce \
                    or not hmac.compare_digest(esperado, _hash_nonce(browser_nonce)):
                return None
        return redirect
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
    es_admin = email in admin_emails()
    user = db.scalar(select(PortalUser).where(PortalUser.email == email))
    if user:
        # Toma de cuenta previa: cualquiera puede registrar el email de otro
        # (sin verificarlo) y, cuando el dueño real entraba con Google, el
        # atacante seguía teniendo su contraseña. Si la cuenta NO estaba
        # verificada, Google (que sí verificó el email) decide de quién es: se
        # anula la contraseña y se cierran todas las sesiones previas (+1 s:
        # también las del mismo segundo; el callback emite el token nuevo justo
        # en el corte). Si ya estaba verificada, quien puso esa contraseña
        # probó ser el dueño del buzón: solo se vincula Google.
        user.google_id = sub
        if not user.email_verified_at:
            user.password_hash = hash_password(secrets.token_urlsafe(32))
            user.tokens_valid_from = int(time.time()) + 1
            user.email_verified_at = ahora_utc()
        if not user.full_name and name:
            user.full_name = name
        if not user.avatar_url and picture:
            user.avatar_url = picture
        if es_admin:
            user.is_admin = 1
        db.commit()
        return user
    user = PortalUser(
        email=email,
        # Sin contraseña utilizable: solo entra con Google (puede elegir una
        # después con "olvidé mi contraseña").
        password_hash=hash_password(secrets.token_urlsafe(32)),
        full_name=name,
        google_id=sub,
        email_verified_at=ahora_utc(),
        avatar_url=picture,
        is_admin=1 if es_admin else 0,
        # Si SQLite le reasigna el id de una cuenta borrada, los tokens viejos
        # de aquella no abren esta (ver deps.current_user).
        tokens_valid_from=int(time.time()),
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
    """Arranca el login. En el flujo web deja una cookie con un nonce que el
    callback exige. En app móvil y escritorio no se exige todavía: técnicamente
    también pasan por el mismo navegador (openAuthSessionAsync / navegador del
    sistema), pero no está probado en dispositivos que la cookie sobreviva en
    todos; activarlo sin probar podía dejar a esos clientes sin login."""
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        raise HTTPException(503, "Login con Google no configurado (faltan CT_GOOGLE_CLIENT_ID/SECRET)")
    if not valid_app_redirect(app_redirect):
        raise HTTPException(400, "app_redirect inválido")
    nonce = secrets.token_urlsafe(24) if is_web_redirect(app_redirect) else None
    auth_url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": f"{PUBLIC_URL}/api/run/auth/google/callback",
        "response_type": "code",
        "scope": "openid email profile",
        "state": make_state(app_redirect, browser_nonce=nonce),
        "prompt": "select_account",
    })
    resp = RedirectResponse(auth_url, status_code=302)
    if nonce:
        resp.set_cookie(NONCE_COOKIE, nonce, max_age=STATE_TTL_S, path=_COOKIE_PATH,
                        httponly=True, samesite="lax", secure=_COOKIE_SECURE)
    return resp


@router.get("/callback")
def google_callback(request: Request, state: str, code: Optional[str] = None,
                    error: Optional[str] = None, db: Session = Depends(get_db)):
    app_redirect = verify_state(state, browser_nonce=request.cookies.get(NONCE_COOKIE))
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
    # iat nunca antes del corte de sesiones (al vincular Google se pone en
    # ahora+1): si no, el token recién emitido nacería inválido.
    iat = max(int(time.time()), user.tokens_valid_from or 0)
    resp = RedirectResponse(
        _app_url(app_redirect, token=make_token(user.id, iat=iat), email=user.email),
        status_code=302,
    )
    resp.delete_cookie(NONCE_COOKIE, path=_COOKIE_PATH)  # un solo uso
    return resp
