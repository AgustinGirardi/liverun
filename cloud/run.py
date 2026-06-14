"""ChronoTrack Run — API de la app móvil (/api/run/...).

Cuenta unificada con el portal: el mismo PortalUser que reclama resultados
registra acá sus salidas. Auth con los endpoints existentes /api/auth/*.
"""
import json
import os
import re
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from cloud.db import DB_URL, get_db
from cloud.deps import current_user, rate_limit
from cloud.models import Activity, Coupon, CouponRedemption, Friendship, PortalUser

router = APIRouter(prefix="/api/run", tags=["Run"])

USERNAME_RE = re.compile(r"^[a-z0-9_.]{3,30}$")

PUBLIC_URL = os.environ.get("CT_PUBLIC_URL", "https://chronotrack-portal.onrender.com").rstrip("/")

# Avatares: archivos chicos en el mismo disco persistente que la DB.
AVATAR_MAX_BYTES = 2 * 1024 * 1024
AVATAR_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


def avatar_dir() -> Path:
    """Carpeta de avatares junto a la base SQLite (en Render: /var/data/avatars)."""
    if DB_URL.startswith("sqlite:///"):
        base = Path(DB_URL.removeprefix("sqlite:///")).parent
    else:
        base = Path(".")
    d = base / "avatars"
    d.mkdir(parents=True, exist_ok=True)
    return d


# ── Lógica pura (testeable sin DB) ────────────────────────────────────────────

def week_start(d: date) -> date:
    """Lunes de la semana de `d` (semana lunes–domingo)."""
    return d - timedelta(days=d.weekday())


TRIAL_DAYS = 182  # ~6 meses de prueba gratis desde el alta


def access_status(is_admin: bool, created_at: Optional[datetime],
                  premium_until: Optional[datetime], now: datetime) -> dict:
    """Fuente de verdad del acceso premium, sin importar cómo se pagó.
    admin = ilimitado; si no, vale el premium pagado o la prueba gratis."""
    if is_admin:
        return {"access": True, "plan": "admin", "since": None, "until": None, "trial_ends_at": None}
    trial_end = (created_at + timedelta(days=TRIAL_DAYS)) if created_at else None
    if premium_until and premium_until > now:
        return {"access": True, "plan": "premium", "until": premium_until.isoformat(),
                "trial_ends_at": trial_end.isoformat() if trial_end else None}
    if trial_end and trial_end > now:
        return {"access": True, "plan": "trial", "until": trial_end.isoformat(),
                "trial_ends_at": trial_end.isoformat()}
    return {"access": False, "plan": "expired", "until": None,
            "trial_ends_at": trial_end.isoformat() if trial_end else None}


def user_has_access(user: PortalUser, now: Optional[datetime] = None) -> bool:
    """True si el usuario puede usar funciones premium (admin, premium pagado o
    prueba vigente). Lo usan los gates premium del servidor."""
    n = now or datetime.now(timezone.utc).replace(tzinfo=None)
    return access_status(bool(user.is_admin), user.created_at, user.premium_until, n)["access"]


def compute_streak(run_dates: set[date], weekly_goal: int, today: date) -> int:
    """Racha = semanas consecutivas (hacia atrás desde la última semana cerrada)
    en las que los días con al menos una salida alcanzaron la meta.
    La semana en curso suma si ya cumplió, pero nunca rompe la racha."""
    goal = max(1, weekly_goal)
    cur = week_start(today)
    streak = 0
    if len({d for d in run_dates if cur <= d <= today}) >= goal:
        streak += 1
    w = cur - timedelta(days=7)
    while len({d for d in run_dates if w <= d < w + timedelta(days=7)}) >= goal:
        streak += 1
        w -= timedelta(days=7)
    return streak


def _as_naive_utc(dt: datetime) -> datetime:
    """Normaliza datetimes con tz a UTC naive (la DB guarda naive)."""
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


# ── Schemas ───────────────────────────────────────────────────────────────────

class ProfileUpdate(BaseModel):
    username: Optional[str] = None
    weekly_goal: Optional[int] = Field(None, ge=1, le=7)
    full_name: Optional[str] = Field(None, max_length=200)


class ActivityIn(BaseModel):
    client_uuid: str = Field(..., min_length=1, max_length=64)
    started_at: datetime
    duration_s: int = Field(..., ge=1)
    distance_m: float = Field(..., ge=0)
    avg_pace_s_per_km: Optional[float] = Field(None, gt=0)
    splits: list[float] = []
    polyline: Optional[str] = Field(None, max_length=100_000)


class FriendRequestIn(BaseModel):
    username: str


class FriendAcceptIn(BaseModel):
    friendship_id: int


# ── Helpers ───────────────────────────────────────────────────────────────────

def _activity_dict(a: Activity, full: bool = False) -> dict:
    out = {
        "id": a.id,
        "client_uuid": a.client_uuid,
        "started_at": a.started_at.isoformat(),
        "duration_s": a.duration_s,
        "distance_m": a.distance_m,
        "avg_pace_s_per_km": a.avg_pace_s_per_km,
    }
    if full:
        out["splits"] = json.loads(a.splits) if a.splits else []
        out["polyline"] = a.polyline
    return out


def _user_public(u: PortalUser) -> dict:
    return {"username": u.username, "full_name": u.full_name, "avatar_url": u.avatar_url}


def _friend_ids(user_id: int, db: Session) -> set[int]:
    rows = db.scalars(
        select(Friendship).where(
            ((Friendship.requester_id == user_id) | (Friendship.addressee_id == user_id))
            & (Friendship.status == "accepted")
        )
    ).all()
    return {f.addressee_id if f.requester_id == user_id else f.requester_id for f in rows}


# ── Perfil ────────────────────────────────────────────────────────────────────

@router.get("/profile")
def get_profile(user: PortalUser = Depends(current_user)):
    acc = access_status(bool(user.is_admin), user.created_at, user.premium_until,
                        datetime.now(timezone.utc).replace(tzinfo=None))
    return {
        "email": user.email,
        "full_name": user.full_name,
        "username": user.username,
        "weekly_goal": user.weekly_goal or 3,
        "avatar_url": user.avatar_url,
        "is_admin": bool(user.is_admin),
        "access": acc["access"],
        "plan": acc["plan"],
        "premium_until": user.premium_until.isoformat() if user.premium_until else None,
        "trial_ends_at": acc["trial_ends_at"],
    }


# ── Admin (solo cuentas marcadas is_admin) ────────────────────────────────────

def require_admin(user: PortalUser = Depends(current_user)) -> PortalUser:
    if not user.is_admin:
        raise HTTPException(403, "Acceso solo para administradores")
    return user


class GrantIn(BaseModel):
    months: Optional[int] = Field(None, ge=1, le=120)
    unlimited: bool = False
    revoke: bool = False


def _admin_user_dict(u: PortalUser, now: datetime) -> dict:
    acc = access_status(bool(u.is_admin), u.created_at, u.premium_until, now)
    return {
        "id": u.id, "email": u.email, "full_name": u.full_name, "username": u.username,
        "is_admin": bool(u.is_admin), "plan": acc["plan"], "access": acc["access"],
        "premium_until": u.premium_until.isoformat() if u.premium_until else None,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    }


@router.get("/admin/users")
def admin_list_users(q: str = "", limit: int = 50,
                     admin: PortalUser = Depends(require_admin), db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    stmt = select(PortalUser).order_by(PortalUser.created_at.desc())
    ql = (q or "").strip().lower()
    if ql:
        like = f"%{ql}%"
        stmt = stmt.where(
            func.lower(PortalUser.email).like(like)
            | func.lower(PortalUser.full_name).like(like)
            | func.lower(PortalUser.username).like(like)
        )
    users = db.scalars(stmt.limit(max(1, min(limit, 200)))).all()
    total = db.scalar(select(func.count()).select_from(PortalUser))
    premium = db.scalar(select(func.count()).select_from(PortalUser).where(PortalUser.premium_until > now))
    return {"total": total, "premium_active": premium, "users": [_admin_user_dict(u, now) for u in users]}


@router.post("/admin/users/{user_id}/grant")
def admin_grant(user_id: int, body: GrantIn,
                admin: PortalUser = Depends(require_admin), db: Session = Depends(get_db)):
    """Da, extiende o quita premium manualmente (sin cobro). Para regalos,
    soporte o tu propia cuenta. unlimited = 100 años; revoke = sin premium."""
    target = db.get(PortalUser, user_id)
    if not target:
        raise HTTPException(404, "Usuario no encontrado")
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if body.revoke:
        target.premium_until = None
    elif body.unlimited:
        target.premium_until = now + timedelta(days=365 * 100)
    elif body.months:
        # Extiende desde hoy o desde el vencimiento futuro (lo que sea mayor).
        base = target.premium_until if (target.premium_until and target.premium_until > now) else now
        target.premium_until = base + timedelta(days=30 * body.months)
    else:
        raise HTTPException(400, "Indicá months, unlimited o revoke")
    db.commit()
    return _admin_user_dict(target, now)


# ── Cupones ───────────────────────────────────────────────────────────────────

COUPON_RE = re.compile(r"^[A-Z0-9]{4,32}$")


def coupon_redeemable(coupon: Optional[Coupon], already: bool, now: datetime) -> Optional[str]:
    """Devuelve un mensaje de error si el cupón no se puede canjear, o None si sí.
    Pura: no toca la DB (recibe el cupón y si el usuario ya lo canjeó)."""
    if coupon is None:
        return "Ese código no existe."
    if not coupon.active:
        return "Ese cupón ya no está activo."
    if coupon.expires_at and coupon.expires_at < now:
        return "Ese cupón venció."
    if coupon.max_redemptions is not None and coupon.redeemed_count >= coupon.max_redemptions:
        return "Ese cupón ya alcanzó el máximo de usos."
    if already:
        return "Ya usaste este cupón."
    return None


class CouponCreate(BaseModel):
    code: str = Field(..., min_length=4, max_length=32)
    kind: str  # free_months | discount
    months: Optional[int] = Field(None, ge=1, le=120)
    percent_off: Optional[int] = Field(None, ge=1, le=100)
    max_redemptions: Optional[int] = Field(None, ge=1)
    expires_at: Optional[datetime] = None


class RedeemIn(BaseModel):
    code: str


def _coupon_dict(c: Coupon) -> dict:
    return {
        "id": c.id, "code": c.code, "kind": c.kind, "months": c.months,
        "percent_off": c.percent_off, "max_redemptions": c.max_redemptions,
        "redeemed_count": c.redeemed_count, "active": bool(c.active),
        "expires_at": c.expires_at.isoformat() if c.expires_at else None,
    }


@router.post("/admin/coupons")
def admin_create_coupon(body: CouponCreate,
                        admin: PortalUser = Depends(require_admin), db: Session = Depends(get_db)):
    code = body.code.strip().upper()
    if not COUPON_RE.match(code):
        raise HTTPException(400, "El código debe tener 4-32 caracteres (letras y números)")
    if body.kind not in ("free_months", "discount"):
        raise HTTPException(400, "kind debe ser 'free_months' o 'discount'")
    if body.kind == "free_months" and not body.months:
        raise HTTPException(400, "Indicá months para un cupón de meses gratis")
    if body.kind == "discount" and not body.percent_off:
        raise HTTPException(400, "Indicá percent_off para un cupón de descuento")
    if db.scalar(select(Coupon).where(Coupon.code == code)):
        raise HTTPException(409, "Ya existe un cupón con ese código")
    c = Coupon(
        code=code, kind=body.kind,
        months=body.months if body.kind == "free_months" else None,
        percent_off=body.percent_off if body.kind == "discount" else None,
        max_redemptions=body.max_redemptions, expires_at=body.expires_at,
    )
    db.add(c)
    db.commit()
    return _coupon_dict(c)


@router.get("/admin/coupons")
def admin_list_coupons(admin: PortalUser = Depends(require_admin), db: Session = Depends(get_db)):
    coupons = db.scalars(select(Coupon).order_by(Coupon.created_at.desc())).all()
    return {"coupons": [_coupon_dict(c) for c in coupons]}


@router.post("/admin/coupons/{coupon_id}/toggle")
def admin_toggle_coupon(coupon_id: int,
                        admin: PortalUser = Depends(require_admin), db: Session = Depends(get_db)):
    c = db.get(Coupon, coupon_id)
    if not c:
        raise HTTPException(404, "Cupón no encontrado")
    c.active = 0 if c.active else 1
    db.commit()
    return _coupon_dict(c)


@router.post("/coupons/redeem")
def redeem_coupon(body: RedeemIn, request: Request,
                  user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    """Canjea un cupón. free_months suma premium al instante; discount deja el
    descuento pendiente para el próximo pago."""
    rate_limit(request, "redeem", limit=20, window=60.0)
    code = (body.code or "").strip().upper()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    c = db.scalar(select(Coupon).where(Coupon.code == code))
    already = bool(c and db.scalar(
        select(CouponRedemption).where(CouponRedemption.coupon_id == c.id,
                                       CouponRedemption.user_id == user.id)
    ))
    err = coupon_redeemable(c, already, now)
    if err:
        raise HTTPException(400, err)

    db.add(CouponRedemption(coupon_id=c.id, user_id=user.id))
    c.redeemed_count = (c.redeemed_count or 0) + 1
    if c.kind == "free_months":
        base = user.premium_until if (user.premium_until and user.premium_until > now) else now
        user.premium_until = base + timedelta(days=30 * c.months)
        msg = f"¡Listo! Sumaste {c.months} {'mes' if c.months == 1 else 'meses'} de premium."
        result = {"kind": "free_months", "months": c.months,
                  "premium_until": user.premium_until.isoformat()}
    else:
        user.pending_discount_percent = c.percent_off
        msg = f"¡Listo! Tenés {c.percent_off}% de descuento para tu próxima suscripción."
        result = {"kind": "discount", "percent_off": c.percent_off}
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "Ya usaste este cupón.")
    return {"message": msg, **result}


@router.patch("/profile")
def update_profile(body: ProfileUpdate, user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    if body.username is not None:
        username = body.username.strip().lower()
        if not USERNAME_RE.match(username):
            raise HTTPException(400, "Username inválido: 3-30 caracteres, solo letras, números, punto y guión bajo")
        other = db.scalar(select(PortalUser).where(PortalUser.username == username, PortalUser.id != user.id))
        if other:
            raise HTTPException(409, "Ese username ya está en uso")
        user.username = username
    if body.weekly_goal is not None:
        user.weekly_goal = body.weekly_goal
    if body.full_name is not None:
        user.full_name = body.full_name.strip() or None
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Ese username ya está en uso")
    return get_profile(user)


@router.post("/profile/avatar")
def upload_avatar(request: Request, file: UploadFile = File(...),
                  user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    """Sube la foto de perfil (la app la achica antes de mandarla). Reemplaza
    la default de Google; queda servida en /avatars/<id>.<ext>."""
    rate_limit(request, "run_avatar", limit=10, window=60.0)
    ext = AVATAR_TYPES.get((file.content_type or "").lower())
    if not ext:
        raise HTTPException(400, "Formato no soportado: mandá JPG, PNG o WebP")
    data = file.file.read(AVATAR_MAX_BYTES + 1)
    if len(data) > AVATAR_MAX_BYTES:
        raise HTTPException(413, "La imagen es muy pesada (máximo 2 MB)")
    if not data:
        raise HTTPException(400, "Archivo vacío")
    d = avatar_dir()
    # Un solo archivo por usuario: borrar variantes con otra extensión.
    for old in d.glob(f"{user.id}.*"):
        old.unlink(missing_ok=True)
    (d / f"{user.id}.{ext}").write_bytes(data)
    # ?v= rompe el caché de la app cuando se cambia la foto.
    user.avatar_url = f"{PUBLIC_URL}/avatars/{user.id}.{ext}?v={int(time.time())}"
    db.commit()
    return get_profile(user)


# ── Actividades ───────────────────────────────────────────────────────────────

@router.post("/activities")
def create_activity(body: ActivityIn, request: Request,
                    user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    rate_limit(request, "run_activity", limit=60, window=60.0)
    existing = db.scalar(select(Activity).where(
        Activity.user_id == user.id, Activity.client_uuid == body.client_uuid
    ))
    if existing:
        # Reintento de la cola de sincronización: idempotente, no duplica.
        return {"duplicated": True, **_activity_dict(existing)}

    pace = body.avg_pace_s_per_km
    if pace is None and body.distance_m > 0:
        pace = body.duration_s / (body.distance_m / 1000.0)

    act = Activity(
        user_id=user.id,
        client_uuid=body.client_uuid,
        started_at=_as_naive_utc(body.started_at),
        duration_s=body.duration_s,
        distance_m=body.distance_m,
        avg_pace_s_per_km=pace,
        splits=json.dumps(body.splits) if body.splits else None,
        polyline=body.polyline,
    )
    db.add(act)
    try:
        db.commit()
    except IntegrityError:
        # Dos reintentos simultáneos: el segundo pierde contra el unique y devuelve el primero.
        db.rollback()
        existing = db.scalar(select(Activity).where(
            Activity.user_id == user.id, Activity.client_uuid == body.client_uuid
        ))
        return {"duplicated": True, **_activity_dict(existing)}
    return {"duplicated": False, **_activity_dict(act)}


@router.get("/activities")
def list_activities(limit: int = 30, offset: int = 0,
                    user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    limit = max(1, min(limit, 100))
    acts = db.scalars(
        select(Activity).where(Activity.user_id == user.id)
        .order_by(Activity.started_at.desc()).limit(limit).offset(max(0, offset))
    ).all()
    return [_activity_dict(a) for a in acts]


@router.get("/activities/{activity_id}")
def activity_detail(activity_id: int,
                    user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    act = db.get(Activity, activity_id)
    if not act or act.user_id != user.id:
        raise HTTPException(404, "Actividad no encontrada")
    return _activity_dict(act, full=True)


@router.delete("/activities/{activity_id}")
def delete_activity(activity_id: int,
                    user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    """Elimina una salida propia (sale del historial, la racha y los rankings)."""
    act = db.get(Activity, activity_id)
    if not act or act.user_id != user.id:
        raise HTTPException(404, "Actividad no encontrada")
    db.delete(act)
    db.commit()
    return {"deleted": True, "id": activity_id}


# ── Resumen (pestaña Inicio): racha + semana + mes ────────────────────────────

@router.get("/summary")
def summary(user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    acts = db.scalars(select(Activity).where(Activity.user_id == user.id)).all()
    today = date.today()
    goal = user.weekly_goal or 3
    dates = {a.started_at.date() for a in acts}

    wk = week_start(today)
    week_acts = [a for a in acts if wk <= a.started_at.date() <= today]
    month_acts = [a for a in acts if a.started_at.date().replace(day=1) == today.replace(day=1)]

    return {
        "streak_weeks": compute_streak(dates, goal, today),
        "week": {
            "days_run": len({a.started_at.date() for a in week_acts}),
            "goal": goal,
            "km": round(sum(a.distance_m for a in week_acts) / 1000.0, 2),
        },
        "month": {
            "km": round(sum(a.distance_m for a in month_acts) / 1000.0, 2),
            "activities": len(month_acts),
            "days_run": len({a.started_at.date() for a in month_acts}),
            "run_dates": sorted(d.isoformat() for d in {a.started_at.date() for a in month_acts}),
        },
    }


# ── Amigos ────────────────────────────────────────────────────────────────────

@router.get("/friends/search")
def search_friends(q: str, request: Request,
                   user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    rate_limit(request, "run_search", limit=30, window=60.0)
    q = (q or "").strip().lower()
    if len(q) < 3:
        return []
    users = db.scalars(
        select(PortalUser).where(
            PortalUser.username.is_not(None),
            PortalUser.username.like(f"%{q}%"),
            PortalUser.id != user.id,
        ).limit(20)
    ).all()
    friends = _friend_ids(user.id, db)
    pending = db.scalars(select(Friendship).where(
        ((Friendship.requester_id == user.id) | (Friendship.addressee_id == user.id))
        & (Friendship.status == "pending")
    )).all()
    pending_ids = {f.addressee_id for f in pending} | {f.requester_id for f in pending}
    out = []
    for u in users:
        relation = "friend" if u.id in friends else ("pending" if u.id in pending_ids else "none")
        out.append({**_user_public(u), "relation": relation})
    return out


@router.post("/friends/request")
def request_friend(body: FriendRequestIn, request: Request,
                   user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    rate_limit(request, "run_friend", limit=30, window=60.0)
    if not user.username:
        raise HTTPException(400, "Primero elegí tu username en el perfil")
    target = db.scalar(select(PortalUser).where(PortalUser.username == body.username.strip().lower()))
    if not target:
        raise HTTPException(404, "No existe un corredor con ese username")
    if target.id == user.id:
        raise HTTPException(400, "No podés agregarte a vos mismo")

    existing = db.scalar(select(Friendship).where(
        ((Friendship.requester_id == user.id) & (Friendship.addressee_id == target.id))
        | ((Friendship.requester_id == target.id) & (Friendship.addressee_id == user.id))
    ))
    if existing:
        if existing.status == "accepted":
            raise HTTPException(409, "Ya son amigos")
        if existing.requester_id == user.id:
            raise HTTPException(409, "Ya le enviaste una solicitud")
        # El otro ya me había pedido: pedirle de vuelta equivale a aceptar.
        existing.status = "accepted"
        existing.accepted_at = _as_naive_utc(datetime.now(timezone.utc))
        db.commit()
        return {"status": "accepted", "friend": _user_public(target)}

    db.add(Friendship(requester_id=user.id, addressee_id=target.id, status="pending"))
    db.commit()
    return {"status": "pending", "friend": _user_public(target)}


@router.post("/friends/accept")
def accept_friend(body: FriendAcceptIn,
                  user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    fr = db.get(Friendship, body.friendship_id)
    if not fr or fr.addressee_id != user.id or fr.status != "pending":
        raise HTTPException(404, "Solicitud no encontrada")
    fr.status = "accepted"
    fr.accepted_at = _as_naive_utc(datetime.now(timezone.utc))
    db.commit()
    requester = db.get(PortalUser, fr.requester_id)
    return {"status": "accepted", "friend": _user_public(requester)}


@router.get("/friends")
def list_friends(user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Friendship).where(
        (Friendship.requester_id == user.id) | (Friendship.addressee_id == user.id)
    )).all()
    friends, incoming, outgoing = [], [], []
    for f in rows:
        other = db.get(PortalUser, f.addressee_id if f.requester_id == user.id else f.requester_id)
        if f.status == "accepted":
            friends.append(_user_public(other))
        elif f.addressee_id == user.id:
            incoming.append({"friendship_id": f.id, **_user_public(other)})
        else:
            outgoing.append({"friendship_id": f.id, **_user_public(other)})
    return {"friends": friends, "incoming": incoming, "outgoing": outgoing}


# ── Ranking entre amigos ──────────────────────────────────────────────────────

GLOBAL_TOP = 50


@router.get("/ranking")
def ranking(period: str = "week", scope: str = "friends",
            user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    """Km y días corridos en la semana o el mes calendario en curso.
    scope=friends: el usuario y sus amigos aceptados.
    scope=global: top 50 de todos los corredores (el usuario aparece igual,
    con su posición real, aunque no esté en el top)."""
    if period not in ("week", "month"):
        raise HTTPException(400, "period debe ser 'week' o 'month'")
    if scope not in ("friends", "global"):
        raise HTTPException(400, "scope debe ser 'friends' o 'global'")
    # El ranking de amigos es gratis; el mundial (premios) es premium.
    if scope == "global" and not user_has_access(user):
        raise HTTPException(402, "El ranking mundial es premium. Pasate a premium para competir por premios.")
    today = date.today()
    since = week_start(today) if period == "week" else today.replace(day=1)
    since_dt = datetime(since.year, since.month, since.day)

    def entry(u: PortalUser, km: float, days: int, count: int, position: Optional[int] = None) -> dict:
        return {
            **_user_public(u),
            "is_me": u.id == user.id,
            "km": round(km, 2),
            "days_run": days,
            "activities": count,
            "position": position,
        }

    if scope == "global":
        rows = db.execute(
            select(
                Activity.user_id,
                func.sum(Activity.distance_m),
                func.count(func.distinct(func.date(Activity.started_at))),
                func.count(),
            )
            .where(Activity.started_at >= since_dt)
            .group_by(Activity.user_id)
            .order_by(func.sum(Activity.distance_m).desc())
        ).all()
        entries = []
        me_position = None
        for pos, (uid, dist_m, days, count) in enumerate(rows, start=1):
            if uid == user.id:
                me_position = pos
            if pos <= GLOBAL_TOP:
                entries.append(entry(db.get(PortalUser, uid), (dist_m or 0) / 1000.0, days, count, pos))
        if me_position is None:
            # Sin actividades en el período: igual aparece, último y en cero.
            entries.append(entry(user, 0.0, 0, 0, None))
        elif me_position > GLOBAL_TOP:
            uid, dist_m, days, count = rows[me_position - 1]
            entries.append(entry(user, (dist_m or 0) / 1000.0, days, count, me_position))
        return {"period": period, "scope": scope, "since": since.isoformat(), "entries": entries}

    ids = _friend_ids(user.id, db) | {user.id}
    acts = db.scalars(select(Activity).where(
        Activity.user_id.in_(ids),
        Activity.started_at >= since_dt,
    )).all()

    by_user: dict[int, list[Activity]] = {}
    for a in acts:
        by_user.setdefault(a.user_id, []).append(a)

    entries = []
    for uid in ids:
        u = db.get(PortalUser, uid)
        user_acts = by_user.get(uid, [])
        entries.append(entry(
            u,
            sum(a.distance_m for a in user_acts) / 1000.0,
            len({a.started_at.date() for a in user_acts}),
            len(user_acts),
        ))
    entries.sort(key=lambda e: e["km"], reverse=True)
    for pos, e in enumerate(entries, start=1):
        e["position"] = pos
    return {"period": period, "scope": scope, "since": since.isoformat(), "entries": entries}
