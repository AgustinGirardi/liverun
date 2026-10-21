"""Lectura pública: carreras, eventos y búsqueda por nombre."""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from cloud.db import get_db
from cloud.deps import rate_limit
from cloud.models import PublishedRace, PublishedResult
from cloud.nombres import normalizar_nombre
from cloud.run import hoy_ar

router = APIRouter()


def _result_dict(r: PublishedResult) -> dict:
    return {
        "bib_number": r.bib_number,
        "full_name": r.full_name,
        "category": r.category,
        "club": r.club,
        "distance_km": r.distance_km,
        "net_time_ns": r.net_time_ns,
        "finish_time_ns": r.finish_time_ns,
        "position": r.position,
        "category_position": r.category_position,
        "status": r.status,
    }


def _event_dict(r: PublishedRace) -> dict:
    return {
        "code": r.code,
        "name": r.name,
        "location": r.location,
        "race_date": r.race_date.isoformat() if r.race_date else None,
        "distances": [float(x) for x in r.distances.split(",")] if r.distances else [],
        "capacity": r.capacity,
        "registered_count": r.registered_count,
        "registration_url": r.registration_url,
    }


@router.get("/api/events", tags=["Público"])
def list_events(db: Session = Depends(get_db)):
    """Calendario: eventos anunciados que todavía no se corrieron, del más
    próximo al más lejano. Las fechas ya pasadas no se muestran aunque el
    organizador no haya subido los resultados todavía."""
    races = db.scalars(
        select(PublishedRace)
        .where(
            PublishedRace.event_status == "upcoming",
            PublishedRace.race_date.is_(None) | (PublishedRace.race_date >= hoy_ar()),
        )
        .order_by(PublishedRace.race_date.asc())
    ).all()
    return [_event_dict(r) for r in races]


# ── Lectura pública ──────────────────────────────────────────────────────────


@router.get("/api/races", tags=["Público"])
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
    conteos = dict(
        db.execute(
            select(PublishedResult.race_id, func.count())
            .where(PublishedResult.status == "FINISHER")
            .group_by(PublishedResult.race_id)
        ).all()
    )
    out = []
    for race in races:
        finishers = conteos.get(race.id, 0)
        out.append(
            {
                "code": race.code,
                "name": race.name,
                "location": race.location,
                "race_date": race.race_date.isoformat() if race.race_date else None,
                "distances": [float(x) for x in race.distances.split(",")] if race.distances else [],
                "finishers": finishers,
            }
        )
    return out


@router.get("/api/races/{code}", tags=["Público"])
def race_detail(code: str, db: Session = Depends(get_db)):
    race = db.scalar(select(PublishedRace).where(PublishedRace.code == code.upper()))
    if not race:
        raise HTTPException(404, "Carrera no encontrada")
    results = db.scalars(
        select(PublishedResult)
        .where(PublishedResult.race_id == race.id)
        # Dentro de cada distancia: primero los FINISHER por posición, luego DNF/DNS/DQ.
        # (Si no, los position=NULL de SQLite quedarían antes del 1° puesto.)
        .order_by(
            PublishedResult.distance_km,
            (PublishedResult.status != "FINISHER"),
            PublishedResult.position,
        )
    ).all()
    return {
        "code": race.code,
        "name": race.name,
        "location": race.location,
        "race_date": race.race_date.isoformat() if race.race_date else None,
        "distances": [float(x) for x in race.distances.split(",")] if race.distances else [],
        # result_id: para "guardar en mi perfil" desde la tabla de la carrera
        # (ya era público: la búsqueda lo devuelve).
        "results": [{"result_id": r.id, **_result_dict(r)} for r in results],
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


@router.get("/api/search", tags=["Público"])
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
    race_out = [
        {
            "code": r.code,
            "name": r.name,
            "location": r.location,
            "race_date": r.race_date.isoformat() if r.race_date else None,
            "distances": [float(x) for x in r.distances.split(",")] if r.distances else [],
        }
        for r in races
    ]

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
        results.append(
            {
                "result_id": res.id,
                "race_code": race.code,
                "race_name": race.name,
                "race_date": race.race_date.isoformat() if race.race_date else None,
                "location": race.location,
                **_result_dict(res),
            }
        )
    return {"races": race_out, "results": results, "truncated": truncated, "limit": SEARCH_LIMIT, "too_short": False}
