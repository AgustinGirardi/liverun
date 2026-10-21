"""Publicación de carreras (organizador): publicar, cargar eventos y despublicar."""

import os
import hashlib
import re
from hmac import compare_digest as hmac_compare
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, delete as sa_delete
from sqlalchemy.orm import Session

from cloud.db import get_db
from cloud.deps import rate_limit
from cloud.models import PublishedRace, PublishedResult, Claim
from cloud.nombres import normalizar_nombre, _name_matches, _name_tokens
from cloud.organizadores import resolver_key

PUBLISH_API_KEY = os.environ.get("CT_PUBLISH_KEY", "dev-publish-key-change-me")

router = APIRouter()


class PublishResult(BaseModel):
    bib_number: str
    full_name: str
    category: Optional[str] = None
    club: Optional[str] = None
    distance_km: Optional[float] = None
    net_time_ns: Optional[int] = None
    finish_time_ns: Optional[int] = None
    position: Optional[int] = None
    status: str = "FINISHER"
    email_hash: Optional[str] = Field(
        None, max_length=64
    )  # sha256 hex (64 chars); el escritorio lo calcula, el cloud nunca ve el email en claro

    @field_validator("email_hash")
    @classmethod
    def _hash_bien_formado(cls, v):
        """Solo sha256 en hex. El algoritmo es publico y sin salt, asi que un
        hash arbitrario en el payload es la forma de intentar colgarle un
        resultado inventado al email de otra persona; al menos exigimos que
        tenga la forma correcta."""
        if v is None:
            return v
        v = v.strip().lower()
        if not re.fullmatch(r"[0-9a-f]{64}", v):
            raise ValueError("email_hash debe ser un sha256 en hexadecimal (64 caracteres)")
        return v


class PublishPayload(BaseModel):
    source_id: str = Field(..., min_length=3, max_length=64)
    name: str
    location: Optional[str] = None
    race_date: Optional[date] = None
    distances: list[float] = []
    results: list[PublishResult] = []


class EventPayload(BaseModel):
    """Anuncio de una carrera todavía no corrida (calendario)."""

    source_id: str = Field(..., min_length=3, max_length=64)
    name: str = Field(..., min_length=1, max_length=200)
    location: Optional[str] = Field(None, max_length=200)
    race_date: Optional[date] = None
    distances: list[float] = []
    capacity: Optional[int] = Field(None, ge=1)
    registered_count: Optional[int] = Field(None, ge=0)
    registration_url: Optional[str] = Field(None, max_length=400)

    @field_validator("registration_url")
    @classmethod
    def _safe_url(cls, v: Optional[str]) -> Optional[str]:
        # El link va a un href del portal: sólo http(s). Sin esto se podría
        # publicar un javascript: y ejecutarlo en el navegador de los corredores.
        if v is None or not v.strip():
            return None
        v = v.strip()
        if not v.lower().startswith(("http://", "https://")):
            raise ValueError("El link de inscripción debe empezar con http:// o https://")
        return v


def _gen_code(source_id: str, db: Session) -> str:
    base = hashlib.sha1(source_id.encode()).hexdigest().upper()
    for length in range(6, 13):
        code = base[:length]
        if not db.scalar(select(PublishedRace).where(PublishedRace.code == code)):
            return code
    return base  # fallback improbable


def _rank_categories(results: list[PublishedResult]) -> None:
    """Asigna category_position rankeando por tiempo dentro de cada
    (distancia, categoría). Sólo finishers con tiempo: un DNF no tiene puesto.
    Se llama al publicar, sobre los resultados recién insertados."""
    groups: dict[tuple, list[PublishedResult]] = {}
    for r in results:
        if r.status != "FINISHER" or r.category is None:
            continue
        t = r.net_time_ns if r.net_time_ns is not None else r.finish_time_ns
        if t is None:
            continue
        groups.setdefault((r.distance_km, r.category), []).append(r)
    for rows in groups.values():
        rows.sort(key=lambda r: r.net_time_ns if r.net_time_ns is not None else r.finish_time_ns)
        for pos, r in enumerate(rows, start=1):
            r.category_position = pos


# ── Autenticación del organizador ────────────────────────────────────────────


def _check_publish_key(x_api_key: Optional[str], db: Session) -> str:
    """Valida la API key de publicación y devuelve su hash (identidad del dueño).

    Vale la key de un organizador (cloud/organizadores.py) o, hasta que se la
    rote o revoque, la global CT_PUBLISH_KEY. resolver_key compara en bytes: un
    `X-API-Key: á` llega decodificado en latin-1 y compare_digest sobre str
    reventaba con TypeError → 500 en vez de un 403 limpio.
    """
    return resolver_key(x_api_key, db, PUBLISH_API_KEY).key_hash


def _check_race_owner(race: PublishedRace, key_hash: str) -> None:
    """Una carrera pertenece a la key que la publicó.

    Con una key por organizador, ninguno puede pisar ni borrar las carreras de
    otro sólo por conocer el source_id. Rotar una key reapunta el hash de sus
    carreras (cloud/organizadores.py). Las carreras previas a la columna tienen
    owner_key_hash NULL y adoptan dueño en su próxima publicación.
    """
    if race.owner_key_hash and not hmac_compare(race.owner_key_hash, key_hash):
        raise HTTPException(403, "Esa carrera fue publicada por otro organizador")


# ── Publicación (organizador) ────────────────────────────────────────────────


@router.post("/api/publish", tags=["Organizador"])
def publish(payload: PublishPayload, request: Request, x_api_key: str = Header(None), db: Session = Depends(get_db)):
    # Publicar es caro (borra y reinserta toda la carrera): sin tope, una key
    # filtrada permite machacar el servicio además de falsear resultados.
    rate_limit(request, "publish", limit=30, window=60.0)
    key_hash = _check_publish_key(x_api_key, db)

    race = db.scalar(select(PublishedRace).where(PublishedRace.source_id == payload.source_id))
    if race is None:
        race = PublishedRace(source_id=payload.source_id, code=_gen_code(payload.source_id, db))
        db.add(race)
    _check_race_owner(race, key_hash)
    race.owner_key_hash = key_hash

    race.name = payload.name
    race.location = payload.location
    race.race_date = payload.race_date
    race.distances = ",".join(str(d) for d in sorted(payload.distances)) if payload.distances else None
    # Publicar resultados cierra el ciclo: si venía del calendario, deja de ser
    # un evento futuro y pasa al listado de carreras corridas.
    race.event_status = "finished"

    # Re-publicación idempotente: reemplaza los resultados, pero los claims de los
    # corredores deben sobrevivir (si no, cada corrección del organizador les
    # vaciaría el perfil). Se preservan por (dorsal, distancia), pero solo si
    # el nombre sigue coincidiendo: si el organizador corrigió dorsales
    # intercambiados, el reclamo no puede pasar a otra persona.
    db.flush()
    old_claims: dict[tuple, list[tuple[int, str]]] = {}
    for old in race.results:
        for cl in old.claims:
            old_claims.setdefault((old.bib_number, old.distance_km), []).append((cl.user_id, old.full_name))
    for old in list(race.results):
        db.delete(old)
    db.flush()

    new_results = []
    for r in payload.results:
        res = PublishedResult(race_id=race.id, name_norm=normalizar_nombre(r.full_name), **r.model_dump())
        db.add(res)
        new_results.append(res)
    _rank_categories(new_results)
    db.flush()
    restaurados: set[tuple[int, int]] = set()
    sueltos: list[tuple[int, str, Optional[float]]] = []
    for (bib, dist), reclamos in old_claims.items():
        destino = next((r for r in new_results if r.bib_number == bib and r.distance_km == dist), None)
        for uid, nombre in reclamos:
            if destino is not None and _name_matches(nombre, destino.full_name):
                restaurados.add((uid, destino.id))
            else:
                sueltos.append((uid, nombre, dist))
    # Un reclamo que no volvió a su dorsal se reubica solo si hay un único
    # resultado en la misma distancia con exactamente el mismo nombre (el caso
    # del dorsal corregido). Si no, se pierde: el corredor lo vuelve a reclamar.
    for uid, nombre, dist in sueltos:
        tokens = _name_tokens(nombre)
        candidatos = [
            r for r in new_results if r.distance_km == dist and tokens and _name_tokens(r.full_name) == tokens
        ]
        if len(candidatos) == 1:
            restaurados.add((uid, candidatos[0].id))
    for uid, rid in restaurados:
        db.add(Claim(user_id=uid, result_id=rid))

    db.commit()
    return {"code": race.code, "published_results": len(payload.results)}


@router.post("/api/events", tags=["Organizador"])
def publish_event(
    payload: EventPayload, request: Request, x_api_key: str = Header(None), db: Session = Depends(get_db)
):
    """Publica (o actualiza) una carrera del calendario, todavía sin resultados.
    Mismo id estable que usa /api/publish: cuando el organizador suba los
    resultados, la misma fila pasa a 'finished' y aparece en Carreras."""
    rate_limit(request, "publish", limit=30, window=60.0)
    key_hash = _check_publish_key(x_api_key, db)

    race = db.scalar(select(PublishedRace).where(PublishedRace.source_id == payload.source_id))
    if race is None:
        race = PublishedRace(source_id=payload.source_id, code=_gen_code(payload.source_id, db))
        db.add(race)
    else:
        _check_race_owner(race, key_hash)
        if race.results:
            # Ya tiene resultados publicados: no se vuelve atrás sola al calendario.
            raise HTTPException(409, "Esa carrera ya tiene resultados publicados")
    race.owner_key_hash = key_hash

    race.name = payload.name
    race.location = payload.location
    race.race_date = payload.race_date
    race.distances = ",".join(str(d) for d in sorted(payload.distances)) if payload.distances else None
    race.capacity = payload.capacity
    race.registered_count = payload.registered_count
    race.registration_url = payload.registration_url
    race.event_status = "upcoming"
    db.commit()
    return {"code": race.code, "event_status": race.event_status}


# ── Despublicar (organizador) ─────────────────────────────────────────────────


@router.delete("/api/publish/{source_id}", tags=["Organizador"])
def unpublish(source_id: str, request: Request, x_api_key: str = Header(None), db: Session = Depends(get_db)):
    """Elimina una carrera publicada (y sus resultados/claims). Idempotente:
    si no existe, no es error. Lo usa la app de escritorio al borrar una carrera."""
    rate_limit(request, "publish", limit=30, window=60.0)
    key_hash = _check_publish_key(x_api_key, db)
    race = db.scalar(select(PublishedRace).where(PublishedRace.source_id == source_id))
    if not race:
        return {"deleted": False, "reason": "no existía"}
    _check_race_owner(race, key_hash)
    code = race.code
    result_ids = [r.id for r in race.results]
    if result_ids:
        db.execute(sa_delete(Claim).where(Claim.result_id.in_(result_ids)))
    for res in list(race.results):
        db.delete(res)
    db.delete(race)
    db.commit()
    return {"deleted": True, "code": code}
