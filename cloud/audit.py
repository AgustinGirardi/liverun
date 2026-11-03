"""Auditoría de eventos sensibles (SOC 2 CC7.2, ISO A.8.15, NIST AU).

Cada evento es una fila de `audit_events` y una línea JSON al logger
`cloud.audit` (stdout: Cloud Logging o Render). Nunca lleva email, nombre ni
token: el usuario se identifica por `user_id`, la IP va truncada y, para
correlacionar logins fallidos, se guarda una huella HMAC del email.

Auditar no puede romper la acción: cualquier falla acá se loguea y se sigue.
"""

import hashlib
import hmac
import ipaddress
import json
import logging
import re
import sys
from contextlib import suppress
from datetime import datetime, timezone
from typing import Optional

from fastapi import Request
from sqlalchemy.orm import Session

from cloud.deps import _client_ip
from cloud.models import AuditEvent
from cloud.security import SECRET


class Redactor(logging.Filter):
    """Tapa emails y credenciales `Bearer …` que se hayan colado en un mensaje."""

    _PATRONES = (re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"), re.compile(r"Bearer\s+[^\s\"']+", re.IGNORECASE))

    def filter(self, record: logging.LogRecord) -> bool:
        texto = record.getMessage()
        for patron in self._PATRONES:
            texto = patron.sub("[redactado]", texto)
        record.msg, record.args = texto, None
        return True


log = logging.getLogger("cloud.audit")
log.setLevel(logging.INFO)
log.addFilter(Redactor())
if not log.handlers:
    _salida = logging.StreamHandler(sys.stdout)
    _salida.setFormatter(logging.Formatter("%(message)s"))
    log.addHandler(_salida)

_MAX = {"action": 40, "target": 64, "detail": 200}


def ip_truncada(ip: Optional[str]) -> Optional[str]:
    """IPv4 a /24 e IPv6 a /48; None si no es una IP (p. ej. "unknown")."""
    try:
        addr = ipaddress.ip_address((ip or "").strip())
    except ValueError:
        return None
    if addr.version == 6 and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    return str(ipaddress.ip_network(f"{addr}/{24 if addr.version == 4 else 48}", strict=False))


def huella_email(email: str) -> str:
    """HMAC-SHA256 del email con CT_CLOUD_SECRET, truncado. No es reversible sin
    el secreto; sirve para ver que varios fallos apuntan a la misma cuenta."""
    mensaje = b"audit-email:" + (email or "").strip().lower().encode()
    return hmac.new(SECRET.encode(), mensaje, hashlib.sha256).hexdigest()[:16]


def _recortar(valor: Optional[str], campo: str) -> Optional[str]:
    return valor[: _MAX[campo]] if valor else valor


def registrar(
    db: Session,
    accion: str,
    resultado: str,
    *,
    request: Optional[Request] = None,
    user_id: Optional[int] = None,
    actor_type: str = "user",
    target: Optional[str] = None,
    detalle: Optional[str] = None,
) -> Optional[AuditEvent]:
    """Agrega el evento a la sesión y lo manda al log.

    Un éxito ("ok") queda en la misma transacción que la acción: quien llama lo
    persiste con su `commit`. Un fallo ("fail") hace su propio commit, porque la
    acción se aborta y nadie más confirmaría la sesión."""
    try:
        evento = AuditEvent(
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
            action=_recortar(accion, "action"),
            result=resultado,
            actor_type=actor_type,
            user_id=user_id,
            target=_recortar(target, "target"),
            ip=ip_truncada(_client_ip(request)) if request is not None else None,
            detail=_recortar(detalle, "detail"),
        )
        db.add(evento)
        if resultado == "fail":
            db.commit()
        _emitir(evento)
        return evento
    except Exception:
        log.error("No se pudo auditar %s (%s)", accion, resultado, exc_info=True)
        if resultado == "fail":  # el éxito no se toca: la sesión es de la acción
            with suppress(Exception):
                db.rollback()
        return None


def _emitir(e: AuditEvent) -> None:
    log.info(
        json.dumps(
            {
                "ts": e.created_at.isoformat() + "Z",
                "action": e.action,
                "result": e.result,
                "actor_type": e.actor_type,
                "user_id": e.user_id,
                "target": e.target,
                "ip": e.ip,
                "detail": e.detail,
            },
            ensure_ascii=False,
        )
    )
