from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, Query, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete as sa_delete
from sqlalchemy.orm import selectinload
from typing import Optional
import hashlib
import json
import os
import sqlite3
import shutil
import tempfile
import anyio
from datetime import datetime
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from backend.core.database import get_db, AsyncSessionLocal, engine as db_engine, DB_PATH
from backend.core import cloud_config
from backend.services import email_service
from backend.core.schemas import (
    RunnerCreate, RunnerUpdate, RunnerOut,
    RaceCreate, RaceUpdate, RaceOut,
    RegistrationCreate, RegistrationOut, RegistrationStatusUpdate,
    AssignBibRequest, AssignBibResponse,
    BibLookupResponse, CaptureOut,
    RaceResults, ResultRow, DNFRow,
    WSEvent, WSEventType,
    ImportResult, BulkDeleteRequest,
)
from backend.models.models import (
    Runner, Race, Registration, TimestampCapture,
    Split, CaptureStatus, Gender, RegistrationStatus, RaceStatus,
)
from backend.services.timing_engine import get_engine, manager, reset_engines

router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _runner_out(r: Runner) -> RunnerOut:
    return RunnerOut(
        id=r.id, first_name=r.first_name, last_name=r.last_name,
        full_name=f"{r.first_name} {r.last_name}",
        email=r.email,
        dni=r.dni,
        birth_date=r.birth_date,
        gender=r.gender.value if r.gender else None,
        category=r.category, club=r.club, created_at=r.created_at,
    )

def _reg_out(reg: Registration) -> RegistrationOut:
    return RegistrationOut(
        id=reg.id, runner_id=reg.runner_id, race_id=reg.race_id,
        bib_number=reg.bib_number, distance_km=reg.distance_km,
        status=reg.status.value if reg.status else "OK",
        runner=_runner_out(reg.runner),
        registered_at=reg.registered_at,
    )


# ── Runners ───────────────────────────────────────────────────────────────────

@router.get("/runners", response_model=list[RunnerOut], tags=["Runners"])
async def list_runners(db: AsyncSession = Depends(get_db), search: Optional[str] = Query(None)):
    stmt = select(Runner).order_by(Runner.last_name, Runner.first_name)
    if search:
        stmt = stmt.where(
            (Runner.first_name.ilike(f"%{search}%")) |
            (Runner.last_name.ilike(f"%{search}%")) |
            (Runner.dni.ilike(f"%{search}%"))
        )
    return [_runner_out(r) for r in (await db.execute(stmt)).scalars().all()]

@router.post("/runners", response_model=RunnerOut, status_code=201, tags=["Runners"])
async def create_runner(body: RunnerCreate, db: AsyncSession = Depends(get_db)):
    runner = Runner(**body.model_dump())
    db.add(runner)
    await db.commit()
    await db.refresh(runner)
    return _runner_out(runner)

@router.patch("/runners/{runner_id}", response_model=RunnerOut, tags=["Runners"])
async def update_runner(runner_id: int, body: RunnerUpdate, db: AsyncSession = Depends(get_db)):
    runner = await db.get(Runner, runner_id)
    if not runner:
        raise HTTPException(404, "Runner not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(runner, k, v)
    await db.commit()
    await db.refresh(runner)
    return _runner_out(runner)

@router.delete("/runners/{runner_id}", status_code=204, tags=["Runners"])
async def delete_runner(runner_id: int, db: AsyncSession = Depends(get_db)):
    runner = await db.get(Runner, runner_id)
    if not runner:
        raise HTTPException(404, "Runner not found")
    reg_count = (await db.execute(
        select(func.count()).where(Registration.runner_id == runner_id)
    )).scalar_one()
    if reg_count:
        raise HTTPException(
            409,
            f"El atleta tiene {reg_count} inscripción(es) en carreras. "
            "Eliminá primero sus inscripciones (o eliminá la carrera) y volvé a intentar.",
        )
    await db.delete(runner)
    await db.commit()


# ── Races ─────────────────────────────────────────────────────────────────────

@router.get("/races", response_model=list[RaceOut], tags=["Races"])
async def list_races(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Race).order_by(Race.race_date.desc()))
    return result.scalars().all()

@router.get("/races/{race_id}", response_model=RaceOut, tags=["Races"])
async def get_race(race_id: int, db: AsyncSession = Depends(get_db)):
    race = await db.get(Race, race_id)
    if not race:
        raise HTTPException(404, "Race not found")
    return race

@router.post("/races", response_model=RaceOut, status_code=201, tags=["Races"])
async def create_race(body: RaceCreate, db: AsyncSession = Depends(get_db)):
    race = Race(**body.model_dump())
    db.add(race)
    await db.commit()
    await db.refresh(race)
    return race

@router.patch("/races/{race_id}", response_model=RaceOut, tags=["Races"])
async def update_race(race_id: int, body: RaceUpdate, db: AsyncSession = Depends(get_db)):
    race = await db.get(Race, race_id)
    if not race:
        raise HTTPException(404, "Race not found")
    if body.status and body.status.value == "ACTIVE":
        other = (await db.execute(
            select(Race).where(Race.status == RaceStatus.ACTIVE, Race.id != race_id)
        )).scalar_one_or_none()
        if other:
            raise HTTPException(400, f'Ya hay una carrera activa: "{other.name}". Finalizala antes de activar otra.')
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(race, k, v)
    await db.commit()
    await db.refresh(race)
    return race

@router.post("/races/{race_id}/duplicate", response_model=RaceOut, status_code=201, tags=["Races"])
async def duplicate_race(race_id: int, db: AsyncSession = Depends(get_db)):
    """Crea una nueva carrera (plantilla) a partir de una existente: copia nombre,
    lugar e inscriptos reutilizando los mismos atletas. Resetea fecha, estado,
    largada, tiempos y deja todos los inscriptos en estado OK."""
    src = await db.get(Race, race_id)
    if not src:
        raise HTTPException(404, "Race not found")

    new_race = Race(
        name=f"{src.name} (copia)",
        location=src.location,
        race_date=None,
        status=RaceStatus.PLANNED,
    )
    db.add(new_race)
    await db.flush()  # necesario para obtener new_race.id

    regs = (await db.execute(
        select(Registration).where(Registration.race_id == race_id)
    )).scalars().all()
    for r in regs:
        db.add(Registration(
            runner_id=r.runner_id,
            race_id=new_race.id,
            bib_number=r.bib_number,
            distance_km=r.distance_km,
            status=RegistrationStatus.OK,
        ))

    await db.commit()
    await db.refresh(new_race)
    return new_race


async def _cloud_unpublish(race_id: int) -> None:
    """Best-effort: despublica la carrera del portal si hay nube configurada.
    Cualquier error (offline, nunca publicada) se ignora: el borrado local manda."""
    cfg = cloud_config.load_config()
    if not cfg.get("api_key"):
        return
    url = cfg["url"].rstrip("/") + f"/api/publish/ct-race-{race_id}"

    def _del():
        req = urllib.request.Request(url, method="DELETE", headers={"X-API-Key": cfg["api_key"]})
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status

    try:
        await anyio.to_thread.run_sync(_del)
    except Exception:
        pass


@router.delete("/races/{race_id}", status_code=204, tags=["Races"])
async def delete_race(race_id: int, db: AsyncSession = Depends(get_db)):
    race = await db.get(Race, race_id)
    if not race:
        raise HTTPException(404, "Race not found")
    # Eliminar en orden respetando FK: splits → registrations → captures → race
    reg_ids = select(Registration.id).where(Registration.race_id == race_id)
    await db.execute(sa_delete(Split).where(Split.registration_id.in_(reg_ids)))
    await db.execute(sa_delete(Registration).where(Registration.race_id == race_id))
    await db.execute(sa_delete(TimestampCapture).where(TimestampCapture.race_id == race_id))
    await db.delete(race)
    await db.commit()
    # Si estaba publicada en el portal, despublicarla también.
    await _cloud_unpublish(race_id)


# ── Registrations ─────────────────────────────────────────────────────────────

@router.get("/races/{race_id}/registrations", response_model=list[RegistrationOut], tags=["Registrations"])
async def list_registrations(race_id: int, db: AsyncSession = Depends(get_db)):
    stmt = (
        select(Registration)
        .where(Registration.race_id == race_id)
        .options(selectinload(Registration.runner))
        .order_by(Registration.bib_number)
    )
    return [_reg_out(r) for r in (await db.execute(stmt)).scalars().all()]

@router.post("/races/{race_id}/registrations", response_model=RegistrationOut, status_code=201, tags=["Registrations"])
async def create_registration(race_id: int, body: RegistrationCreate, db: AsyncSession = Depends(get_db)):
    race = await db.get(Race, race_id)
    if not race:
        raise HTTPException(404, "Race not found")
    if race.status == RaceStatus.FINISHED:
        raise HTTPException(409, "La carrera está finalizada. No se pueden agregar inscripciones.")
    existing = (await db.execute(
        select(Registration).where(Registration.race_id == race_id, Registration.bib_number == body.bib_number)
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(409, f"Dorsal {body.bib_number} ya está registrado en esta carrera")
    data = body.model_dump()
    data.pop("race_id", None)
    reg = Registration(race_id=race_id, **data)
    db.add(reg)
    await db.commit()
    reg = (await db.execute(
        select(Registration).where(Registration.id == reg.id).options(selectinload(Registration.runner))
    )).scalar_one()
    return _reg_out(reg)

@router.patch("/races/{race_id}/registrations/{reg_id}/status", response_model=RegistrationOut, tags=["Registrations"])
async def update_registration_status(race_id: int, reg_id: int, body: RegistrationStatusUpdate, db: AsyncSession = Depends(get_db)):
    race = await db.get(Race, race_id)
    if race and race.status == RaceStatus.FINISHED:
        raise HTTPException(409, "La carrera está finalizada. No se pueden modificar inscripciones.")
    stmt = (
        select(Registration)
        .where(Registration.id == reg_id, Registration.race_id == race_id)
        .options(selectinload(Registration.runner))
    )
    reg = (await db.execute(stmt)).scalar_one_or_none()
    if not reg:
        raise HTTPException(404, "Registration not found")
    reg.status = RegistrationStatus(body.status.value)
    await db.commit()
    await db.refresh(reg)
    return _reg_out(reg)

@router.delete("/races/{race_id}/registrations/{reg_id}", status_code=204, tags=["Registrations"])
async def delete_registration(race_id: int, reg_id: int, db: AsyncSession = Depends(get_db)):
    race = await db.get(Race, race_id)
    if race and race.status == RaceStatus.FINISHED:
        raise HTTPException(409, "La carrera está finalizada. No se pueden eliminar inscripciones.")
    reg = await db.get(Registration, reg_id)
    if not reg or reg.race_id != race_id:
        raise HTTPException(404, "Registration not found")
    await db.execute(sa_delete(Split).where(Split.registration_id == reg_id))
    await db.delete(reg)
    await db.commit()

@router.post("/races/{race_id}/registrations/bulk-delete", status_code=204, tags=["Registrations"])
async def bulk_delete_registrations(race_id: int, body: BulkDeleteRequest, db: AsyncSession = Depends(get_db)):
    valid = (await db.execute(
        select(Registration.id).where(
            Registration.id.in_(body.ids),
            Registration.race_id == race_id,
        )
    )).scalars().all()
    if not valid:
        raise HTTPException(404, "No se encontraron inscripciones válidas")
    await db.execute(sa_delete(Split).where(Split.registration_id.in_(valid)))
    await db.execute(sa_delete(Registration).where(Registration.id.in_(valid)))
    await db.commit()

@router.post("/races/{race_id}/import", response_model=ImportResult, tags=["Registrations"])
async def import_runners(race_id: int, file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    _race = await db.get(Race, race_id)
    if not _race:
        raise HTTPException(404, "Race not found")
    if _race.status == RaceStatus.FINISHED:
        raise HTTPException(409, "La carrera está finalizada. No se pueden importar inscripciones.")

    content = await file.read()
    rows: list[dict] = []
    errors: list[str] = []

    fname = (file.filename or "").lower()
    if fname.endswith(".xlsx") or fname.endswith(".xls"):
        import openpyxl, io as _io
        wb = openpyxl.load_workbook(_io.BytesIO(content), read_only=True, data_only=True)
        ws = wb.active
        headers = None
        for row in ws.iter_rows(values_only=True):
            if headers is None:
                headers = [str(h).strip().lower() if h is not None else "" for h in row]
                continue
            rows.append(dict(zip(headers, [str(v).strip() if v is not None else "" for v in row])))
    else:
        import csv, io as _io
        text = content.decode("utf-8-sig", errors="replace")
        reader = csv.DictReader(_io.StringIO(text))
        rows = [{k.strip().lower(): (v or "").strip() for k, v in r.items()} for r in reader]

    def col(row, *keys):
        for k in keys:
            v = row.get(k, "").strip()
            if v and v.lower() not in ("none", "null"):
                return v
        return None

    created = skipped = 0
    seen_bibs: set[str] = set()
    for i, row in enumerate(rows, 1):
        bib   = col(row, "dorsal", "bib", "bib_number", "numero", "nro")
        first = col(row, "nombre", "first_name", "name")
        last  = col(row, "apellido", "last_name", "surname")

        if not bib or not first or not last:
            errors.append(f"Fila {i}: faltan campos obligatorios (dorsal, nombre, apellido)")
            continue

        # Dorsal duplicado dentro del mismo archivo: como no hacemos flush por fila,
        # la consulta a la BD no detecta filas previas de este mismo import.
        if bib in seen_bibs:
            errors.append(f"Fila {i}: dorsal {bib} duplicado dentro del archivo")
            continue

        if (await db.execute(
            select(Registration).where(Registration.race_id == race_id, Registration.bib_number == bib)
        )).scalar_one_or_none():
            skipped += 1
            continue

        seen_bibs.add(bib)

        category      = col(row, "categoria", "category", "cat")
        club          = col(row, "club", "equipo", "team")
        email         = col(row, "email", "correo", "mail", "e-mail")
        dni           = col(row, "dni", "documento", "cedula")
        gender_raw    = col(row, "genero", "gender", "sexo")
        distance_raw  = col(row, "distancia", "distance", "distance_km", "km", "dist")
        try:
            distance_km = float(distance_raw) if distance_raw else None
        except ValueError:
            distance_km = None

        gender_enum = None
        if gender_raw:
            g = gender_raw.upper()[0]
            gender_enum = Gender.M if g in ("M", "H") else Gender.F if g == "F" else None

        # Reutilizar corredor existente por nombre o DNI
        existing_runner = None
        if dni:
            existing_runner = (await db.execute(
                select(Runner).where(func.lower(Runner.dni) == dni.lower())
            )).scalar_one_or_none()
        if not existing_runner:
            existing_runner = (await db.execute(
                select(Runner).where(
                    func.lower(Runner.first_name) == first.lower(),
                    func.lower(Runner.last_name)  == last.lower(),
                )
            )).scalar_one_or_none()

        if existing_runner:
            runner = existing_runner
            if gender_enum and not runner.gender:   runner.gender   = gender_enum
            if category    and not runner.category: runner.category = category
            if club        and not runner.club:     runner.club     = club
            if dni         and not runner.dni:      runner.dni      = dni
            if email       and not runner.email:    runner.email    = email
        else:
            runner = Runner(first_name=first, last_name=last, category=category, club=club, gender=gender_enum, dni=dni, email=email)
            db.add(runner)
            await db.flush()

        db.add(Registration(runner_id=runner.id, race_id=race_id, bib_number=bib, distance_km=distance_km))
        created += 1

    await db.commit()
    return ImportResult(created=created, skipped=skipped, errors=errors)


# ── Timing ────────────────────────────────────────────────────────────────────

@router.post("/races/{race_id}/start", tags=["Timing"])
async def start_race(race_id: int, db: AsyncSession = Depends(get_db)):
    import time as _time
    race  = await db.get(Race, race_id)
    if not race:
        raise HTTPException(404, "Race not found")
    if race.status == RaceStatus.FINISHED:
        raise HTTPException(409, "La carrera está finalizada.")
    if race.race_start_ns:
        raise HTTPException(400, "La carrera ya tiene una largada registrada")
    other = (await db.execute(
        select(Race).where(Race.status == RaceStatus.ACTIVE, Race.id != race_id)
    )).scalar_one_or_none()
    if other:
        raise HTTPException(400, f'Ya hay una carrera activa: "{other.name}". Finalizala antes de iniciar otra.')
    race.race_start_ns = _time.time_ns()
    race.status = RaceStatus.ACTIVE
    await db.commit()
    await manager.broadcast(WSEvent(
        event=WSEventType.CAPTURE,
        data={"type": "START", "race_start_ns": race.race_start_ns},
    ))
    return {"race_start_ns": race.race_start_ns, "message": "Largada registrada"}

@router.post("/races/{race_id}/capture", response_model=CaptureOut, tags=["Timing"])
async def manual_capture(race_id: int, db: AsyncSession = Depends(get_db)):
    return await get_engine(race_id).capture(db)

@router.post("/races/{race_id}/captures/{capture_id}/assign", response_model=AssignBibResponse, tags=["Timing"])
async def assign_bib(race_id: int, capture_id: int, body: AssignBibRequest, db: AsyncSession = Depends(get_db)):
    try:
        return await get_engine(race_id).assign_bib(db, capture_id, body.bib_number)
    except ValueError as e:
        raise HTTPException(400, str(e))

@router.post("/races/{race_id}/captures/{capture_id}/undo", tags=["Timing"])
async def undo_assign(race_id: int, capture_id: int, db: AsyncSession = Depends(get_db)):
    try:
        return await get_engine(race_id).undo_assign(db, capture_id)
    except ValueError as e:
        raise HTTPException(400, str(e))

@router.delete("/races/{race_id}/captures/{capture_id}", status_code=204, tags=["Timing"])
async def discard_capture(race_id: int, capture_id: int, db: AsyncSession = Depends(get_db)):
    try:
        await get_engine(race_id).discard_capture(db, capture_id)
    except ValueError as e:
        raise HTTPException(400, str(e))

@router.get("/races/{race_id}/captures", response_model=list[CaptureOut], tags=["Timing"])
async def list_captures(race_id: int, status: Optional[str] = Query(None), db: AsyncSession = Depends(get_db)):
    stmt = (
        select(TimestampCapture)
        .where(TimestampCapture.race_id == race_id)
        .order_by(TimestampCapture.sequence_order.desc())
    )
    if status:
        stmt = stmt.where(TimestampCapture.status == status)
    return (await db.execute(stmt)).scalars().all()

@router.get("/races/{race_id}/bib-lookup", response_model=BibLookupResponse, tags=["Timing"])
async def bib_lookup(race_id: int, bib: str = Query(...), db: AsyncSession = Depends(get_db)):
    return await get_engine(race_id).bib_lookup(db, bib)


# ── Results ───────────────────────────────────────────────────────────────────

@router.get("/races/{race_id}/results", response_model=RaceResults, tags=["Results"])
async def get_results(race_id: int, db: AsyncSession = Depends(get_db)):
    race = await db.get(Race, race_id)
    if not race:
        raise HTTPException(404, "Race not found")

    # Finishers: capturas ASSIGNED con inscripción OK
    stmt = (
        select(Split, TimestampCapture, Registration, Runner)
        .join(TimestampCapture, Split.timestamp_id == TimestampCapture.id)
        .join(Registration, Split.registration_id == Registration.id)
        .join(Runner, Registration.runner_id == Runner.id)
        .where(
            TimestampCapture.race_id == race_id,
            TimestampCapture.status  == CaptureStatus.ASSIGNED,
            Registration.status      == RegistrationStatus.OK,
        )
        .order_by(TimestampCapture.captured_ns)
    )
    rows = (await db.execute(stmt)).all()

    # DNS / DNF / DQ
    dnf_rows = (await db.execute(
        select(Registration, Runner)
        .join(Runner, Registration.runner_id == Runner.id)
        .where(
            Registration.race_id == race_id,
            Registration.status  != RegistrationStatus.OK,
        )
        .order_by(Registration.bib_number)
    )).all()

    total_registered = (await db.execute(
        select(func.count()).where(Registration.race_id == race_id)
    )).scalar_one()

    # Group finishers by distance and assign per-group positions
    from collections import defaultdict
    by_dist: dict[float, list] = defaultdict(list)
    for split, capture, registration, runner in rows:
        dist_key = registration.distance_km if registration.distance_km is not None else (race.distance_km or 0.0)
        by_dist[dist_key].append((split, capture, registration, runner))

    results: list[ResultRow] = []
    for dist_key in sorted(by_dist.keys()):
        for pos_i, (split, capture, registration, runner) in enumerate(by_dist[dist_key]):
            results.append(ResultRow(
                position=pos_i + 1,
                bib_number=registration.bib_number,
                runner=_runner_out(runner),
                finish_time_ns=capture.captured_ns,
                net_time_ns=(capture.captured_ns - race.race_start_ns) if race.race_start_ns else None,
                category=runner.category,
                club=runner.club,
                distance_km=dist_key if dist_key != 0.0 else None,
            ))

    dnf_list = [
        DNFRow(
            bib_number=reg.bib_number,
            runner=_runner_out(runner),
            status=reg.status.value,
            category=runner.category,
            club=runner.club,
            distance_km=reg.distance_km,
        )
        for reg, runner in dnf_rows
    ]

    distances = [k for k in sorted(by_dist.keys()) if k != 0.0]

    return RaceResults(
        race=RaceOut(
            id=race.id, name=race.name, location=race.location,
            race_date=race.race_date, distance_km=race.distance_km,
            status=race.status.value, race_start_ns=race.race_start_ns,
            created_at=race.created_at,
        ),
        total_finishers=len(results),
        total_registered=total_registered,
        results=results,
        dnf_list=dnf_list,
        distances=distances,
    )

@router.get("/races/{race_id}/export/csv", tags=["Results"])
async def export_csv(race_id: int, db: AsyncSession = Depends(get_db)):
    from fastapi.responses import StreamingResponse
    import io, csv

    data = await get_results(race_id, db)

    def fmt(ns):
        if not ns: return ""
        ms = ns // 1_000_000
        h, r = divmod(ms, 3_600_000)
        m, r = divmod(r, 60_000)
        s, f = divmod(r, 1_000)
        return f"{h:02d}:{m:02d}:{s:02d}.{f:03d}"

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Pos", "Distancia", "Dorsal", "Nombre", "DNI", "Categoria", "Club", "Tiempo Neto", "Tiempo Bruto"])
    for row in data.results:
        dist_label = f"{row.distance_km} km" if row.distance_km else ""
        writer.writerow([
            row.position, dist_label, row.bib_number, row.runner.full_name, row.runner.dni or "",
            row.category or "", row.club or "", fmt(row.net_time_ns), fmt(row.finish_time_ns),
        ])
    if data.dnf_list:
        writer.writerow([])
        writer.writerow(["-- DNS / DNF / DQ --"])
        for row in data.dnf_list:
            dist_label = f"{row.distance_km} km" if row.distance_km else ""
            # Mismas columnas que el encabezado; el estado va en la columna "Pos".
            writer.writerow([
                row.status, dist_label, row.bib_number, row.runner.full_name, row.runner.dni or "",
                row.category or "", row.club or "", "", "",
            ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=resultados_{race_id}.csv"},
    )


# ── Backup / Restore ──────────────────────────────────────────────────────────

@router.get("/backup", tags=["Backup"])
async def backup_db():
    """Descarga un respaldo completo de la base de datos en un único archivo .ctbackup.
    Usa la API de backup de SQLite para obtener una copia consistente aun con WAL activo."""
    if not DB_PATH.exists():
        raise HTTPException(404, "Todavía no hay datos para respaldar")

    fd, tmp_path = tempfile.mkstemp(suffix=".ctbackup")
    os.close(fd)

    def _do_backup():
        src = sqlite3.connect(str(DB_PATH))
        dst = sqlite3.connect(tmp_path)
        try:
            with dst:
                src.backup(dst)
        finally:
            dst.close()
            src.close()

    await anyio.to_thread.run_sync(_do_backup)

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"chronotrack_backup_{stamp}.ctbackup"
    return FileResponse(
        tmp_path,
        filename=filename,
        media_type="application/octet-stream",
        background=BackgroundTask(os.remove, tmp_path),
    )


@router.post("/restore", tags=["Backup"])
async def restore_db(file: UploadFile = File(...)):
    """Restaura la base de datos desde un archivo .ctbackup.
    Valida que sea un respaldo de ChronoTrack, guarda una copia del estado actual
    (.pre-restore) y reemplaza la base. Requiere reiniciar la app para tomar efecto."""
    content = await file.read()
    if not content.startswith(b"SQLite format 3"):
        raise HTTPException(400, "El archivo no es un respaldo válido de ChronoTrack")

    fd, tmp_path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    with open(tmp_path, "wb") as f:
        f.write(content)

    def _validate():
        con = sqlite3.connect(tmp_path)
        try:
            return {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        finally:
            con.close()

    try:
        tables = await anyio.to_thread.run_sync(_validate)
    except sqlite3.DatabaseError:
        os.remove(tmp_path)
        raise HTTPException(400, "El archivo está dañado o no es una base de datos válida")

    if not {"races", "runners", "registrations"}.issubset(tables):
        os.remove(tmp_path)
        raise HTTPException(400, "El respaldo no contiene datos de ChronoTrack")

    # Cerrar conexiones abiertas y limpiar estado en memoria antes de reemplazar el archivo.
    await db_engine.dispose()
    reset_engines()

    def _swap():
        base = str(DB_PATH)
        if DB_PATH.exists():
            shutil.copy2(base, base + ".pre-restore")
        for ext in ("-wal", "-shm"):
            p = base + ext
            if os.path.exists(p):
                os.remove(p)
        shutil.move(tmp_path, base)

    await anyio.to_thread.run_sync(_swap)
    return {"message": "Respaldo restaurado correctamente. Reiniciá ChronoTrack para ver los datos."}


# ── Cloud (portal público) ────────────────────────────────────────────────────

from pydantic import BaseModel as _BaseModel
import urllib.request
import urllib.error


class CloudConfigIn(_BaseModel):
    url: Optional[str] = None
    api_key: Optional[str] = None


@router.get("/cloud/config", tags=["Cloud"])
async def get_cloud_config():
    """Devuelve la URL del portal y una versión enmascarada de la API key.
    La API key real nunca sale del backend."""
    cfg = cloud_config.load_config()
    return {
        "url": cfg["url"],
        "api_key_masked": cloud_config.mask_key(cfg["api_key"]),
        "configured": bool(cfg["api_key"]),
    }


@router.put("/cloud/config", tags=["Cloud"])
async def set_cloud_config(body: CloudConfigIn):
    """Guarda la URL del portal y/o la API key de publicación (persistidas en disco)."""
    cfg = cloud_config.save_config(url=body.url, api_key=body.api_key)
    return {
        "url": cfg["url"],
        "api_key_masked": cloud_config.mask_key(cfg["api_key"]),
        "configured": bool(cfg["api_key"]),
    }


def _email_hash(email):
    """sha256 del email normalizado (privacy-preserving). DEBE coincidir byte a byte
    con cloud/main.py::_email_hash — si cambia uno, cambiar el otro."""
    e = (email or "").strip().lower()
    if not e:
        return None
    return hashlib.sha256(("chronotrack-v1:" + e).encode()).hexdigest()


@router.post("/races/{race_id}/publish", tags=["Cloud"])
async def publish_race(race_id: int, db: AsyncSession = Depends(get_db)):
    """Publica los resultados de una carrera en el portal público (server-to-server).

    Privacidad (Ley 25.326): el snapshot NO incluye DNI ni fecha de nacimiento.
    Sólo viajan nombre completo, categoría, club, dorsal, distancia y tiempos.
    La API key se toma de la config local y nunca pasa por el navegador.
    """
    cfg = cloud_config.load_config()
    if not cfg["api_key"]:
        raise HTTPException(400, "Falta configurar la API key del portal (Configuración → Nube).")

    data = await get_results(race_id, db)
    race = data.race

    def _clean_name(n: str) -> str:
        return " ".join((n or "").split())  # colapsa espacios dobles / extremos

    results = []
    for row in data.results:
        results.append({
            "bib_number": row.bib_number,
            "full_name": _clean_name(row.runner.full_name),
            "category": row.category,
            "club": row.club,
            "distance_km": row.distance_km,
            "net_time_ns": row.net_time_ns,
            "finish_time_ns": row.finish_time_ns,
            "position": row.position,
            "status": "FINISHER",
            "email_hash": _email_hash(row.runner.email),
        })
    for row in data.dnf_list:
        results.append({
            "bib_number": row.bib_number,
            "full_name": _clean_name(row.runner.full_name),
            "category": row.category,
            "club": row.club,
            "distance_km": row.distance_km,
            "net_time_ns": None,
            "finish_time_ns": None,
            "position": None,
            "status": row.status,
            "email_hash": _email_hash(row.runner.email),
        })

    payload = {
        "source_id": f"ct-race-{race.id}",
        "name": race.name,
        "location": race.location,
        "race_date": race.race_date.isoformat() if race.race_date else None,
        "distances": data.distances,
        "results": results,
    }

    url = cfg["url"].rstrip("/") + "/api/publish"
    body = json.dumps(payload).encode("utf-8")

    def _post():
        req = urllib.request.Request(
            url, data=body, method="POST",
            headers={"Content-Type": "application/json", "X-API-Key": cfg["api_key"]},
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read().decode("utf-8")

    try:
        status, text = await anyio.to_thread.run_sync(_post)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        if e.code == 403:
            raise HTTPException(502, "El portal rechazó la API key. Revisá la configuración de la nube.")
        raise HTTPException(502, f"El portal respondió con error {e.code}: {detail}")
    except urllib.error.URLError as e:
        raise HTTPException(502, f"No se pudo conectar al portal: {e.reason}. Verificá la URL y tu conexión.")

    try:
        cloud_resp = json.loads(text)
    except Exception:
        cloud_resp = {"raw": text}

    return {
        "message": "Resultados publicados correctamente",
        "code": cloud_resp.get("code"),
        "published_results": cloud_resp.get("published_results", len(results)),
        "portal_url": cfg["url"].rstrip("/"),
    }


# ── Email (envío de resultados) ───────────────────────────────────────────────

class EmailConfigIn(_BaseModel):
    provider: Optional[str] = None
    api_key: Optional[str] = None
    from_email: Optional[str] = None
    from_name: Optional[str] = None


class EmailTestIn(_BaseModel):
    to: str


@router.get("/email/config", tags=["Email"])
async def get_email_config():
    cfg = email_service.load_config()
    return {
        "provider": cfg["provider"],
        "from_email": cfg["from_email"],
        "from_name": cfg["from_name"],
        "api_key_masked": email_service.mask_key(cfg["api_key"]),
        "configured": email_service.is_configured(cfg),
    }


@router.put("/email/config", tags=["Email"])
async def set_email_config(body: EmailConfigIn):
    cfg = email_service.save_config(
        provider=body.provider, api_key=body.api_key,
        from_email=body.from_email, from_name=body.from_name,
    )
    return {
        "provider": cfg["provider"],
        "from_email": cfg["from_email"],
        "from_name": cfg["from_name"],
        "api_key_masked": email_service.mask_key(cfg["api_key"]),
        "configured": email_service.is_configured(cfg),
    }


@router.post("/email/test", tags=["Email"])
async def send_test_email(body: EmailTestIn):
    cfg = email_service.load_config()
    if not email_service.is_configured(cfg):
        raise HTTPException(400, "Configurá primero el proveedor de email (API key y remitente).")
    html = (
        '<div style="font-family:Arial,sans-serif;color:#13202b">'
        '<h2>✅ ChronoTrack — email de prueba</h2>'
        '<p>Si recibís este mensaje, el envío de emails está configurado correctamente.</p></div>'
    )
    ok, err = await anyio.to_thread.run_sync(
        lambda: email_service.send_email(body.to, "Prueba", "ChronoTrack — prueba de envío", html, cfg)
    )
    if not ok:
        raise HTTPException(502, f"No se pudo enviar: {err}")
    return {"sent": True}


@router.post("/races/{race_id}/send-results", tags=["Email"])
async def send_results_email(race_id: int, db: AsyncSession = Depends(get_db)):
    """Envía a cada finisher con email cargado su resultado (tiempo, puesto y link al portal)."""
    cfg = email_service.load_config()
    if not email_service.is_configured(cfg):
        raise HTTPException(400, "Configurá primero el proveedor de email (Configuración → Email).")

    data = await get_results(race_id, db)
    race = data.race
    portal_url = cloud_config.load_config().get("url") or None
    race_date = race.race_date.isoformat() if race.race_date else None

    sent = 0
    no_email = 0
    failed: list[str] = []

    for row in data.results:  # finishers
        to = (row.runner.email or "").strip()
        name = row.runner.full_name
        if not to:
            no_email += 1
            continue
        html = email_service.build_result_email(
            runner_name=name, race_name=race.name, race_date=race_date,
            location=race.location, distance_km=row.distance_km,
            net_time_ns=row.net_time_ns, finish_time_ns=row.finish_time_ns,
            position=row.position, category=row.category,
            portal_url=portal_url, race_code=None,
        )
        subject = f"Tu resultado en {race.name}"
        ok, err = await anyio.to_thread.run_sync(
            lambda t=to, n=name, h=html, s=subject: email_service.send_email(t, n, s, h, cfg)
        )
        if ok:
            sent += 1
        else:
            failed.append(f"{name} <{to}>: {err}")

    return {
        "sent": sent,
        "no_email": no_email,
        "failed": len(failed),
        "failed_detail": failed[:20],
        "total_finishers": len(data.results),
    }


# ── WebSocket ─────────────────────────────────────────────────────────────────

@router.websocket("/ws/races/{race_id}/timing")
async def timing_websocket(race_id: int, ws: WebSocket):
    await manager.connect(ws)
    engine = get_engine(race_id)
    try:
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)
            action = msg.get("action")

            # Una sesión fresca por mensaje: evita estado compartido/obsoleto entre
            # operaciones y que un commit fallido deje la sesión inutilizable para
            # el resto de la conexión.
            async with AsyncSessionLocal() as db:
                try:
                    if action == "capture":
                        await engine.capture(db, device=msg.get("device", "operator-1"))

                    elif action == "assign":
                        await engine.assign_bib(
                            db,
                            capture_id=msg["capture_id"],
                            bib_number=msg["bib"],
                        )

                    elif action == "undo_assign":
                        await engine.undo_assign(db, capture_id=msg["capture_id"])

                    elif action == "discard":
                        await engine.discard_capture(db, capture_id=msg["capture_id"])

                except ValueError as e:
                    await db.rollback()
                    await ws.send_text(WSEvent(event=WSEventType.ERROR, data={"message": str(e)}).model_dump_json())
                except Exception:
                    await db.rollback()
                    raise

    except WebSocketDisconnect:
        manager.disconnect(ws)
