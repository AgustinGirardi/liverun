"""API keys de publicación por organizador.

Cada organizador publica con su propia key (header X-API-Key). El admin las
emite, rota y revoca desde /api/run/admin/publish-keys. La CT_PUBLISH_KEY
global sigue valiendo hasta que se la rota o revoca: la primera vez que se usa
se registra como la key "legacy", así la app de escritorio ya instalada no se
queda afuera el día del deploy.
"""

import hashlib
import secrets
from hmac import compare_digest
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from cloud.db import get_db
from cloud.models import PortalUser, PublishedRace, PublishKey
from cloud.run import ahora_utc, iso_utc, require_admin

router = APIRouter(prefix="/api/run/admin/publish-keys", tags=["Admin"])

_PREFIJO = "lr_pub_"
_LARGO_PREFIJO_VISIBLE = 11


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8", "ignore")).hexdigest()


def _generar_key() -> str:
    return _PREFIJO + secrets.token_urlsafe(32)


def resolver_key(x_api_key: Optional[str], db: Session, clave_global: str) -> PublishKey:
    """Devuelve la fila de la key presentada o lanza 403. Registra el uso."""
    if not x_api_key:
        raise HTTPException(403, "API key inválida")
    digest = hash_key(x_api_key)
    fila = db.scalar(select(PublishKey).where(PublishKey.key_hash == digest))
    if fila is None and compare_digest(x_api_key.encode("utf-8", "ignore"), clave_global.encode("utf-8")):
        fila = _registrar_legacy(db, digest)
    if fila is None or fila.revoked_at is not None:
        raise HTTPException(403, "API key inválida")
    fila.last_used_at = ahora_utc()
    db.commit()
    return fila


def _registrar_legacy(db: Session, digest: str) -> Optional[PublishKey]:
    """Crea la fila de la key global la primera vez que se usa. Si ya hubo una
    (y su hash cambió), la global fue rotada: no vale más."""
    if db.scalar(select(PublishKey).where(PublishKey.is_legacy == 1)) is not None:
        return None
    fila = PublishKey(
        name="Organizador original", key_hash=digest, key_prefix="(CT_PUBLISH_KEY)", is_legacy=1, created_at=ahora_utc()
    )
    db.add(fila)
    db.flush()
    return fila


class NuevaKey(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def _nombre(cls, v: str) -> str:
        v = v.strip()
        if not 1 <= len(v) <= 80:
            raise ValueError("El nombre tiene que tener entre 1 y 80 caracteres")
        return v


def _dict(k: PublishKey, carreras: int) -> dict:
    return {
        "id": k.id,
        "name": k.name,
        "prefix": k.key_prefix,
        "is_legacy": bool(k.is_legacy),
        "races": carreras,
        "created_at": iso_utc(k.created_at),
        "rotated_at": iso_utc(k.rotated_at),
        "revoked_at": iso_utc(k.revoked_at),
        "last_used_at": iso_utc(k.last_used_at),
    }


def _por_id(db: Session, key_id: int) -> PublishKey:
    k = db.get(PublishKey, key_id)
    if k is None:
        raise HTTPException(404, "Esa API key no existe")
    return k


@router.get("")
def listar(_: PortalUser = Depends(require_admin), db: Session = Depends(get_db)):
    cuentas = dict(
        db.execute(select(PublishedRace.owner_key_hash, func.count()).group_by(PublishedRace.owner_key_hash)).all()
    )
    return [_dict(k, cuentas.get(k.key_hash, 0)) for k in db.scalars(select(PublishKey).order_by(PublishKey.id))]


@router.post("")
def crear(body: NuevaKey, _: PortalUser = Depends(require_admin), db: Session = Depends(get_db)):
    """La key en claro se devuelve esta única vez: después solo queda el hash."""
    key = _generar_key()
    fila = PublishKey(
        name=body.name, key_hash=hash_key(key), key_prefix=key[:_LARGO_PREFIJO_VISIBLE], created_at=ahora_utc()
    )
    db.add(fila)
    db.commit()
    return {**_dict(fila, 0), "key": key}


@router.post("/{key_id}/rotate")
def rotar(key_id: int, _: PortalUser = Depends(require_admin), db: Session = Depends(get_db)):
    """Cambia el secreto conservando al organizador: sus carreras pasan al hash nuevo."""
    fila = _por_id(db, key_id)
    if fila.revoked_at is not None:
        raise HTTPException(409, "La key está revocada: creá una nueva")
    key = _generar_key()
    viejo, nuevo = fila.key_hash, hash_key(key)
    db.execute(update(PublishedRace).where(PublishedRace.owner_key_hash == viejo).values(owner_key_hash=nuevo))
    fila.key_hash, fila.key_prefix, fila.rotated_at = nuevo, key[:_LARGO_PREFIJO_VISIBLE], ahora_utc()
    db.commit()
    carreras = db.scalar(select(func.count()).select_from(PublishedRace).where(PublishedRace.owner_key_hash == nuevo))
    return {**_dict(fila, carreras), "key": key}


@router.post("/{key_id}/revoke")
def revocar(key_id: int, _: PortalUser = Depends(require_admin), db: Session = Depends(get_db)):
    """Corta la publicación. Las carreras quedan publicadas."""
    fila = _por_id(db, key_id)
    if fila.revoked_at is None:
        fila.revoked_at = ahora_utc()
        db.commit()
    carreras = db.scalar(
        select(func.count()).select_from(PublishedRace).where(PublishedRace.owner_key_hash == fila.key_hash)
    )
    return _dict(fila, carreras)
