import time
import asyncio
from typing import Optional
from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

from backend.models.models import (
    TimestampCapture, Split, Registration, Runner,
    Race, CaptureStatus, RegistrationStatus,
)
from backend.core.schemas import (
    WSEvent, WSEventType,
    AssignBibResponse, BibLookupResponse, RunnerOut,
)


class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, event: WSEvent):
        payload = event.model_dump_json()
        dead = []
        for ws in self.active:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()


class TimingEngine:
    def __init__(self, race_id: int):
        self.race_id = race_id
        self._sequence = 0
        self._seq_initialized = False
        self._lock = asyncio.Lock()

    @staticmethod
    def _runner_out(runner: Runner) -> RunnerOut:
        return RunnerOut(
            id=runner.id,
            first_name=runner.first_name,
            last_name=runner.last_name,
            full_name=f"{runner.first_name} {runner.last_name}",
            dni=runner.dni,
            birth_date=runner.birth_date,
            gender=runner.gender.value if runner.gender else None,
            category=runner.category,
            club=runner.club,
            created_at=runner.created_at,
        )

    # ── Captura ───────────────────────────────────────────────────────────────

    async def capture(self, db: AsyncSession, device: str = "operator-1") -> TimestampCapture:
        # El instante real del cruce de meta se toma antes de cualquier espera.
        captured_ns = time.time_ns()
        # El candado serializa la asignación de sequence_order para que dos
        # capturas concurrentes no reciban el mismo número.
        async with self._lock:
            # Inicialización perezosa desde la BD: si el proceso se reinicia a
            # mitad de carrera, el contador retoma desde el último valor real
            # en lugar de volver a 0 (evita sequence_order duplicados).
            if not self._seq_initialized:
                max_seq = (await db.execute(
                    select(func.max(TimestampCapture.sequence_order))
                    .where(TimestampCapture.race_id == self.race_id)
                )).scalar()
                self._sequence = max_seq or 0
                self._seq_initialized = True
            self._sequence += 1
            capture = TimestampCapture(
                race_id=self.race_id,
                captured_ns=captured_ns,
                sequence_order=self._sequence,
                capture_device=device,
                status=CaptureStatus.PENDING,
            )
            db.add(capture)
            await db.commit()
            await db.refresh(capture)
        await manager.broadcast(WSEvent(
            event=WSEventType.CAPTURE,
            data={
                "id": capture.id,
                "race_id": capture.race_id,
                "captured_ns": capture.captured_ns,
                "sequence_order": capture.sequence_order,
                "capture_device": capture.capture_device,
                "status": capture.status.value,
            },
        ))
        return capture

    # ── Asignar dorsal ────────────────────────────────────────────────────────

    async def assign_bib(
        self,
        db: AsyncSession,
        capture_id: int,
        bib_number: str,
        checkpoint_id: Optional[int] = None,   # reservado para uso futuro
        operator: str = "operator-1",
    ) -> AssignBibResponse:
        capture = await db.get(TimestampCapture, capture_id)
        if not capture:
            raise ValueError(f"Captura {capture_id} no encontrada")
        if capture.status != CaptureStatus.PENDING:
            raise ValueError(f"Captura {capture_id} ya fue procesada (estado: {capture.status.value})")

        stmt = (
            select(Registration)
            .where(Registration.race_id == self.race_id, Registration.bib_number == bib_number.strip())
            .options(selectinload(Registration.runner))
        )
        registration = (await db.execute(stmt)).scalar_one_or_none()
        if not registration:
            raise ValueError(f"Dorsal '{bib_number}' no está inscripto en esta carrera")

        # Evitar asignar el mismo dorsal a dos capturas distintas: si ya tiene un
        # tiempo asignado (ya cruzó meta), rechazar para no invalidar el resultado.
        already = (await db.execute(
            select(Split)
            .join(TimestampCapture, Split.timestamp_id == TimestampCapture.id)
            .where(
                Split.registration_id == registration.id,
                TimestampCapture.status == CaptureStatus.ASSIGNED,
            )
        )).scalar_one_or_none()
        if already:
            raise ValueError(f"El dorsal '{bib_number}' ya tiene un tiempo asignado")

        split = Split(
            timestamp_id=capture.id,
            registration_id=registration.id,
            checkpoint_id=None,
            assigned_by=operator,
        )
        capture.status = CaptureStatus.ASSIGNED
        db.add(split)
        await db.commit()
        await db.refresh(split)

        race = await db.get(Race, self.race_id)
        net_time_ns = (capture.captured_ns - race.race_start_ns) if race and race.race_start_ns else None

        # Posición: cuántos ASSIGNED antes que éste
        pos_count = (await db.execute(
            select(func.count())
            .select_from(Split)
            .join(TimestampCapture, Split.timestamp_id == TimestampCapture.id)
            .join(Registration, Split.registration_id == Registration.id)
            .where(
                TimestampCapture.race_id == self.race_id,
                TimestampCapture.status == CaptureStatus.ASSIGNED,
                TimestampCapture.captured_ns < capture.captured_ns,
                Registration.status == RegistrationStatus.OK,
                Registration.distance_km == registration.distance_km,
            )
        )).scalar_one()
        position = pos_count + 1

        response = AssignBibResponse(
            split_id=split.id,
            capture_id=capture.id,
            capture_ns=capture.captured_ns,
            bib_number=bib_number.strip(),
            runner=self._runner_out(registration.runner),
            checkpoint_name="Meta",
            net_time_ns=net_time_ns,
            position=position,
        )
        await manager.broadcast(WSEvent(event=WSEventType.ASSIGNED, data=response.model_dump(mode="json")))
        return response

    # ── Deshacer asignación ───────────────────────────────────────────────────

    async def undo_assign(self, db: AsyncSession, capture_id: int) -> dict:
        capture = await db.get(TimestampCapture, capture_id)
        if not capture:
            raise ValueError(f"Captura {capture_id} no encontrada")
        if capture.status != CaptureStatus.ASSIGNED:
            raise ValueError("Solo se pueden deshacer capturas ya asignadas")

        split_stmt = (
            select(Split)
            .where(Split.timestamp_id == capture_id)
            .options(selectinload(Split.registration).selectinload(Registration.runner))
        )
        split = (await db.execute(split_stmt)).scalar_one_or_none()

        prev_bib = None
        prev_runner = None
        if split:
            prev_bib = split.registration.bib_number
            prev_runner = self._runner_out(split.registration.runner).model_dump(mode="json")
            await db.delete(split)

        capture.status = CaptureStatus.PENDING
        await db.commit()

        payload = {
            "capture_id": capture_id,
            "captured_ns": capture.captured_ns,
            "sequence_order": capture.sequence_order,
            "capture_device": capture.capture_device,
            "previous_bib": prev_bib,
            "previous_runner": prev_runner,
        }
        await manager.broadcast(WSEvent(event=WSEventType.UNASSIGNED, data=payload))
        return payload

    # ── Descartar captura ─────────────────────────────────────────────────────

    async def discard_capture(self, db: AsyncSession, capture_id: int):
        capture = await db.get(TimestampCapture, capture_id)
        if not capture or capture.status != CaptureStatus.PENDING:
            raise ValueError("Solo se pueden descartar capturas pendientes")
        capture.status = CaptureStatus.DISCARDED
        await db.commit()
        await manager.broadcast(WSEvent(event=WSEventType.DISCARDED, data={"capture_id": capture_id}))

    # ── Buscar dorsal ─────────────────────────────────────────────────────────

    async def bib_lookup(self, db: AsyncSession, bib_number: str) -> BibLookupResponse:
        stmt = (
            select(Registration)
            .where(Registration.race_id == self.race_id, Registration.bib_number == bib_number.strip())
            .options(selectinload(Registration.runner))
        )
        registration = (await db.execute(stmt)).scalar_one_or_none()
        if not registration:
            return BibLookupResponse(found=False, bib_number=bib_number)

        # Verificar si ya tiene un split asignado (ya llegó a meta)
        existing_split = (await db.execute(
            select(Split)
            .join(TimestampCapture, Split.timestamp_id == TimestampCapture.id)
            .where(
                Split.registration_id == registration.id,
                TimestampCapture.status == CaptureStatus.ASSIGNED,
            )
        )).scalar_one_or_none()

        return BibLookupResponse(
            found=True,
            bib_number=bib_number,
            runner=self._runner_out(registration.runner),
            already_finished=existing_split is not None,
        )


# ── Singleton por carrera ─────────────────────────────────────────────────────

_engines: dict[int, TimingEngine] = {}

def get_engine(race_id: int) -> TimingEngine:
    if race_id not in _engines:
        _engines[race_id] = TimingEngine(race_id)
    return _engines[race_id]

def reset_engines() -> None:
    """Limpia los engines en memoria (contadores de secuencia, etc.).
    Se usa al restaurar un respaldo para no arrastrar estado del dataset anterior."""
    _engines.clear()
