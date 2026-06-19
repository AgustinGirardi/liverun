"""Seed de demo para la app de escritorio (timing). DB: chronotrack.db (raíz).

Crea 700 corredores y 55 carreras FINALIZADAS con resultados reales
(capturas + splits) que el motor de timing computa en /results.

Uso:  .venv/Scripts/python.exe scripts/seed_demo_desktop.py
"""
import asyncio
import os
import random
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import delete  # noqa: E402
from backend.core.database import AsyncSessionLocal, init_db  # noqa: E402
from backend.models.models import (  # noqa: E402
    CaptureStatus, Gender, Race, RaceStatus, Registration, RegistrationStatus,
    Runner, Split, TimestampCapture,
)

random.seed(2026)

FIRST = ["Agustin","Lucia","Mateo","Sofia","Diego","Valentina","Juan","Camila","Tomas","Martina",
         "Nicolas","Florencia","Lucas","Julieta","Santiago","Micaela","Gonzalo","Carla","Federico","Romina",
         "Bruno","Antonella","Joaquin","Paula","Ramiro","Belen","Ignacio","Daniela","Emiliano","Rocio",
         "Facundo","Agostina","Pablo","Brenda","Matias","Luciana","Franco","Ailen","Maximiliano","Abril",
         "Gaston","Milagros","Leandro","Catalina","Hernan","Victoria","Andres","Guadalupe","Cristian","Pilar"]
LAST = ["Gomez","Fernandez","Rodriguez","Lopez","Martinez","Garcia","Perez","Sanchez","Romero","Sosa",
        "Torres","Alvarez","Ruiz","Ramirez","Flores","Acosta","Benitez","Medina","Suarez","Herrera",
        "Aguirre","Pereyra","Gimenez","Ibarra","Cabrera","Rojas","Molina","Ortiz","Silva","Nunez",
        "Luna","Juarez","Vega","Cardozo","Ferreyra","Maldonado","Quiroga","Villalba","Ojeda","Bravo"]
CLUBS = ["Nightrunners","Pampa RC","Costa Team","Rio Runners","Atletico Sur","Maraton Norte",
         "Pumas Running","Veloz RC","Andes Trail","Independiente Run", None, None]
CITIES = ["Rosario","Buenos Aires","Cordoba","Mendoza","La Plata","Mar del Plata","Santa Fe","Tucuman"]
RACE_NAMES = ["Nocturna","Maraton","Media Maraton","Cross","Desafio","Corre","Circuito","Aniversario",
              "Trail","Clasica","Gran Fondo","Urbana","Solidaria","Costanera Run","Parque Run"]


def cat_for(g, age):
    p = "F" if g == Gender.F else "M"
    if age < 18: return f"{p}-Sub18"
    if age <= 24: return f"{p}18-24"
    if age <= 29: return f"{p}25-29"
    if age <= 34: return f"{p}30-34"
    if age <= 39: return f"{p}35-39"
    if age <= 44: return f"{p}40-44"
    if age <= 49: return f"{p}45-49"
    if age <= 54: return f"{p}50-54"
    if age <= 59: return f"{p}55-59"
    return f"{p}60+"


async def main():
    await init_db()
    async with AsyncSessionLocal() as db:
        # limpieza idempotente (orden por FKs)
        for model in (Split, TimestampCapture, Registration, Race, Runner):
            await db.execute(delete(model))
        await db.commit()

        # ── 700 corredores ──
        runners = []
        used = set()
        while len(runners) < 700:
            fn, ln = random.choice(FIRST), random.choice(LAST)
            key = (fn, ln, random.randint(0, 9999))
            if key in used:
                continue
            used.add(key)
            g = random.choice([Gender.M, Gender.F])
            age = random.randint(18, 62)
            r = Runner(first_name=fn, last_name=ln, gender=g, category=cat_for(g, age),
                       club=random.choice(CLUBS), dni=str(random.randint(20_000_000, 45_000_000)))
            r._age = age
            runners.append(r)
            db.add(r)
        await db.commit()
        for r in runners:
            await db.refresh(r)

        BASE_NS = 1_700_000_000_000_000_000  # base arbitraria para race_start_ns

        total_results = 0
        for i in range(55):
            rdate = date.today() - timedelta(days=random.randint(3, 400))
            dists = random.choice([[5.0, 10.0], [10.0, 21.0], [5.0], [10.0], [5.0, 10.0, 21.0]])
            name = f"{random.choice(RACE_NAMES)} {random.choice(CITIES)} {rdate.year}"
            start_ns = BASE_NS + i * 10_000_000_000_000
            race = Race(name=name, location=random.choice(CITIES), race_date=rdate,
                        distance_km=dists[0], status=RaceStatus.FINISHED, race_start_ns=start_ns)
            db.add(race)
            await db.flush()

            participants = random.sample(runners, random.randint(120, 240))
            seq = 0
            bib = 100
            # registraciones
            regs = []
            for p in participants:
                bib += 1
                d = random.choice(dists)
                status = RegistrationStatus.OK
                roll = random.random()
                if roll > 0.97: status = RegistrationStatus.DNF
                elif roll > 0.94: status = RegistrationStatus.DNS
                reg = Registration(runner_id=p.id, race_id=race.id, bib_number=str(bib),
                                   distance_km=d, status=status)
                reg._p = p; reg._d = d; reg._status = status
                regs.append(reg)
                db.add(reg)
            await db.flush()

            # capturas + splits para los finishers (OK)
            finishers = [r for r in regs if r._status == RegistrationStatus.OK]
            # tiempo según distancia + variación
            timed = []
            for reg in finishers:
                base_pace = {5.0: 300, 10.0: 320, 21.0: 345}.get(reg._d, 330)
                pace = base_pace + random.uniform(-25, 80)
                net_ns = int(reg._d * pace * 1_000_000_000)
                timed.append((reg, net_ns))
            timed.sort(key=lambda t: t[1])
            for reg, net_ns in timed:
                seq += 1
                cap = TimestampCapture(race_id=race.id, captured_ns=start_ns + net_ns,
                                       sequence_order=seq, status=CaptureStatus.ASSIGNED)
                db.add(cap)
                await db.flush()
                db.add(Split(timestamp_id=cap.id, registration_id=reg.id))
                total_results += 1
            await db.commit()

        n_runners = len(runners)
        print(f"OK · runners={n_runners} carreras=55 resultados={total_results}")


if __name__ == "__main__":
    asyncio.run(main())
