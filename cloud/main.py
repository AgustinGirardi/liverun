"""ChronoTrack Cloud — portal público de resultados.

Roles:
  - Organizador: publica resultados vía POST /api/publish (protegido por API key).
  - Corredor:   crea cuenta, reclama sus resultados (dorsal + apellido) y ve su historial.
"""
import os
import hashlib
import time
import unicodedata
from hmac import compare_digest as hmac_compare
from datetime import date
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import BackgroundTasks, FastAPI, Depends, HTTPException, Header, Request
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
from cloud.security import (
    hash_password, verify_password, make_token,
    make_mail_token, mail_token_uid, verify_mail_token,
)
from cloud import mailer
# Días calendario en hora argentina (ver cloud/run.py). run.py no importa main.
from cloud.run import ahora_utc, hoy_ar

PUBLISH_API_KEY = os.environ.get("CT_PUBLISH_KEY", "dev-publish-key-change-me")

# Compartidos con la API móvil (cloud/run.py). _RATE y _LAST_SWEEP se re-exportan
# porque los tests los manipulan vía `cloud.main` (limpiar estado / forzar barrido).
from cloud.deps import _RATE, _LAST_SWEEP, admin_emails, current_user, rate_limit, rate_limit_key  # noqa: E402,F401


# ── Coincidencia de nombre (para verificar identidad al guardar resultados) ───
def _name_tokens(s: str) -> set[str]:
    s = unicodedata.normalize("NFKD", (s or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return {t for t in re.findall(r"[a-z]+", s) if len(t) >= 3}

def normalizar_nombre(s: str) -> str:
    """Forma buscable de un nombre: minúsculas, sin acentos (la ñ queda como n)
    y solo letras y números separados por un espacio. "José Pérez-Núñez" →
    "jose perez nunez". Se guarda en PublishedResult.name_norm y se aplica
    igual a lo que escribe el usuario, así las dos puntas comparan lo mismo."""
    s = unicodedata.normalize("NFKD", (s or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(re.findall(r"[a-z0-9]+", s))


def _name_matches(a: str, b: str) -> bool:
    return bool(_name_tokens(a) & _name_tokens(b))

def _last_name_matches(provisto: str, full_name: str) -> bool:
    """El apellido provisto tiene que ser una palabra COMPLETA del nombre.

    Antes esto era `provisto in full_name.lower()`, un substring sin longitud
    minima: `last_name="a"` matcheaba a casi cualquier corredor y permitia
    adjudicarse resultados ajenos en masa (los result_id son publicos).
    `_name_tokens` ya descarta tokens de menos de 3 letras.
    """
    return bool(_name_tokens(provisto) & _name_tokens(full_name))


# Docs interactivas: utiles en desarrollo, pero en produccion son un catalogo
# gratis de los endpoints de admin y organizador para cualquier escaneo
# automatizado. RENDER lo setea la plataforma; en local siguen disponibles.
_EN_PRODUCCION = bool(os.environ.get("RENDER"))


@asynccontextmanager
async def _lifespan(_app):
    # Reemplaza al @app.on_event("startup") deprecado. _startup se resuelve
    # recién al arrancar, así que puede estar definida más abajo.
    _startup()
    yield


app = FastAPI(
    lifespan=_lifespan,
    title="LiveRun Cloud",
    version="1.0",
    docs_url=None if _EN_PRODUCCION else "/docs",
    redoc_url=None if _EN_PRODUCCION else "/redoc",
    openapi_url=None if _EN_PRODUCCION else "/openapi.json",
)

# CORS cerrado al propio portal (el SPA es same-origin; esto cubre subdominios
# o un dominio propio futuro vía CT_PUBLIC_URL) + localhost para desarrollo.
# La app móvil no manda header Origin (fetch nativo), así que no la afecta.
PUBLIC_URL = os.environ.get("CT_PUBLIC_URL", "https://chronotrack-portal.onrender.com").rstrip("/")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[PUBLIC_URL, "http://localhost:8002", "http://127.0.0.1:8002"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# script-src sin 'unsafe-inline': el portal engancha sus acciones con
# data-act/data-submit y un solo listener (static/js/ui/acciones.js), así que un
# HTML inyectado no puede ejecutar nada. style-src sí lo mantiene: las vistas
# usan algún style="" (alto de las barras, ancho del cupo).
# img-src incluye https: por las fotos de perfil de Google, que se guardan con
# su URL completa (lh3.googleusercontent.com).
_CSP = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' https: data:; "
    "connect-src 'self'; "
    "object-src 'none'; "
    "base-uri 'none'; "
    "form-action 'self'; "
    "frame-ancestors 'none'"
)


def _cache_control(path: str) -> Optional[str]:
    """Caché de los archivos del portal. Sin esta cabecera el navegador aplica
    su heurística (un 10 % de la edad del archivo) y, después de publicar,
    podía juntar un index.html nuevo con un app.js viejo. HTML, JS y CSS se
    revalidan siempre (un 304 con ETag cuesta poco); las imágenes duran un día."""
    if path.startswith("/api/"):
        return None
    if path == "/" or path.endswith((".html", ".js", ".css")):
        return "no-cache"
    if path.endswith((".svg", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".woff2")):
        return "public, max-age=86400"
    return None


@app.middleware("http")
async def _security_headers(request: Request, call_next):
    """Cabeceras defensivas: sin sniffing de content-type (avatares subidos),
    sin embeber el portal en iframes de terceros, referrer mínimo."""
    resp = await call_next(request)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    resp.headers.setdefault("Content-Security-Policy", _CSP)
    cache = _cache_control(request.url.path)
    if cache:
        resp.headers.setdefault("Cache-Control", cache)
    if _EN_PRODUCCION:
        # Solo en produccion: en local el portal se sirve por http y el HSTS
        # dejaria el navegador forzando https contra localhost.
        resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return resp


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
            "pending_discount_percent": "ALTER TABLE portal_users ADD COLUMN pending_discount_percent INTEGER",
            "tokens_valid_from": "ALTER TABLE portal_users ADD COLUMN tokens_valid_from INTEGER",
            "email_verified_at": "ALTER TABLE portal_users ADD COLUMN email_verified_at DATETIME",
        }
        for col, ddl in wanted.items():
            if col not in cols:
                conn.execute(text(ddl))
        # Las cuentas con Google ya tienen el email verificado (lo verificó
        # Google). Las de solo contraseña quedan sin verificar. Idempotente:
        # solo toca las que siguen en NULL. CURRENT_TIMESTAMP de SQLite es UTC.
        conn.execute(text("UPDATE portal_users SET email_verified_at = CURRENT_TIMESTAMP "
                          "WHERE google_id IS NOT NULL AND email_verified_at IS NULL"))
        # SQLite: UNIQUE de columnas nuevas via indices (ALTER no admite constraints)
        conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ux_portal_users_username ON portal_users (username)"))
        conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ux_portal_users_google_id ON portal_users (google_id)"))


def _ensure_admins():
    """Sincroniza is_admin con CT_ADMIN_EMAILS (CSV). Idempotente: corre en
    cada arranque, así agregar o sacar un admin es solo tocar la env var.

    Solo se promueve a cuentas con el email verificado (link del mail,
    reset de contraseña o Google): el registro no lo verifica, así que
    cualquiera podía crear la cuenta de un email de admin antes que su dueño y
    quedar como admin en el próximo arranque. Y quien ya no está en la lista
    (o no está verificado ni tiene Google) pierde el admin: antes la marca
    quedaba para siempre.
    """
    emails = sorted(admin_emails())
    from sqlalchemy import text, bindparam
    from cloud.db import engine
    with engine.begin() as conn:
        if emails:
            conn.execute(
                text("UPDATE portal_users SET is_admin=1 "
                     "WHERE lower(email) IN :emails "
                     "AND (google_id IS NOT NULL OR email_verified_at IS NOT NULL)")
                .bindparams(bindparam("emails", expanding=True)),
                {"emails": emails})
            conn.execute(
                text("UPDATE portal_users SET is_admin=0 WHERE is_admin=1 "
                     "AND (lower(email) NOT IN :emails "
                     "OR (google_id IS NULL AND email_verified_at IS NULL))")
                .bindparams(bindparam("emails", expanding=True)),
                {"emails": emails})
        else:
            conn.execute(text("UPDATE portal_users SET is_admin=0 WHERE is_admin=1"))


def _ensure_billing_columns():
    """Migración suave para SQLite: run_billing_payments.granted_s (cuánto
    premium sumó cada pago, para revocarlo si se devuelve). Columna nullable:
    un ADD COLUMN en SQLite no reescribe la tabla y los pagos viejos quedan en
    NULL (se asume un mes). Idempotente."""
    from sqlalchemy import text
    from cloud.db import engine
    with engine.begin() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(run_billing_payments)"))]
        if not cols:
            return  # tabla inexistente: create_all ya la crea con la columna
        if "granted_s" not in cols:
            conn.execute(text("ALTER TABLE run_billing_payments ADD COLUMN granted_s INTEGER"))


def _migrar_avatares_a_relativo():
    """Los avatares propios se guardaban con el host adentro, así que un cambio
    de dominio los rompía en la base. Los pasa a ruta relativa. Idempotente.
    No toca las fotos de Google: esas no contienen "/avatars/"."""
    from sqlalchemy import text
    from cloud.db import engine
    with engine.begin() as conn:
        conn.execute(text(
            "UPDATE portal_users "
            "SET avatar_url = substr(avatar_url, instr(avatar_url, '/avatars/')) "
            "WHERE avatar_url LIKE '%/avatars/%' AND avatar_url NOT LIKE '/avatars/%'"
        ))


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


def _ensure_name_norm_column(lote: int = 500):
    """Migración suave para SQLite: agrega published_results.name_norm y la
    completa para los resultados que ya estaban publicados. El relleno va en
    Python (SQLite no sabe sacar acentos) y por lotes, cada uno en su propia
    transacción, para no tener la base bloqueada de una sola vez. Idempotente:
    si no quedan filas en NULL, no hace nada."""
    from sqlalchemy import text
    from cloud.db import engine
    with engine.begin() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(published_results)"))]
        if not cols:
            return  # tabla inexistente: create_all ya la crea con la columna
        if "name_norm" not in cols:
            conn.execute(text("ALTER TABLE published_results ADD COLUMN name_norm VARCHAR(200)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_published_results_name_norm "
                          "ON published_results (name_norm)"))
    while True:
        with engine.begin() as conn:
            filas = conn.execute(text(
                "SELECT id, full_name FROM published_results WHERE name_norm IS NULL LIMIT :n"
            ), {"n": lote}).all()
            if not filas:
                return
            conn.execute(
                text("UPDATE published_results SET name_norm = :nn WHERE id = :id"),
                [{"id": fid, "nn": normalizar_nombre(nombre)} for fid, nombre in filas],
            )


def _ensure_category_position_column():
    """Migración suave para SQLite: agrega published_results.category_position.
    Mismo criterio que _ensure_email_hash_column. Idempotente."""
    from sqlalchemy import text
    from cloud.db import engine
    with engine.begin() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(published_results)"))]
        if not cols:
            return  # tabla inexistente: create_all ya la crea con la columna
        if "category_position" not in cols:
            conn.execute(text("ALTER TABLE published_results ADD COLUMN category_position INTEGER"))


def _ensure_owner_key_column():
    """Migracion suave para SQLite: agrega published_races.owner_key_hash.
    Las carreras que ya existian quedan en NULL y adoptan dueño la proxima vez
    que se republican, asi una base viva no se bloquea sola. Idempotente."""
    from sqlalchemy import text
    from cloud.db import engine
    with engine.begin() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(published_races)"))]
        if not cols:
            return  # tabla inexistente: create_all ya la crea con la columna
        if "owner_key_hash" not in cols:
            conn.execute(text("ALTER TABLE published_races ADD COLUMN owner_key_hash VARCHAR(64)"))


def _ensure_password_set_column():
    """Migración suave para SQLite: agrega portal_users.password_set. Las
    cuentas sin Google eligieron su contraseña al registrarse (1); las
    vinculadas a Google quedan en NULL porque no se puede saber si alguna vez
    eligieron una. Idempotente."""
    from sqlalchemy import text
    from cloud.db import engine
    with engine.begin() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(portal_users)"))]
        if not cols:
            return  # tabla inexistente: create_all ya la crea con la columna
        if "password_set" not in cols:
            conn.execute(text("ALTER TABLE portal_users ADD COLUMN password_set INTEGER"))
            conn.execute(text("UPDATE portal_users SET password_set = 1 WHERE google_id IS NULL"))


def _ensure_event_columns():
    """Migración suave para SQLite: columnas de calendario en published_races.
    Las carreras que ya estaban publicadas son resultados, así que el default
    'finished' las deja donde estaban. Idempotente."""
    from sqlalchemy import text
    from cloud.db import engine
    with engine.begin() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(published_races)"))]
        if not cols:
            return
        wanted = {
            "event_status":     "ALTER TABLE published_races ADD COLUMN event_status VARCHAR(12) NOT NULL DEFAULT 'finished'",
            "registration_url": "ALTER TABLE published_races ADD COLUMN registration_url VARCHAR(400)",
            "capacity":         "ALTER TABLE published_races ADD COLUMN capacity INTEGER",
            "registered_count": "ALTER TABLE published_races ADD COLUMN registered_count INTEGER",
        }
        for col, ddl in wanted.items():
            if col not in cols:
                conn.execute(text(ddl))


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
    if os.environ.get("RENDER") and not mailer.configurado():
        # No se frena el arranque: sin mails solo se pierden la verificación
        # y el reset de contraseña, no el resto del portal.
        mailer.log.warning(
            "CT_SMTP_HOST no está configurado: los mails de verificación y de "
            "'olvidé mi contraseña' NO van a salir (ver DEPLOY.md).")
    init_db()
    _ensure_email_hash_column()
    _ensure_name_norm_column()
    _ensure_category_position_column()
    _ensure_event_columns()
    _ensure_owner_key_column()
    _ensure_run_columns()
    _ensure_password_set_column()
    _ensure_billing_columns()
    _migrar_avatares_a_relativo()
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


class ChangePasswordIn(BaseModel):
    # Opcional sólo para cuentas que nunca eligieron contraseña (entran con
    # Google): ver change_password.
    current_password: Optional[str] = None
    new_password: str = Field(..., min_length=8)


class MailTokenIn(BaseModel):
    token: str = Field(..., max_length=2000)


class VerifyIn(MailTokenIn):
    # Sin sesión de esa misma cuenta, verificar pide la contraseña (ver verify_email).
    password: Optional[str] = Field(None, max_length=200)


class ForgotIn(BaseModel):
    email: str = Field(..., max_length=255)


class ResetIn(BaseModel):
    token: str = Field(..., max_length=2000)
    new_password: str = Field(..., min_length=8)


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
        "position": r.position, "category_position": r.category_position,
        "status": r.status,
    }


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


def _email_hash(email: str) -> str:
    """sha256 del email normalizado. DEBE coincidir byte a byte con
    backend/api/routes.py::_email_hash — si cambia uno, cambiar el otro."""
    return hashlib.sha256(("chronotrack-v1:" + (email or "").strip().lower()).encode()).hexdigest()


def _autolink(user: PortalUser, db: Session) -> int:
    """Vincula a `user` todos los PublishedResult cuyo email_hash coincide con su
    email de cuenta. Devuelve cuántos vínculos NUEVOS creó (no duplica).

    Solo con el email verificado: si no, alcanzaba con registrarse con el
    email de otro para llevarse su historial de carreras."""
    if not user.email_verified_at:
        return 0
    h = _email_hash(user.email)
    results = db.scalars(
        select(PublishedResult).where(PublishedResult.email_hash == h)
    ).all()
    claimed_ids = set(db.scalars(
        select(Claim.result_id).where(Claim.user_id == user.id)
    ).all())
    created = 0
    for res in results:
        # El email_hash viaja en el payload de publicacion y el algoritmo es
        # publico: solo con el hash, un organizador podia colgarle a cualquier
        # email un resultado inventado, que aparecia como propio en el siguiente
        # login. Pedir que el nombre tambien coincida cierra esa via. Si la
        # cuenta todavia no cargo su nombre, el hash sigue alcanzando (es el
        # caso de las cuentas viejas y del alta por Google sin nombre).
        if user.full_name and not _name_matches(user.full_name, res.full_name):
            continue
        if res.id not in claimed_ids:
            db.add(Claim(user_id=user.id, result_id=res.id))
            created += 1
    if created:
        db.commit()
    return created


# ── Autenticación del organizador ────────────────────────────────────────────

def _check_publish_key(x_api_key: Optional[str]) -> str:
    """Valida la API key de publicación y devuelve su hash (identidad del dueño).

    Se compara en bytes y no en str: hmac.compare_digest sobre str exige ASCII
    puro, y como Starlette decodifica los headers en latin-1 un `X-API-Key: á`
    reventaba con TypeError → 500 en vez de un 403 limpio.
    """
    if not x_api_key:
        raise HTTPException(403, "API key inválida")
    # compare_digest: comparación en tiempo constante (no filtra la key por timing).
    if not hmac_compare(x_api_key.encode("utf-8", "ignore"), PUBLISH_API_KEY.encode("utf-8")):
        raise HTTPException(403, "API key inválida")
    return hashlib.sha256(x_api_key.encode("utf-8", "ignore")).hexdigest()


def _check_race_owner(race: PublishedRace, key_hash: str) -> None:
    """Una carrera pertenece a la key que la publicó.

    Hoy hay una sola CT_PUBLISH_KEY y esto no rechaza nada, pero deja la
    propiedad grabada desde el primer día: cuando haya una key por organizador,
    ninguno va a poder pisar ni borrar las carreras de otro sólo por conocer el
    source_id. Las carreras previas a la migración tienen owner_key_hash NULL y
    adoptan dueño en su próxima publicación.
    """
    if race.owner_key_hash and not hmac_compare(race.owner_key_hash, key_hash):
        raise HTTPException(403, "Esa carrera fue publicada por otro organizador")


# ── Publicación (organizador) ────────────────────────────────────────────────

@app.post("/api/publish", tags=["Organizador"])
def publish(payload: PublishPayload, request: Request, x_api_key: str = Header(None), db: Session = Depends(get_db)):
    # Publicar es caro (borra y reinserta toda la carrera): sin tope, una key
    # filtrada permite machacar el servicio además de falsear resultados.
    rate_limit(request, "publish", limit=30, window=60.0)
    key_hash = _check_publish_key(x_api_key)

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
        candidatos = [r for r in new_results
                      if r.distance_km == dist and tokens and _name_tokens(r.full_name) == tokens]
        if len(candidatos) == 1:
            restaurados.add((uid, candidatos[0].id))
    for uid, rid in restaurados:
        db.add(Claim(user_id=uid, result_id=rid))

    db.commit()
    return {"code": race.code, "published_results": len(payload.results)}


@app.post("/api/events", tags=["Organizador"])
def publish_event(payload: EventPayload, request: Request, x_api_key: str = Header(None), db: Session = Depends(get_db)):
    """Publica (o actualiza) una carrera del calendario, todavía sin resultados.
    Mismo id estable que usa /api/publish: cuando el organizador suba los
    resultados, la misma fila pasa a 'finished' y aparece en Carreras."""
    rate_limit(request, "publish", limit=30, window=60.0)
    key_hash = _check_publish_key(x_api_key)

    race = db.scalar(select(PublishedRace).where(PublishedRace.source_id == payload.source_id))
    if race is None:
        race = PublishedRace(source_id=payload.source_id, code=_gen_code(payload.source_id, db))
        db.add(race)
    elif race.results:
        # Ya tiene resultados publicados: no se vuelve atrás sola al calendario.
        raise HTTPException(409, "Esa carrera ya tiene resultados publicados")

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


def _event_dict(r: PublishedRace) -> dict:
    return {
        "code": r.code, "name": r.name, "location": r.location,
        "race_date": r.race_date.isoformat() if r.race_date else None,
        "distances": [float(x) for x in r.distances.split(",")] if r.distances else [],
        "capacity": r.capacity, "registered_count": r.registered_count,
        "registration_url": r.registration_url,
    }


@app.get("/api/events", tags=["Público"])
def list_events(db: Session = Depends(get_db)):
    """Calendario: eventos anunciados que todavía no se corrieron, del más
    próximo al más lejano. Las fechas ya pasadas no se muestran aunque el
    organizador no haya subido los resultados todavía."""
    races = db.scalars(
        select(PublishedRace)
        .where(PublishedRace.event_status == "upcoming",
               (PublishedRace.race_date == None) | (PublishedRace.race_date >= hoy_ar()))  # noqa: E711
        .order_by(PublishedRace.race_date.asc())
    ).all()
    return [_event_dict(r) for r in races]


# ── Lectura pública ──────────────────────────────────────────────────────────

@app.get("/api/races", tags=["Público"])
def list_races(db: Session = Depends(get_db)):
    # Sólo carreras con resultados: un evento del calendario aparecería acá con
    # "0 finishers" y una tabla vacía.
    races = db.scalars(
        select(PublishedRace)
        .where(PublishedRace.event_status == "finished")
        .order_by(PublishedRace.published_at.desc())
    ).all()
    # Un solo COUNT agrupado en vez de una query por carrera: con el listado
    # completo esto era un N+1 que escalaba con cada carrera publicada.
    conteos = dict(db.execute(
        select(PublishedResult.race_id, func.count())
        .where(PublishedResult.status == "FINISHER")
        .group_by(PublishedResult.race_id)
    ).all())
    out = []
    for race in races:
        finishers = conteos.get(race.id, 0)
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
        # result_id: para "guardar en mi perfil" desde la tabla de la carrera
        # (ya era público: la búsqueda lo devuelve).
        "results": [{"result_id": r.id, **_result_dict(r)} for r in results],
    }


# ── Cuentas de corredor ──────────────────────────────────────────────────────

# Hash de descarte para igualar el tiempo del login cuando el email no existe.
# Se calcula una vez al importar (200.000 iteraciones no son gratis).
_DUMMY_HASH = hash_password("contraseña-que-nunca-va-a-coincidir")

@app.post("/api/auth/register", tags=["Corredor"])
def register(body: RegisterIn, request: Request, background: BackgroundTasks,
             db: Session = Depends(get_db)):
    # Registro permisivo: en un evento muchos corredores se anotan desde la misma
    # WiFi (mismo IP). El abuso de registro es de bajo valor (sólo da acceso a datos
    # ya públicos), así que el límite apunta a frenar floods automáticos, no a personas.
    rate_limit(request, "register", limit=40, window=60.0)
    email = body.email.lower()
    if db.scalar(select(PortalUser).where(PortalUser.email == email)):
        raise HTTPException(409, "Ya existe una cuenta con ese email")
    # tokens_valid_from = alta: si SQLite le reasigna el id de una cuenta
    # borrada, los tokens de aquella (mismo id, iat anterior) no abren esta.
    user = PortalUser(email=email, password_hash=hash_password(body.password), full_name=body.full_name,
                      tokens_valid_from=int(time.time()), password_set=1)
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # Dos registros simultáneos con el mismo email: el segundo pierde contra
        # el unique de la tabla. Mismo mensaje que el chequeo previo, no un 500.
        db.rollback()
        raise HTTPException(409, "Ya existe una cuenta con ese email")
    # Sin autolink acá: la cuenta nace sin verificar. Los resultados se
    # vinculan cuando el usuario abre el link del mail.
    _mandar_verificacion(user, background)
    return {"token": make_token(user.id), "email": user.email, "full_name": user.full_name, "linked": 0}


@app.post("/api/auth/login", tags=["Corredor"])
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    # Login más estricto: es el vector de fuerza-bruta de contraseñas.
    rate_limit(request, "login", limit=15, window=60.0)
    user = db.scalar(select(PortalUser).where(PortalUser.email == body.email.lower()))
    if not user:
        # Gastar el mismo PBKDF2 que gastariamos con un usuario real. Sin esto
        # un email inexistente respondia en ~1 ms y uno registrado en ~80 ms
        # (200.000 iteraciones), y esa diferencia sola permite listar quien
        # tiene cuenta en el portal.
        verify_password(body.password, _DUMMY_HASH)
        raise HTTPException(401, "Email o contraseña incorrectos")
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Email o contraseña incorrectos")
    try:
        linked = _autolink(user, db)
    except Exception:
        db.rollback()
        linked = 0
    return {"token": make_token(user.id), "email": user.email, "full_name": user.full_name, "linked": linked}


@app.delete("/api/auth/account", tags=["Corredor"])
def delete_account(request: Request, user: PortalUser = Depends(current_user),
                   db: Session = Depends(get_db)):
    """Borra la cuenta y todos sus datos personales (requisito de App Store
    5.1.1(v) y Google Play). Los resultados publicados de las carreras no se
    tocan (son datos del organizador, ya públicos): solo se rompe el vínculo
    (claims). Irreversible."""
    rate_limit(request, "delete_account", limit=5, window=60.0)

    # Mejor esfuerzo: cancelar la suscripción de Mercado Pago para no seguir
    # cobrando una cuenta que ya no existe. Si MP falla, el borrado procede.
    from cloud import billing
    from cloud.models import (
        BillingPayment, BillingSubscription, CouponRedemption, Friendship,
    )
    subs = db.scalars(select(BillingSubscription)
                      .where(BillingSubscription.user_id == user.id)).all()
    for sub in subs:
        if sub.status == "cancelled" or not billing.is_configured():
            continue
        try:
            billing.cancel_preapproval(sub.mp_preapproval_id)
        except Exception as e:
            # El borrado NO se bloquea por una caída de MP: es una decisión
            # deliberada (ver test_borrar_sigue_aunque_mp_falle). Pero antes esto
            # era un `pass` mudo y el preapproval quedaba vivo cobrando todos los
            # meses sin ningún rastro. Ahora queda registrado, y si llega a
            # cobrar, apply_payment lo cancela al no poder mapearlo a nadie.
            print(f"[MP] no se pudo cancelar {sub.mp_preapproval_id} al borrar "
                  f"la cuenta {user.id}: {e} — queda como huérfano", flush=True)

    # El avatar es un archivo en disco: el CASCADE de la DB no lo cubre.
    from cloud.run import avatar_dir
    try:
        for f in avatar_dir().glob(f"{user.id}.*"):
            f.unlink(missing_ok=True)
    except OSError:
        pass

    # Dependencias sin relationship en el ORM: borrado explícito (no dependemos
    # del ondelete=CASCADE, que en SQLite requiere PRAGMA foreign_keys).
    db.execute(sa_delete(Friendship).where(
        (Friendship.requester_id == user.id) | (Friendship.addressee_id == user.id)))
    db.execute(sa_delete(CouponRedemption).where(CouponRedemption.user_id == user.id))
    db.execute(sa_delete(BillingPayment).where(BillingPayment.user_id == user.id))
    db.execute(sa_delete(BillingSubscription).where(BillingSubscription.user_id == user.id))
    db.delete(user)  # el cascade del ORM borra claims y actividades
    db.commit()
    return {"deleted": True}


@app.post("/api/auth/password", tags=["Corredor"])
def change_password(body: ChangePasswordIn, request: Request,
                    user: PortalUser = Depends(current_user),
                    db: Session = Depends(get_db)):
    """Cambia la contraseña y cierra el resto de las sesiones abiertas.

    Devuelve un token nuevo para no echar de la app a quien acaba de hacer el
    cambio: el suyo se emite después del corte, los demás quedan abajo.
    """
    rate_limit(request, "password", limit=5, window=300.0)
    # Una cuenta creada con Google tiene de contraseña un valor al azar que
    # nadie conoce: pedirle "la actual" la dejaba sin forma de elegir una. Ahí
    # la sesión (que salió de Google) alcanza como prueba. Solo con 0 explícito:
    # en NULL (cuentas viejas vinculadas a Google) no se sabe y se pide igual.
    sin_contrasena = user.password_set == 0
    if not sin_contrasena:
        if not body.current_password or not verify_password(body.current_password, user.password_hash):
            raise HTTPException(400, "La contraseña actual no es correcta.")
        if body.new_password == body.current_password:
            raise HTTPException(400, "La contraseña nueva tiene que ser distinta de la actual.")

    # +1 segundo: el corte tiene que quedar por ENCIMA de cualquier token ya
    # emitido, incluidos los de este mismo segundo. El token que devolvemos se
    # emite exactamente en el corte, así que es el único que lo pasa.
    corte = int(time.time()) + 1
    user.password_hash = hash_password(body.new_password)
    user.password_set = 1
    user.tokens_valid_from = corte
    db.commit()
    return {"token": make_token(user.id, iat=corte)}


# ── Verificación de email y "olvidé mi contraseña" ───────────────────────────
# Los links apuntan a la SPA (/?verificar=… y /?reset=…); app.js los levanta y
# llama a estos endpoints. Los mails salen en segundo plano (BackgroundTasks).

_LINK_INVALIDO = "El link no es válido o ya venció. Pedí uno nuevo."
_MSG_OLVIDE = "Si hay una cuenta con ese email, te mandamos un link. Revisá también spam."


def _mandar_verificacion(user: PortalUser, background: BackgroundTasks) -> None:
    link = f"{PUBLIC_URL}/?verificar=" + make_mail_token("verificar", user.id, user.email)
    asunto, texto, html = mailer.mail_verificacion(user.full_name, link)
    background.add_task(mailer.enviar, user.email, asunto, texto, html, link)


def _marcar_verificado(user: PortalUser) -> None:
    """Marca el email como verificado y, si está en CT_ADMIN_EMAILS, lo
    promueve ya (sin esperar al próximo arranque). El commit lo hace quien llama."""
    if not user.email_verified_at:
        user.email_verified_at = ahora_utc()
    if user.email.lower() in admin_emails():
        user.is_admin = 1


def _usuario_del_link(token: str, proposito: str, db: Session) -> PortalUser:
    uid = mail_token_uid(token)
    user = db.get(PortalUser, uid) if uid else None
    ok = user is not None and verify_mail_token(
        token, proposito, user.id, user.email,
        password_hash=user.password_hash if proposito == "reset" else "")
    if not ok:
        raise HTTPException(400, _LINK_INVALIDO)
    return user


@app.post("/api/auth/verify/send", tags=["Corredor"])
def verify_send(request: Request, background: BackgroundTasks,
                user: PortalUser = Depends(current_user)):
    """Reenvía el mail de verificación al usuario logueado."""
    if user.email_verified_at:
        return {"sent": False, "email_verified": True}
    try:
        rate_limit(request, "verify_send", limit=10, window=600.0)
        rate_limit_key(f"verify_send:{user.id}", limit=3, window=600.0)
    except HTTPException as e:
        if e.status_code == 429:
            raise HTTPException(429, "Ya te mandamos el mail hace poco. Esperá unos minutos "
                                     "y revisá también la carpeta de spam.")
        raise
    _mandar_verificacion(user, background)
    return {"sent": True, "email_verified": False}


@app.post("/api/auth/verify", tags=["Corredor"])
def verify_email(body: VerifyIn, request: Request, db: Session = Depends(get_db),
                 authorization: str = Header(None)):
    """Confirma el email con el token del link. Idempotente: abrir el link
    dos veces no falla. Después de verificar corre el autolink.

    El link solo prueba que quien lo abre lee ese buzón, no que haya creado
    la cuenta. Si un intruso registró el email de otro, el dueño del buzón
    podía tocar "verificar" y dejarle la cuenta verificada al intruso (con
    su contraseña y los resultados del dueño). Por eso hace falta además la
    sesión de esa misma cuenta o su contraseña: el dueño legítimo la sabe, la
    víctima de un intruso no, y esa cuenta queda sin verificar."""
    rate_limit(request, "verify", limit=20, window=60.0)
    user = _usuario_del_link(body.token, "verificar", db)
    if not user.email_verified_at:
        sesion_propia = False
        if authorization and authorization.lower().startswith("bearer "):
            try:
                sesion_propia = current_user(authorization, db).id == user.id
            except HTTPException:
                sesion_propia = False
        if not sesion_propia:
            if not body.password:
                raise HTTPException(401, "Para confirmar, ingresá la contraseña de esta cuenta.")
            rate_limit_key(f"verify_pw:{user.id}", limit=5, window=600.0)
            if not verify_password(body.password, user.password_hash):
                raise HTTPException(401, "La contraseña no coincide con la de esta cuenta.")
    _marcar_verificado(user)
    db.commit()
    try:
        linked = _autolink(user, db)
    except Exception:
        db.rollback()
        linked = 0
    return {"email_verified": True, "email": user.email, "linked": linked}


@app.post("/api/auth/password/forgot", tags=["Corredor"])
def forgot_password(body: ForgotIn, request: Request, background: BackgroundTasks,
                    db: Session = Depends(get_db)):
    """Manda el link de reset. SIEMPRE responde lo mismo, exista o no la
    cuenta: si no, este endpoint servía para listar quién tiene cuenta."""
    rate_limit(request, "forgot", limit=10, window=600.0)
    email = body.email.strip().lower()
    try:
        # Por email: frena usar el portal para llenarle el buzón a alguien
        # desde muchas IPs. Se corta en silencio (mismo 200) para no filtrar nada.
        rate_limit_key(f"forgot:{email}", limit=3, window=3600.0)
    except HTTPException:
        return {"message": _MSG_OLVIDE}
    user = db.scalar(select(PortalUser).where(PortalUser.email == email)) if _EMAIL_RE.match(email) else None
    if user:
        link = f"{PUBLIC_URL}/?reset=" + make_mail_token(
            "reset", user.id, user.email, password_hash=user.password_hash)
        asunto, texto, html = mailer.mail_reset(user.full_name, link)
        background.add_task(mailer.enviar, user.email, asunto, texto, html, link)
    return {"message": _MSG_OLVIDE}


@app.post("/api/auth/password/reset", tags=["Corredor"])
def reset_password(body: ResetIn, request: Request, db: Session = Depends(get_db)):
    """Elige contraseña nueva con el link del mail. El link es de un solo uso
    (su firma incluye la contraseña actual), cierra todas las sesiones y marca
    el email verificado: abrir el link prueba que el buzón es suyo. Devuelve
    una sesión nueva, igual que el login."""
    rate_limit(request, "reset", limit=10, window=600.0)
    user = _usuario_del_link(body.token, "reset", db)
    # +1 s, igual que change_password: el token que devolvemos se emite
    # exactamente en el corte y los de este mismo segundo quedan afuera.
    corte = int(time.time()) + 1
    user.password_hash = hash_password(body.new_password)
    user.password_set = 1
    user.tokens_valid_from = corte
    _marcar_verificado(user)
    db.commit()
    try:
        linked = _autolink(user, db)
    except Exception:
        db.rollback()
        linked = 0
    return {"token": make_token(user.id, iat=corte), "email": user.email,
            "full_name": user.full_name, "linked": linked}


@app.post("/api/claim", tags=["Corredor"])
def claim(body: ClaimIn, request: Request, user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    # Mismo bucket que /api/me/claim: frena adivinar apellidos por fuerza bruta.
    rate_limit(request, "claim", limit=30, window=60.0)
    race = db.scalar(select(PublishedRace).where(PublishedRace.code == body.code.upper()))
    if not race:
        raise HTTPException(404, "No existe una carrera con ese código")
    last = body.last_name.strip()
    matches = [
        r for r in race.results
        if r.bib_number == body.bib_number.strip() and _last_name_matches(last, r.full_name)
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


def _participation(dates: list[str]) -> dict:
    """Frecuencia de participación a partir de las fechas de carrera (ISO).
    `streak_months` = meses consecutivos hacia atrás con al menos una carrera;
    el mes en curso suma si ya corriste, pero no rompe la racha si todavía no."""
    if not dates:
        return {"first_race_date": None, "last_race_date": None, "months_active": 0,
                "races_per_month": 0.0, "streak_months": 0}
    ds = sorted(dates)
    first, last = ds[0], ds[-1]
    months = {d[:7] for d in ds}
    fy, fm = int(first[:4]), int(first[5:7])
    today = hoy_ar()
    spanned = max(1, (today.year - fy) * 12 + (today.month - fm) + 1)

    def prev(y, m):
        return (y, m - 1) if m > 1 else (y - 1, 12)

    y, m = today.year, today.month
    streak = 0
    if f"{y:04d}-{m:02d}" in months:
        streak += 1
    y, m = prev(y, m)
    while f"{y:04d}-{m:02d}" in months:
        streak += 1
        y, m = prev(y, m)
    return {"first_race_date": first, "last_race_date": last,
            "months_active": len(months),
            "races_per_month": round(len(ds) / spanned, 2),
            "streak_months": streak}


@app.get("/api/me/results", tags=["Corredor"])
def my_results(user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    claims = db.scalars(select(Claim).where(Claim.user_id == user.id)).all()
    results = [c.result for c in claims]

    # Cuántos corrieron cada (carrera, distancia, categoría): da contexto al
    # puesto ("5º de 41 en M30-34"). Una sola consulta agrupada para todas.
    cat_total: dict[tuple, int] = {}
    dist_total: dict[tuple, int] = {}
    race_ids = {r.race_id for r in results}
    if race_ids:
        for rid, dist, cat, n in db.execute(
            select(PublishedResult.race_id, PublishedResult.distance_km,
                   PublishedResult.category, func.count())
            .where(PublishedResult.race_id.in_(race_ids), PublishedResult.status == "FINISHER")
            .group_by(PublishedResult.race_id, PublishedResult.distance_km, PublishedResult.category)
        ).all():
            cat_total[(rid, dist, cat)] = n
            dist_total[(rid, dist)] = dist_total.get((rid, dist), 0) + n

    items = []
    best_by_dist: dict[float, dict] = {}
    by_distance: dict[str, list] = {}
    total_km = 0.0
    finishes = 0
    for r in results:
        race = r.race
        pace = (r.net_time_ns / 1e9 / r.distance_km) if (r.net_time_ns and r.distance_km) else None
        item = {
            "race_code": race.code, "race_name": race.name,
            "race_date": race.race_date.isoformat() if race.race_date else None,
            "location": race.location,
            "category_total": cat_total.get((r.race_id, r.distance_km, r.category)),
            "distance_finishers": dist_total.get((r.race_id, r.distance_km)),
            "pace_s_per_km": round(pace, 1) if pace else None,
            **_result_dict(r),
        }
        items.append(item)
        if r.status == "FINISHER" and r.distance_km:
            finishes += 1
            total_km += r.distance_km
            if r.net_time_ns:
                cur = best_by_dist.get(r.distance_km)
                if cur is None or r.net_time_ns < cur["net_time_ns"]:
                    best_by_dist[r.distance_km] = {
                        "distance_km": r.distance_km, "net_time_ns": r.net_time_ns,
                        "race_code": race.code, "race_name": race.name,
                        "race_date": item["race_date"],
                    }
                by_distance.setdefault(str(r.distance_km), []).append({
                    "race_date": item["race_date"], "race_name": race.name,
                    "race_code": race.code, "net_time_ns": r.net_time_ns,
                    "pace_s_per_km": item["pace_s_per_km"], "position": r.position,
                    "category_position": r.category_position,
                })

    items.sort(key=lambda x: x["race_date"] or "", reverse=True)
    # La evolución sólo tiene sentido con al menos dos marcas en la misma distancia.
    for serie in by_distance.values():
        serie.sort(key=lambda x: x["race_date"] or "")
    by_distance = {k: v for k, v in by_distance.items() if len(v) >= 2}

    return {
        "full_name": user.full_name,
        "total_races": len({i["race_code"] for i in items}),
        "total_finishes": finishes,
        "total_km": round(total_km, 1),
        "personal_bests": [best_by_dist[k] for k in sorted(best_by_dist)],
        "participation": _participation([i["race_date"] for i in items if i["race_date"]]),
        "by_distance": by_distance,
        "results": items,
    }


# ── Búsqueda (corredor por nombre, o carrera por nombre/código) ───────────────

# Tope de corredores por búsqueda. Si hay más, se avisa con `truncated` para
# que la web pida afinar en vez de mostrar una lista cortada sin decirlo.
SEARCH_LIMIT = 60


def _like_escapado(palabra: str) -> str:
    # Escapar los comodines del usuario: sin esto `q=%` matcheaba TODO y
    # convertia cada busqueda en un scan completo de la tabla. (Con la
    # normalización ya no llegan, pero el escape no cuesta nada.)
    return "%" + palabra.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


@app.get("/api/search", tags=["Público"])
def search(q: str, request: Request, db: Session = Depends(get_db)):
    """Busca corredores por nombre y carreras por nombre o código.

    Ignora acentos, mayúsculas y el orden de las palabras: "perez jose" encuentra
    a "José Pérez". Cada palabra tiene que aparecer (AND), en cualquier parte."""
    # Endpoint publico y caro: LIKE '%...%' sin indice util sobre toda la tabla
    # de resultados, en un unico proceso uvicorn. Sin tope alcanzaba con un
    # bucle de curl para dejar el portal sin CPU.
    rate_limit(request, "search", limit=60, window=60.0)
    norm = normalizar_nombre((q or "").strip())
    palabras = norm.split()
    if len(norm.replace(" ", "")) < 2:
        return {"races": [], "results": [], "truncated": False, "too_short": True}
    compacto = norm.replace(" ", "")

    # Carreras por nombre (todas las palabras) o por código exacto. Son pocas
    # filas: se normaliza en Python, que sí sabe sacar acentos.
    races = []
    for r in db.scalars(select(PublishedRace).order_by(PublishedRace.published_at.desc())):
        nombre = normalizar_nombre(" ".join(filter(None, [r.name, r.location])))
        if (r.code or "").lower() == compacto or all(p in nombre for p in palabras):
            races.append(r)
            if len(races) >= 20:
                break
    race_out = [{
        "code": r.code, "name": r.name, "location": r.location,
        "race_date": r.race_date.isoformat() if r.race_date else None,
        "distances": [float(x) for x in r.distances.split(",")] if r.distances else [],
    } for r in races]

    # Resultados por nombre del corredor: cada palabra en name_norm (AND).
    cond = [PublishedResult.name_norm.like(_like_escapado(p), escape="\\") for p in palabras]
    rows = db.execute(
        select(PublishedResult, PublishedRace)
        .join(PublishedRace, PublishedResult.race_id == PublishedRace.id)
        .where(*cond)
        .order_by(PublishedResult.full_name, PublishedRace.race_date.desc())
        .limit(SEARCH_LIMIT + 1)
    ).all()
    truncated = len(rows) > SEARCH_LIMIT
    results = []
    for res, race in rows[:SEARCH_LIMIT]:
        results.append({
            "result_id": res.id,
            "race_code": race.code, "race_name": race.name,
            "race_date": race.race_date.isoformat() if race.race_date else None,
            "location": race.location,
            **_result_dict(res),
        })
    return {"races": race_out, "results": results, "truncated": truncated,
            "limit": SEARCH_LIMIT, "too_short": False}


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
    prov_last = (body.last_name or "").strip()
    identity_ok = (
        _last_name_matches(prov_last, res.full_name)
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
    return {"linked": linked, "email_verified": bool(user.email_verified_at)}


# ── Despublicar (organizador) ─────────────────────────────────────────────────

@app.delete("/api/publish/{source_id}", tags=["Organizador"])
def unpublish(source_id: str, request: Request, x_api_key: str = Header(None), db: Session = Depends(get_db)):
    """Elimina una carrera publicada (y sus resultados/claims). Idempotente:
    si no existe, no es error. Lo usa la app de escritorio al borrar una carrera."""
    rate_limit(request, "publish", limit=30, window=60.0)
    key_hash = _check_publish_key(x_api_key)
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


# ── API de la app móvil (ChronoTrack Run) ─────────────────────────────────────

from cloud.run import router as run_router  # noqa: E402
from cloud.google_auth import router as google_router  # noqa: E402
from cloud.billing_routes import router as billing_router  # noqa: E402

app.include_router(run_router)
app.include_router(google_router)
app.include_router(billing_router)


# ── Estáticos: avatares y portal (al final para no tapar /api) ────────────────

from cloud.run import avatar_dir  # noqa: E402

app.mount("/avatars", StaticFiles(directory=str(avatar_dir())), name="avatars")

_static = Path(__file__).parent / "static"
if _static.exists():
    app.mount("/", StaticFiles(directory=str(_static), html=True), name="portal")
