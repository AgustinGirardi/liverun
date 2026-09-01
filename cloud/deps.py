"""Dependencias compartidas entre el portal (main.py) y la API móvil (run.py):
rate limiting por IP y autenticación por token."""
import ipaddress
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


# Rangos publicados de Cloudflare (https://www.cloudflare.com/ips/). Solo se
# usan para decidir si CF-Connecting-IP es creíble; no filtran tráfico.
_CF_CIDRS = (
    "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
    "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
    "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
    "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
    "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32",
    "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
)
_CF_NETS = tuple(ipaddress.ip_network(c) for c in _CF_CIDRS)


def _is_cloudflare(ip: str) -> bool:
    """True si `ip` pertenece a un rango de Cloudflare."""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in net for net in _CF_NETS)


def _peer_ip(request: Request) -> str:
    """Quién nos abrió la conexión. El ÚLTIMO salto del X-Forwarded-For lo
    agrega la infra (Render), no el cliente, así que no es falsificable; el
    primero sí lo controla el cliente y por eso nunca se usa."""
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        last = fwd.split(",")[-1].strip()
        if last:
            return last
    return request.client.host if request.client else "unknown"


def _client_ip(request: Request) -> str:
    """IP real del cliente para llavear el rate limit.

    CF-Connecting-IP es la IP verdadera SOLO si la petición entró por
    Cloudflare: CF descarta el header que mande el cliente. Pero el origen de
    Render sigue siendo alcanzable directo, y ahí cualquiera puede mandar un
    CF-Connecting-IP inventado y distinto por request, quedándose con un bucket
    nuevo cada vez — el rate limit entero deja de existir. Es el mismo agujero
    que ya nos comimos con X-Forwarded-For, mudado de header.

    Por eso solo confiamos en CF-Connecting-IP cuando quien nos habla es
    realmente Cloudflare; si no, la clave es el peer, que no se puede falsear.
    """
    peer = _peer_ip(request)
    cf = request.headers.get("cf-connecting-ip")
    if cf and _is_cloudflare(peer):
        return cf.strip()
    return peer


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
