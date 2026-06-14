"""ChronoTrack Cloud — portal público de resultados.

Roles:
  - Organizador: publica resultados vía POST /api/publish (protegido por API key).
  - Corredor:   crea cuenta, reclama sus resultados (dorsal + apellido) y ve su historial.
"""
import os
import hashlib
import unicodedata
from datetime import date
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import re
from pydantic import BaseModel, Field, field_validator

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
from sqlalchemy import select, func, delete as sa_delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from cloud.db import get_db, init_db
from cloud.models import PortalUser, PublishedRace, PublishedResult, Claim
from cloud.security import hash_password, verify_password, make_token

PUBLISH_API_KEY = os.environ.get("CT_PUBLISH_KEY", "dev-publish-key-change-me")

# Compartidos con la API móvil (cloud/run.py). _RATE y _LAST_SWEEP se re-exportan
# porque los tests los manipulan vía `cloud.main` (limpiar estado / forzar barrido).
from cloud.deps import _RATE, _LAST_SWEEP, current_user, rate_limit  # noqa: E402,F401


# ── Coincidencia de nombre (para verificar identidad al guardar resultados) ───
def _name_tokens(s: str) -> set[str]:
    s = unicodedata.normalize("NFKD", (s or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return {t for t in re.findall(r"[a-z]+", s) if len(t) >= 3}

def _name_matches(a: str, b: str) -> bool:
    return bool(_name_tokens(a) & _name_tokens(b))


app = FastAPI(title="ChronoTrack Cloud", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # MVP; restringir al dominio del portal en producción
    allow_methods=["*"],
    allow_headers=["*"],
)


def _ensure_run_columns():
    """Migración suave para SQLite: columnas de ChronoTrack Run en portal_users.
    Mismo criterio que _ensure_email_hash_column. Idempotente."""
    from sqlalchemy import text
    from cloud.db import engine
    with engine.begin() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(portal_users)"))]
        if not cols:
            return  # tabla inexistente: create_all la crea completa
        wanted = {
            "google_id":     "ALTER TABLE portal_users ADD COLUMN google_id VARCHAR(64)",
            "username":      "ALTER TABLE portal_users ADD COLUMN username VARCHAR(30)",
            "weekly_goal":   "ALTER TABLE portal_users ADD COLUMN weekly_goal INTEGER NOT NULL DEFAULT 3",
            "avatar_url":    "ALTER TABLE portal_users ADD COLUMN avatar_url VARCHAR(400)",
            "is_admin":      "ALTER TABLE portal_users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0",
            "premium_until": "ALTER TABLE portal_users ADD COLUMN premium_until DATETIME",
        }
        for col, ddl in wanted.items():
            if col not in cols:
                conn.execute(text(ddl))
        # SQLite: UNIQUE de columnas nuevas via indices (ALTER no admite constraints)
        conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ux_portal_users_username ON portal_users (username)"))
        conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ux_portal_users_google_id ON portal_users (google_id)"))


def _ensure_admins():
    """Marca como admin a los emails de CT_ADMIN_EMAILS (CSV). Idempotente:
    corre en cada arranque, así agregar un admin es solo setear la env var."""
    emails = [e.strip().lower() for e in os.environ.get("CT_ADMIN_EMAILS", "").split(",") if e.strip()]
    if not emails:
        return
    from sqlalchemy import text
    from cloud.db import engine
    with engine.begin() as conn:
        for e in emails:
            conn.execute(text("UPDATE portal_users SET is_admin=1 WHERE lower(email)=:e"), {"e": e})


def _ensure_email_hash_column():
    """Migración suave para SQLite: agrega published_results.email_hash si falta.
    create_all() no altera tablas existentes, así que en bases ya creadas
    (p. ej. Render) hay que hacer el ALTER manualmente. Idempotente."""
    from sqlalchemy import text
    from cloud.db import engine
    with engine.begin() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(published_results)"))]
        if not cols:
            return  # tabla inexistente: create_all (ya corrió en init_db) la crea con la columna
        if "email_hash" not in cols:
            conn.execute(text("ALTER TABLE published_results ADD COLUMN email_hash VARCHAR(64)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_published_results_email_hash ON published_results (email_hash)"))


@app.on_event("startup")
def _startup():
    # En producción (Render setea la env var RENDER) NO arrancar con secretos por
    # defecto: tokens y publicación quedarían falsificables. Fallar temprano y claro.
    if os.environ.get("RENDER"):
        from cloud.security import SECRET
        if SECRET == "dev-insecure-secret-change-me" or PUBLISH_API_KEY == "dev-publish-key-change-me":
            raise RuntimeError(
                "Faltan secretos en producción: definí CT_CLOUD_SECRET y CT_PUBLISH_KEY "
                "(Render los genera automáticamente vía render.yaml)."
            )
    init_db()
    _ensure_email_hash_column()
    _ensure_run_columns()
    _ensure_admins()


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
    email_hash: Optional[str] = Field(None, max_length=64)  # sha256 hex (64 chars); el escritorio lo calcula, el cloud nunca ve el email en claro


class PublishPayload(BaseModel):
    source_id: str = Field(..., min_length=3, max_length=64)
    name: str
    location: Optional[str] = None
    race_date: Optional[date] = None
    distances: list[float] = []
    results: list[PublishResult] = []


class RegisterIn(BaseModel):
    email: str
    password: str = Field(..., min_length=8)
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
    last_name: Optional[str] = None


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


def _email_hash(email: str) -> str:
    """sha256 del email normalizado. DEBE coincidir byte a byte con
    backend/api/routes.py::_email_hash — si cambia uno, cambiar el otro."""
    return hashlib.sha256(("chronotrack-v1:" + (email or "").strip().lower()).encode()).hexdigest()


def _autolink(user: PortalUser, db: Session) -> int:
    """Vincula a `user` todos los PublishedResult cuyo email_hash coincide con su
    email de cuenta. Devuelve cuántos vínculos NUEVOS creó (no duplica)."""
    h = _email_hash(user.email)
    results = db.scalars(
        select(PublishedResult).where(PublishedResult.email_hash == h)
    ).all()
    claimed_ids = set(db.scalars(
        select(Claim.result_id).where(Claim.user_id == user.id)
    ).all())
    created = 0
    for res in results:
        if res.id not in claimed_ids:
            db.add(Claim(user_id=user.id, result_id=res.id))
            created += 1
    if created:
        db.commit()
    return created


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

    # Re-publicación idempotente: reemplaza los resultados, pero los claims de los
    # corredores deben sobrevivir (si no, cada corrección del organizador les
    # vaciaría el perfil). Se preservan por (dorsal, distancia).
    db.flush()
    old_claims: dict[tuple, list[int]] = {}
    for old in race.results:
        for cl in old.claims:
            old_claims.setdefault((old.bib_number, old.distance_km), []).append(cl.user_id)
    for old in list(race.results):
        db.delete(old)
    db.flush()

    new_results = []
    for r in payload.results:
        res = PublishedResult(race_id=race.id, **r.model_dump())
        db.add(res)
        new_results.append(res)
    db.flush()
    for res in new_results:
        for uid in old_claims.get((res.bib_number, res.distance_km), []):
            db.add(Claim(user_id=uid, result_id=res.id))

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
        # Dentro de cada distancia: primero los FINISHER por posición, luego DNF/DNS/DQ.
        # (Si no, los position=NULL de SQLite quedarían antes del 1° puesto.)
        .order_by(
            PublishedResult.distance_km,
            (PublishedResult.status != "FINISHER"),
            PublishedResult.position,
        )
    ).all()
    return {
        "code": race.code, "name": race.name, "location": race.location,
        "race_date": race.race_date.isoformat() if race.race_date else None,
        "distances": [float(x) for x in race.distances.split(",")] if race.distances else [],
        "results": [_result_dict(r) for r in results],
    }


# ── Cuentas de corredor ──────────────────────────────────────────────────────

@app.post("/api/auth/register", tags=["Corredor"])
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db)):
    # Registro permisivo: en un evento muchos corredores se anotan desde la misma
    # WiFi (mismo IP). El abuso de registro es de bajo valor (sólo da acceso a datos
    # ya públicos), así que el límite apunta a frenar floods automáticos, no a personas.
    rate_limit(request, "register", limit=40, window=60.0)
    email = body.email.lower()
    if db.scalar(select(PortalUser).where(PortalUser.email == email)):
        raise HTTPException(409, "Ya existe una cuenta con ese email")
    user = PortalUser(email=email, password_hash=hash_password(body.password), full_name=body.full_name)
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # Dos registros simultáneos con el mismo email: el segundo pierde contra
        # el unique de la tabla. Mismo mensaje que el chequeo previo, no un 500.
        db.rollback()
        raise HTTPException(409, "Ya existe una cuenta con ese email")
    try:
        linked = _autolink(user, db)
    except Exception:
        db.rollback()
        linked = 0
    return {"token": make_token(user.id), "email": user.email, "full_name": user.full_name, "linked": linked}


@app.post("/api/auth/login", tags=["Corredor"])
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    # Login más estricto: es el vector de fuerza-bruta de contraseñas.
    rate_limit(request, "login", limit=15, window=60.0)
    user = db.scalar(select(PortalUser).where(PortalUser.email == body.email.lower()))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Email o contraseña incorrectos")
    try:
        linked = _autolink(user, db)
    except Exception:
        db.rollback()
        linked = 0
    return {"token": make_token(user.id), "email": user.email, "full_name": user.full_name, "linked": linked}


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
def claim_result(body: ClaimResultIn, request: Request, user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    """Guarda un resultado puntual en el perfil del corredor (por id de resultado).

    Verifica identidad: el resultado debe coincidir con el nombre del usuario
    (o con el apellido provisto). Evita que alguien adjunte a su perfil el
    resultado de otra persona sólo conociendo su result_id (que es público)."""
    rate_limit(request, "claim", limit=30, window=60.0)
    res = db.get(PublishedResult, body.result_id)
    if not res:
        raise HTTPException(404, "Resultado no encontrado")
    prov_last = (body.last_name or "").strip().lower()
    identity_ok = (
        (prov_last and prov_last in res.full_name.lower())
        or (user.full_name and _name_matches(user.full_name, res.full_name))
    )
    if not identity_ok:
        raise HTTPException(
            403,
            "Ese resultado no coincide con tu nombre. Si es tuyo, completá tu nombre "
            "en el perfil o reclamalo con código + dorsal + apellido.",
        )
    existing = db.scalar(select(Claim).where(Claim.user_id == user.id, Claim.result_id == res.id))
    linked = 0
    if not existing:
        db.add(Claim(user_id=user.id, result_id=res.id))
        db.commit()
        linked = 1
    return {"linked": linked, "race": res.race.name, "result": _result_dict(res)}


@app.post("/api/me/autolink", tags=["Corredor"])
def autolink_me(request: Request, user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    """Re-ejecuta la auto-vinculación por email para el usuario logueado.
    Lo usa el botón 'Buscar mis resultados por email' del perfil."""
    rate_limit(request, "claim", limit=30, window=60.0)
    linked = _autolink(user, db)
    return {"linked": linked}


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


# ── API de la app móvil (ChronoTrack Run) ─────────────────────────────────────

from cloud.run import router as run_router  # noqa: E402
from cloud.google_auth import router as google_router  # noqa: E402

app.include_router(run_router)
app.include_router(google_router)


# ── Estáticos: avatares y portal (al final para no tapar /api) ────────────────

from cloud.run import avatar_dir  # noqa: E402

app.mount("/avatars", StaticFiles(directory=str(avatar_dir())), name="avatars")

_static = Path(__file__).parent / "static"
if _static.exists():
    app.mount("/", StaticFiles(directory=str(_static), html=True), name="portal")
