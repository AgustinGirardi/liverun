"""Dependencias compartidas entre el portal (main.py) y la API móvil (run.py):
rate limiting por IP y autenticación por token."""
import time
from collections import defaultdict

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from cloud.db import get_db
from cloud.models import PortalUser
from cloud.security import verify_token

# ── Rate limiting simple en memoria (proceso único en Render starter) ─────────
_RATE: dict[str, list[float]] = defaultdict(list)
_LAST_SWEEP = [0.0]
_SWEEP_EVERY = 300.0   # barrer como mucho cada 5 min
_STALE_AFTER = 600.0   # una IP sin actividad en 10 min se olvida


def _client_ip(request: Request) -> str:
    # Render está detrás de Cloudflare: CF-Connecting-IP trae la IP real del
    # cliente y Cloudflare descarta cualquier valor que mande el cliente, así
    # que es infalsificable — la clave correcta para el rate limit.
    #
    # NO usar el primer valor de X-Forwarded-For: lo controla el cliente.
    # Probado en producción: variando el XFF por request se saltaba el límite
    # entero (0 respuestas 429 en 25 logins). Como fallback (acceso directo al
    # origen, sin Cloudflare) tomamos el ÚLTIMO salto del XFF, que lo agrega la
    # infra y no el cliente.
    cf = request.headers.get("cf-connecting-ip")
    if cf:
        return cf.strip()
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(request: Request, bucket: str, limit: int = 10, window: float = 60.0):
    """Lanza 429 si se superan `limit` intentos por IP en `window` segundos."""
    key = f"{bucket}:{_client_ip(request)}"
    now = time.time()
    # Purga periódica: sin esto el diccionario acumula IPs para siempre.
    if now - _LAST_SWEEP[0] > _SWEEP_EVERY:
        _LAST_SWEEP[0] = now
        for k in list(_RATE):
            if not any(now - t < _STALE_AFTER for t in _RATE[k]):
                del _RATE[k]
    hits = [t for t in _RATE[key] if now - t < window]
    if len(hits) >= limit:
        raise HTTPException(429, "Demasiados intentos. Esperá un minuto e intentá de nuevo.")
    hits.append(now)
    _RATE[key] = hits


def current_user(authorization: str = Header(None), db: Session = Depends(get_db)) -> PortalUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "No autenticado")
    uid = verify_token(authorization.split(" ", 1)[1])
    if not uid:
        raise HTTPException(401, "Sesión inválida o expirada")
    user = db.get(PortalUser, uid)
    if not user:
        raise HTTPException(401, "Usuario no encontrado")
    return user
