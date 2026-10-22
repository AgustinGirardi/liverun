"""Dependencias compartidas entre el portal (main.py) y la API móvil (run.py):
rate limiting por IP y autenticación por token."""

import ipaddress
import logging
import os
import time
from collections import defaultdict
from typing import Optional, Protocol

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from cloud.db import get_db
from cloud.models import PortalUser
from cloud.security import verify_token

log = logging.getLogger("cloud.deps")

# URL pública del portal: la usan CORS, los links de los mails, el redirect de
# Google, el back_url de Mercado Pago y las URLs de avatar. Un solo lugar.
PUBLIC_URL = os.environ.get("CT_PUBLIC_URL", "https://chronotrack-portal.onrender.com").rstrip("/")


def en_produccion() -> bool:
    """True si el portal corre en producción: CT_PRODUCCION=1 (Cloud Run) o, por
    compatibilidad, la variable RENDER que setea Render. Se lee en cada llamada
    (no al importar) para que los tests puedan tocar el entorno.

    En producción se exige la firma de los webhooks, la cookie de Google va
    Secure, hay HSTS, se esconden /docs y /openapi.json y el arranque se niega
    a usar los secretos por defecto."""
    return os.environ.get("CT_PRODUCCION") == "1" or bool(os.environ.get("RENDER"))


# ── Rate limiting: backend intercambiable ────────────────────────────────────
# Por defecto en memoria (proceso único en Render starter). Con más de un worker
# cada proceso tendría su propio contador y el tope real se multiplicaría: ahí
# hay que registrar un backend compartido (Redis) en _BACKENDS y elegirlo con
# CT_RATE_LIMIT_BACKEND. Un backend solo implementa `permitir`.
_RATE: dict[str, list[float]] = defaultdict(list)
_LAST_SWEEP = [0.0]
_SWEEP_EVERY = 300.0  # barrer como mucho cada 5 min
_STALE_AFTER = 600.0  # una IP sin actividad en 10 min se olvida


class Limitador(Protocol):
    def permitir(self, clave: str, limite: int, ventana: float) -> bool:
        """Registra un intento. False si `clave` ya hizo `limite` en `ventana` segundos."""


class LimitadorEnMemoria:
    def permitir(self, clave: str, limite: int, ventana: float) -> bool:
        now = time.time()
        # Purga periódica: sin esto el diccionario acumula IPs para siempre.
        if now - _LAST_SWEEP[0] > _SWEEP_EVERY:
            _LAST_SWEEP[0] = now
            for k in list(_RATE):
                if not any(now - t < _STALE_AFTER for t in _RATE[k]):
                    del _RATE[k]
        hits = [t for t in _RATE[clave] if now - t < ventana]
        if len(hits) >= limite:
            return False
        hits.append(now)
        _RATE[clave] = hits
        return True


_BACKENDS: dict[str, type] = {"memoria": LimitadorEnMemoria}


def crear_limitador(nombre: Optional[str]) -> Limitador:
    nombre = (nombre or "memoria").strip().lower()
    if nombre not in _BACKENDS:
        raise RuntimeError(f"CT_RATE_LIMIT_BACKEND={nombre!r} no existe. Opciones: {', '.join(sorted(_BACKENDS))}.")
    return _BACKENDS[nombre]()


_NOMBRE_BACKEND = (os.environ.get("CT_RATE_LIMIT_BACKEND") or "memoria").strip().lower()
_limitador: Limitador = crear_limitador(_NOMBRE_BACKEND)


def aviso_multiworker(backend: str, workers: Optional[str]) -> Optional[str]:
    """Texto de aviso si el contador en memoria corre con más de un worker (cada
    proceso contaría por separado y el tope real se multiplicaría); None si no hay problema.
    `workers` es WEB_CONCURRENCY, que uvicorn lee del entorno."""
    try:
        n = int(workers or 1)
    except ValueError:
        return None
    if backend != "memoria" or n <= 1:
        return None
    return (
        f"Hay {n} workers con el rate limit en memoria: cada proceso cuenta por separado "
        "y el tope real se multiplica. Registrá un backend compartido (Redis) en "
        "cloud/deps.py y elegilo con CT_RATE_LIMIT_BACKEND."
    )


def avisar_si_multiworker() -> None:
    aviso = aviso_multiworker(_NOMBRE_BACKEND, os.environ.get("WEB_CONCURRENCY"))
    if aviso:
        log.warning(aviso)


# Rangos publicados de Cloudflare (https://www.cloudflare.com/ips/). Solo se
# usan para decidir si CF-Connecting-IP es creíble; no filtran tráfico.
_CF_CIDRS = (
    "173.245.48.0/20",
    "103.21.244.0/22",
    "103.22.200.0/22",
    "103.31.4.0/22",
    "141.101.64.0/18",
    "108.162.192.0/18",
    "190.93.240.0/20",
    "188.114.96.0/20",
    "197.234.240.0/22",
    "198.41.128.0/17",
    "162.158.0.0/15",
    "104.16.0.0/13",
    "104.24.0.0/14",
    "172.64.0.0/13",
    "131.0.72.0/22",
    "2400:cb00::/32",
    "2606:4700::/32",
    "2803:f800::/32",
    "2405:b500::/32",
    "2405:8100::/32",
    "2a06:98c0::/29",
    "2c0f:f248::/32",
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
    rate_limit_key(f"{bucket}:{_client_ip(request)}", limit, window)


def rate_limit_key(key: str, limit: int = 10, window: float = 60.0):
    """Igual que rate_limit pero contra una clave arbitraria en vez de la IP.

    Existe para los limites que tienen que sobrevivir a la rotacion de IPs: con
    IPv6 conseguir una direccion nueva por request es trivial y barato, asi que
    un tope por IP no protege nada que se pueda adivinar (por ejemplo un codigo
    de cupon). Ahi la clave util es el usuario autenticado.
    """
    if not _limitador.permitir(key, limit, window):
        raise HTTPException(429, "Demasiados intentos. Esperá un minuto e intentá de nuevo.")


def current_user(authorization: str = Header(None), db: Session = Depends(get_db)) -> PortalUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "No autenticado")
    datos = verify_token(authorization.split(" ", 1)[1])
    if not datos:
        raise HTTPException(401, "Sesión inválida o expirada")
    uid, iat = datos
    user = db.get(PortalUser, uid)
    if not user:
        raise HTTPException(401, "Usuario no encontrado")
    # tokens_valid_from se mueve al cambiar o resetear la contraseña, al vincular Google a
    # una cuenta sin verificar y se fija al crear la cuenta. Esto último cubre
    # los ids reutilizados de SQLite: un token viejo de un usuario borrado
    # lleva el mismo id que la cuenta nueva, pero un iat anterior a su alta.
    # Comparación estricta: un token emitido en el mismo segundo del corte vale.
    if user.tokens_valid_from and iat < user.tokens_valid_from:
        raise HTTPException(401, "Tu sesión se cerró. Ingresá de nuevo.")
    return user


def admin_emails() -> set[str]:
    """Emails de CT_ADMIN_EMAILS (CSV), normalizados. Fuente de verdad de
    quién es admin: la usan el arranque y el login con Google."""
    return {e.strip().lower() for e in os.environ.get("CT_ADMIN_EMAILS", "").split(",") if e.strip()}
