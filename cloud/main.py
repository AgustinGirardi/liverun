"""ChronoTrack Cloud — portal público de resultados.

Roles:
  - Organizador: publica resultados vía POST /api/publish (protegido por API key).
  - Corredor:   crea cuenta, reclama sus resultados (dorsal + apellido) y ve su historial.
"""
import os
import hashlib
from datetime import date
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import re
from pydantic import BaseModel, Field, field_validator

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
from sqlalchemy import select, func, delete as sa_delete
from sqlalchemy.orm import Session

from cloud.db import get_db, init_db
from cloud.models import PortalUser, PublishedRace, PublishedResult, Claim
from cloud.security import hash_password, verify_password, make_token, verify_token

PUBLISH_API_KEY = os.environ.get("CT_PUBLISH_KEY", "dev-publish-key-change-me")

app = FastAPI(title="ChronoTrack Cloud", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # MVP; restringir al dominio del portal en producción
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup():
    init_db()


# ── Schemas ─────────────────────────────────────────────────────────────────

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


class PublishPayload(BaseModel):
    source_id: str = Field(..., min_length=3, max_length=64)
    name: str
    location: Optional[str] = None
    race_date: Optional[date] = None
    distances: list[float] = []
    results: list[PublishResult] = []


class RegisterIn(BaseModel):
    email: str
    password: str = Field(..., min_length=6)
    full_name: Optional[str] = None

    @field_validator("email")
    @classmethod
    def _valid_email(cls, v: str) -> str:
        if not _EMAIL_RE.match(v.strip()):
            raise ValueError("Email inválido")
        return v.strip().lower()


class LoginIn(BaseModel):
    email: str
    password: str


class ClaimIn(BaseModel):
    code: str
    bib_number: str
    last_name: str


class ClaimResultIn(BaseModel):
    result_id: int


# ── Helpers ─────────────────────────────────────────────────────────────────

def _gen_code(source_id: str, db: Session) -> str:
    base = hashlib.sha1(source_id.encode()).hexdigest().upper()
    for length in range(6, 13):
        code = base[:length]
        if not db.scalar(select(PublishedRace).where(PublishedRace.code == code)):
            return code
    return base  # fallback improbable


def _result_dict(r: PublishedResult) -> dict:
    return {
        "bib_number": r.bib_number, "full_name": r.full_name,
        "category": r.category, "club": r.club, "distance_km": r.distance_km,
        "net_time_ns": r.net_time_ns, "finish_time_ns": r.finish_time_ns,
        "position": r.position, "status": r.status,
    }


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


# ── Publicación (organizador) ────────────────────────────────────────────────

@app.post("/api/publish", tags=["Organizador"])
def publish(payload: PublishPayload, x_api_key: str = Header(None), db: Session = Depends(get_db)):
    if x_api_key != PUBLISH_API_KEY:
        raise HTTPException(403, "API key inválida")

    race = db.scalar(select(PublishedRace).where(PublishedRace.source_id == payload.source_id))
    if race is None:
        race = PublishedRace(source_id=payload.source_id, code=_gen_code(payload.source_id, db))
        db.add(race)

    race.name = payload.name
    race.location = payload.location
    race.race_date = payload.race_date
    race.distances = ",".join(str(d) for d in sorted(payload.distances)) if payload.distances else None

    # Re-publicación idempotente: reemplaza los resultados.
    db.flush()
    for old in list(race.results):
        db.delete(old)
    db.flush()

    for r in payload.results:
        db.add(PublishedResult(race_id=race.id, **r.model_dump()))

    db.commit()
    return {"code": race.code, "published_results": len(payload.results)}


# ── Lectura pública ──────────────────────────────────────────────────────────

@app.get("/api/races", tags=["Público"])
def list_races(db: Session = Depends(get_db)):
    races = db.scalars(select(PublishedRace).order_by(PublishedRace.published_at.desc())).all()
    out = []
    for race in races:
        finishers = db.scalar(
            select(func.count()).select_from(PublishedResult)
            .where(PublishedResult.race_id == race.id, PublishedResult.status == "FINISHER")
        )
        out.append({
            "code": race.code, "name": race.name, "location": race.location,
            "race_date": race.race_date.isoformat() if race.race_date else None,
            "distances": [float(x) for x in race.distances.split(",")] if race.distances else [],
            "finishers": finishers,
        })
    return out


@app.get("/api/races/{code}", tags=["Público"])
def race_detail(code: str, db: Session = Depends(get_db)):
    race = db.scalar(select(PublishedRace).where(PublishedRace.code == code.upper()))
    if not race:
        raise HTTPException(404, "Carrera no encontrada")
    results = db.scalars(
        select(PublishedResult).where(PublishedResult.race_id == race.id)
        .order_by(PublishedResult.distance_km, PublishedResult.position)
    ).all()
    return {
        "code": race.code, "name": race.name, "location": race.location,
        "race_date": race.race_date.isoformat() if race.race_date else None,
        "distances": [float(x) for x in race.distances.split(",")] if race.distances else [],
        "results": [_result_dict(r) for r in results],
    }


# ── Cuentas de corredor ──────────────────────────────────────────────────────

@app.post("/api/auth/register", tags=["Corredor"])
def register(body: RegisterIn, db: Session = Depends(get_db)):
    email = body.email.lower()
    if db.scalar(select(PortalUser).where(PortalUser.email == email)):
        raise HTTPException(409, "Ya existe una cuenta con ese email")
    user = PortalUser(email=email, password_hash=hash_password(body.password), full_name=body.full_name)
    db.add(user)
    db.commit()
    return {"token": make_token(user.id), "email": user.email, "full_name": user.full_name}


@app.post("/api/auth/login", tags=["Corredor"])
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.scalar(select(PortalUser).where(PortalUser.email == body.email.lower()))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Email o contraseña incorrectos")
    return {"token": make_token(user.id), "email": user.email, "full_name": user.full_name}


@app.post("/api/claim", tags=["Corredor"])
def claim(body: ClaimIn, user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    race = db.scalar(select(PublishedRace).where(PublishedRace.code == body.code.upper()))
    if not race:
        raise HTTPException(404, "No existe una carrera con ese código")
    last = body.last_name.strip().lower()
    matches = [
        r for r in race.results
        if r.bib_number == body.bib_number.strip() and last in r.full_name.lower()
    ]
    if not matches:
        raise HTTPException(404, "No se encontró un resultado con ese dorsal y apellido en esa carrera")
    linked = 0
    for r in matches:
        if not db.scalar(select(Claim).where(Claim.user_id == user.id, Claim.result_id == r.id)):
            db.add(Claim(user_id=user.id, result_id=r.id))
            linked += 1
    db.commit()
    return {"linked": linked, "race": race.name, "results": [_result_dict(r) for r in matches]}


@app.get("/api/me/results", tags=["Corredor"])
def my_results(user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    claims = db.scalars(select(Claim).where(Claim.user_id == user.id)).all()
    items = []
    best_by_dist: dict[float, int] = {}
    for c in claims:
        r = c.result
        race = r.race
        items.append({
            "race_code": race.code, "race_name": race.name,
            "race_date": race.race_date.isoformat() if race.race_date else None,
            "location": race.location,
            **_result_dict(r),
        })
        if r.status == "FINISHER" and r.distance_km and r.net_time_ns:
            cur = best_by_dist.get(r.distance_km)
            if cur is None or r.net_time_ns < cur:
                best_by_dist[r.distance_km] = r.net_time_ns
    items.sort(key=lambda x: x["race_date"] or "", reverse=True)
    return {
        "full_name": user.full_name,
        "total_races": len({i["race_code"] for i in items}),
        "personal_bests": [{"distance_km": k, "net_time_ns": v} for k, v in sorted(best_by_dist.items())],
        "results": items,
    }


# ── Búsqueda (corredor por nombre, o carrera por nombre/código) ───────────────

@app.get("/api/search", tags=["Público"])
def search(q: str, db: Session = Depends(get_db)):
    q = (q or "").strip()
    if len(q) < 2:
        return {"races": [], "results": []}
    ql = q.lower()
    like = f"%{ql}%"

    # Carreras por nombre o código exacto
    races = db.scalars(
        select(PublishedRace)
        .where(func.lower(PublishedRace.name).like(like) | (func.lower(PublishedRace.code) == ql))
        .order_by(PublishedRace.published_at.desc())
        .limit(20)
    ).all()
    race_out = [{
        "code": r.code, "name": r.name, "location": r.location,
        "race_date": r.race_date.isoformat() if r.race_date else None,
        "distances": [float(x) for x in r.distances.split(",")] if r.distances else [],
    } for r in races]

    # Resultados por nombre del corredor
    rows = db.execute(
        select(PublishedResult, PublishedRace)
        .join(PublishedRace, PublishedResult.race_id == PublishedRace.id)
        .where(func.lower(PublishedResult.full_name).like(like))
        .order_by(PublishedResult.full_name)
        .limit(60)
    ).all()
    results = []
    for res, race in rows:
        results.append({
            "result_id": res.id,
            "race_code": race.code, "race_name": race.name,
            "race_date": race.race_date.isoformat() if race.race_date else None,
            "location": race.location,
            **_result_dict(res),
        })
    return {"races": race_out, "results": results}


@app.post("/api/me/claim", tags=["Corredor"])
def claim_result(body: ClaimResultIn, user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    """Guarda un resultado puntual en el perfil del corredor (por id de resultado)."""
    res = db.get(PublishedResult, body.result_id)
    if not res:
        raise HTTPException(404, "Resultado no encontrado")
    existing = db.scalar(select(Claim).where(Claim.user_id == user.id, Claim.result_id == res.id))
    linked = 0
    if not existing:
        db.add(Claim(user_id=user.id, result_id=res.id))
        db.commit()
        linked = 1
    return {"linked": linked, "race": res.race.name, "result": _result_dict(res)}


# ── Despublicar (organizador) ─────────────────────────────────────────────────

@app.delete("/api/publish/{source_id}", tags=["Organizador"])
def unpublish(source_id: str, x_api_key: str = Header(None), db: Session = Depends(get_db)):
    """Elimina una carrera publicada (y sus resultados/claims). Idempotente:
    si no existe, no es error. Lo usa la app de escritorio al borrar una carrera."""
    if x_api_key != PUBLISH_API_KEY:
        raise HTTPException(403, "API key inválida")
    race = db.scalar(select(PublishedRace).where(PublishedRace.source_id == source_id))
    if not race:
        return {"deleted": False, "reason": "no existía"}
    code = race.code
    result_ids = [r.id for r in race.results]
    if result_ids:
        db.execute(sa_delete(Claim).where(Claim.result_id.in_(result_ids)))
    for res in list(race.results):
        db.delete(res)
    db.delete(race)
    db.commit()
    return {"deleted": True, "code": code}


# ── Portal estático (se monta al final para no tapar /api) ────────────────────

_static = Path(__file__).parent / "static"
if _static.exists():
    app.mount("/", StaticFiles(directory=str(_static), html=True), name="portal")
