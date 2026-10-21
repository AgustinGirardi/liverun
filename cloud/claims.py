"""Vínculo entre cuentas de corredor y resultados publicados."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from cloud.db import get_db
from cloud.deps import current_user, rate_limit
from cloud.models import PortalUser, PublishedRace, PublishedResult, Claim
from cloud.nombres import _name_matches, _last_name_matches
from cloud.run import hoy_ar
from cloud.security import (
    email_hash,
)
from cloud.search import _result_dict

router = APIRouter()


class ClaimIn(BaseModel):
    code: str
    bib_number: str
    last_name: str


class ClaimResultIn(BaseModel):
    result_id: int
    last_name: Optional[str] = None


def _autolink(user: PortalUser, db: Session) -> int:
    """Vincula a `user` todos los PublishedResult cuyo email_hash coincide con su
    email de cuenta. Devuelve cuántos vínculos NUEVOS creó (no duplica).

    Solo con el email verificado: si no, alcanzaba con registrarse con el
    email de otro para llevarse su historial de carreras."""
    if not user.email_verified_at:
        return 0
    h = email_hash(user.email)
    results = db.scalars(select(PublishedResult).where(PublishedResult.email_hash == h)).all()
    claimed_ids = set(db.scalars(select(Claim.result_id).where(Claim.user_id == user.id)).all())
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


@router.post("/api/claim", tags=["Corredor"])
def claim(body: ClaimIn, request: Request, user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    # Mismo bucket que /api/me/claim: frena adivinar apellidos por fuerza bruta.
    rate_limit(request, "claim", limit=30, window=60.0)
    race = db.scalar(select(PublishedRace).where(PublishedRace.code == body.code.upper()))
    if not race:
        raise HTTPException(404, "No existe una carrera con ese código")
    last = body.last_name.strip()
    matches = [
        r for r in race.results if r.bib_number == body.bib_number.strip() and _last_name_matches(last, r.full_name)
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
        return {
            "first_race_date": None,
            "last_race_date": None,
            "months_active": 0,
            "races_per_month": 0.0,
            "streak_months": 0,
        }
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
    return {
        "first_race_date": first,
        "last_race_date": last,
        "months_active": len(months),
        "races_per_month": round(len(ds) / spanned, 2),
        "streak_months": streak,
    }


@router.get("/api/me/results", tags=["Corredor"])
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
            select(PublishedResult.race_id, PublishedResult.distance_km, PublishedResult.category, func.count())
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
            "race_code": race.code,
            "race_name": race.name,
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
                        "distance_km": r.distance_km,
                        "net_time_ns": r.net_time_ns,
                        "race_code": race.code,
                        "race_name": race.name,
                        "race_date": item["race_date"],
                    }
                by_distance.setdefault(str(r.distance_km), []).append(
                    {
                        "race_date": item["race_date"],
                        "race_name": race.name,
                        "race_code": race.code,
                        "net_time_ns": r.net_time_ns,
                        "pace_s_per_km": item["pace_s_per_km"],
                        "position": r.position,
                        "category_position": r.category_position,
                    }
                )

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


@router.post("/api/me/claim", tags=["Corredor"])
def claim_result(
    body: ClaimResultIn, request: Request, user: PortalUser = Depends(current_user), db: Session = Depends(get_db)
):
    """Guarda un resultado puntual en el perfil del corredor (por id de resultado).

    Verifica identidad: el resultado debe coincidir con el nombre del usuario
    (o con el apellido provisto). Evita que alguien adjunte a su perfil el
    resultado de otra persona sólo conociendo su result_id (que es público)."""
    rate_limit(request, "claim", limit=30, window=60.0)
    res = db.get(PublishedResult, body.result_id)
    if not res:
        raise HTTPException(404, "Resultado no encontrado")
    prov_last = (body.last_name or "").strip()
    identity_ok = _last_name_matches(prov_last, res.full_name) or (
        user.full_name and _name_matches(user.full_name, res.full_name)
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


@router.post("/api/me/autolink", tags=["Corredor"])
def autolink_me(request: Request, user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    """Re-ejecuta la auto-vinculación por email para el usuario logueado.
    Lo usa el botón 'Buscar mis resultados por email' del perfil."""
    rate_limit(request, "claim", limit=30, window=60.0)
    linked = _autolink(user, db)
    return {"linked": linked, "email_verified": bool(user.email_verified_at)}
