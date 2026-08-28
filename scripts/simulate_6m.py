"""Simulación de 6 meses de uso real de LiveRun (escritorio + web).

Genera una comunidad de 1.500 corredores con cuenta en la app y seis meses de
uso continuo: entrenamientos registrados desde el móvil, un calendario de 27
carreras oficiales cronometradas con la app de escritorio y publicadas al
portal web, más el grafo social de amigos.

  Escritorio (chronotrack.db) -> runners, races, registrations, captures, splits
  Web (cloud/cloud.db)        -> portal_users, run_activities, run_friendships,
                                 published_races, published_results, claims

Las carreras se publican por el endpoint REAL del escritorio
(POST /api/v1/races/{id}/publish), así que la simulación recorre el mismo
camino que un organizador de verdad: motor de timing -> API -> portal.

Uso:
  .venv/Scripts/python.exe scripts/simulate_6m.py
  .venv/Scripts/python.exe scripts/simulate_6m.py --no-publish
"""
import argparse
import asyncio
import hashlib
import json
import os
import random
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import delete, insert, select  # noqa: E402

from backend.core.database import AsyncSessionLocal, init_db  # noqa: E402
from backend.models.models import (  # noqa: E402
    CaptureStatus, Gender, Race, RaceStatus, Registration, RegistrationStatus,
    Runner, Split, TimestampCapture,
)
from cloud.db import Base as CloudBase, SessionLocal, engine as cloud_engine  # noqa: E402
from cloud.models import (  # noqa: E402
    Activity, Claim, CouponRedemption, Friendship, PortalUser, PublishedRace,
    PublishedResult,
)
from cloud.security import hash_password  # noqa: E402

random.seed(20260827)

TODAY = date.today()
MONTHS = 6
START = TODAY - timedelta(days=182)

N_APP_USERS   = 1500   # cuentas en la app (móvil + web)
N_APP_RACERS  = 1200   # de esas cuentas, las que además corren carreras oficiales
N_ROSTER_ONLY = 300    # corredores inscriptos por el organizador que no usan la app

DEMO_EMAIL = "demo@liverun.run"
DEMO_PASS  = "corremos2026"

FIRST_M = ["Agustín","Mateo","Diego","Juan","Tomás","Nicolás","Lucas","Santiago","Gonzalo","Federico",
           "Bruno","Joaquín","Ramiro","Ignacio","Emiliano","Facundo","Pablo","Matías","Franco","Maximiliano",
           "Gastón","Leandro","Hernán","Andrés","Cristian","Esteban","Marcos","Damián","Sebastián","Alan",
           "Martín","Rodrigo","Julián","Nahuel","Ezequiel","Lautaro","Gabriel","Iván","Manuel","Thiago"]
FIRST_F = ["Lucía","Sofía","Valentina","Camila","Martina","Florencia","Julieta","Micaela","Carla","Romina",
           "Antonella","Paula","Belén","Daniela","Rocío","Agostina","Brenda","Luciana","Ailén","Abril",
           "Milagros","Catalina","Victoria","Guadalupe","Pilar","Sol","Renata","Ariana","Morena","Jazmín",
           "Malena","Bianca","Delfina","Emilia","Ludmila","Aldana","Yamila","Noelia","Verónica","Gisela"]
LAST = ["Gómez","Fernández","Rodríguez","López","Martínez","García","Pérez","Sánchez","Romero","Sosa",
        "Torres","Álvarez","Ruiz","Ramírez","Flores","Acosta","Benítez","Medina","Suárez","Herrera",
        "Aguirre","Pereyra","Giménez","Ibarra","Cabrera","Rojas","Molina","Ortiz","Silva","Núñez",
        "Luna","Juárez","Vega","Cardozo","Ferreyra","Maldonado","Quiroga","Villalba","Ojeda","Bravo",
        "Páez","Coronel","Godoy","Ledesma","Vera","Campos","Carrizo","Figueroa","Domínguez","Castro",
        "Peralta","Arias","Ávila","Roldán","Bustos","Miranda","Escobar","Navarro","Correa","Farías"]
CLUBS = ["Nightrunners","Pampa RC","Costa Team","Río Runners","Club Atlético Sur","Maratón Norte",
         "Pumas Running","Veloz RC","Andes Trail","Independiente Run","Runners del Parque","Team Paraná"]
MAIL_DOMAINS = ["gmail.com","gmail.com","gmail.com","hotmail.com","outlook.com","yahoo.com.ar"]

# Ciudades con su peso demográfico dentro de la comunidad.
CITIES = [("Rosario",0.30),("Buenos Aires",0.26),("Córdoba",0.11),("La Plata",0.08),
          ("Mendoza",0.07),("Santa Fe",0.06),("Mar del Plata",0.06),("Tucumán",0.04),("Tandil",0.02)]
CITY_NAMES  = [c for c, _ in CITIES]
CITY_WEIGHT = [w for _, w in CITIES]

# Calendario: (mes, día, nombre, ciudad, distancias, tipo, hora, inscriptos).
# Fechas ancladas al año en curso; se simulan las que caen dentro de los 6 meses.
CALENDAR = [
    (3,  1, "Nocturna de Verano",             "Rosario",       [5.0, 10.0],  "night", 20.5, 380),
    (3,  8, "Corrida de la Mujer",            "Buenos Aires",  [3.0, 8.0],   "road",   9.0, 520),
    (3, 15, "Media Maratón de Rosario",       "Rosario",       [10.0, 21.0], "road",   8.0, 470),
    (3, 22, "Cross del Parque Independencia", "Rosario",       [5.0, 10.0],  "cross",  9.0, 220),
    (3, 29, "Desafío Costanera",              "Santa Fe",      [10.0, 21.0], "road",   8.5, 260),
    (4,  5, "Maratón de Rosario",             "Rosario",       [21.0, 42.0], "road",   7.5, 340),
    (4, 12, "Carrera Solidaria Un Techo",     "Buenos Aires",  [5.0, 10.0],  "road",   9.5, 430),
    (4, 19, "Trail Sierras Chicas",           "Córdoba",       [12.0, 25.0], "trail",  8.0, 170),
    (4, 26, "10K Ciudad de La Plata",         "La Plata",      [10.0],       "road",   9.0, 300),
    (5,  1, "Corrida del Trabajador",         "Rosario",       [5.0, 10.0],  "road",   9.0, 290),
    (5, 10, "Media Maratón de Mendoza",       "Mendoza",       [10.0, 21.0], "road",   8.0, 330),
    (5, 17, "Cross de Otoño",                 "Mar del Plata", [5.0, 10.0],  "cross", 10.0, 190),
    (5, 24, "Corrida 25 de Mayo",             "Buenos Aires",  [5.0, 10.0],  "road",   9.0, 480),
    (5, 31, "Nocturna de Puerto Madero",      "Buenos Aires",  [5.0, 10.0],  "night", 20.0, 390),
    (6,  7, "Desafío Río Paraná",             "Rosario",       [10.0, 21.0], "road",   8.5, 260),
    (6, 14, "Trail Sierras de Tandil",        "Tandil",        [15.0, 30.0], "trail",  8.0, 140),
    (6, 20, "Maratón de la Bandera",          "Rosario",       [10.0, 21.0], "road",   8.0, 540),
    (6, 28, "Cross Universitario",            "Córdoba",       [5.0, 10.0],  "cross", 10.0, 230),
    (7,  5, "Media Maratón de Tucumán",       "Tucumán",       [10.0, 21.0], "road",   8.0, 280),
    (7,  9, "Corrida de la Independencia",    "Tucumán",       [5.0, 10.0],  "road",   9.0, 410),
    (7, 19, "Nocturna de Invierno",           "Buenos Aires",  [5.0, 10.0],  "night", 19.5, 350),
    (7, 26, "Trail Nahuel Huapi",             "Bariloche",     [10.0, 21.0], "trail",  9.0, 150),
    (8,  2, "10K Costanera Sur",              "Buenos Aires",  [10.0],       "road",   9.0, 320),
    (8,  9, "Media Maratón de La Plata",      "La Plata",      [10.0, 21.0], "road",   8.0, 370),
    (8, 16, "Cross del Bosque",               "La Plata",      [5.0, 10.0],  "cross", 10.0, 210),
    (8, 17, "Corrida Sanmartiniana",          "Mendoza",       [5.0, 10.0],  "road",   9.5, 260),
    (8, 23, "Maratón de Mar del Plata",       "Mar del Plata", [21.0, 42.0], "road",   7.5, 300),
]
# Fechas futuras: quedan PLANNED con inscriptos, listas para cronometrar, y se
# publican en el calendario del portal. (mes, día, nombre, ciudad, distancias,
# tipo, hora, inscriptos, cupo, link de inscripción).
# Los links usan example.com — dominio reservado para ejemplos; el organizador
# carga el real desde el escritorio.
UPCOMING = [
    (9,  6, "Nocturna de Primavera",       "Rosario",      [5.0, 10.0],  "night", 20.5, 300,  600, "https://example.com/inscripcion/nocturna-primavera"),
    (9, 13, "Media Maratón de Buenos Aires","Buenos Aires",[10.0, 21.0], "road",   8.0, 520, 1200, "https://example.com/inscripcion/media-buenos-aires"),
    (9, 20, "Trail Sierras Chicas Primavera","Córdoba",    [12.0, 25.0], "trail",  8.0, 180,  180, "https://example.com/inscripcion/trail-sierras"),
    (10, 4, "Maratón de Rosario Primavera", "Rosario",     [21.0, 42.0], "road",   7.5, 340,  900, "https://example.com/inscripcion/maraton-rosario"),
    (10,12, "10K de la Diversidad",         "Mendoza",     [5.0, 10.0],  "road",   9.0, 260, None, "https://example.com/inscripcion/10k-diversidad"),
    (11, 8, "Corrida de la Primavera",      "La Plata",    [5.0, 10.0],  "road",   9.0,  95,  500, None),
    (12, 6, "Nocturna de Fin de Año",       "Rosario",     [5.0, 10.0],  "night", 20.5,  40,  700, "https://example.com/inscripcion/nocturna-fin-de-ano"),
]

TERRAIN = {"road": 1.0, "night": 1.0, "cross": 1.12, "trail": 1.28}


def cat_for(gender: str, age: int) -> str:
    p = "F" if gender == "F" else "M"
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


def pace_for(base10k: float, dist_km: float, kind: str) -> float:
    """Ritmo (s/km) esperado para una distancia, a partir del ritmo base de 10K.
    Riegel: el ritmo se degrada con la distancia; el terreno agrega su factor."""
    return base10k * (dist_km / 10.0) ** 0.08 * TERRAIN[kind]


class Person:
    __slots__ = ("first","last","gender","age","city","club","email","username","base10k",
                 "app","racer","joined","runs_per_week","active_days","morning","premium",
                 "budget","raced","runner_id","user_id","web_active")


def build_population() -> list:
    people, used_user, used_email = [], set(), set()
    total = N_APP_USERS + N_ROSTER_ONLY
    while len(people) < total:
        gender = "F" if random.random() < 0.44 else "M"
        first = random.choice(FIRST_F if gender == "F" else FIRST_M)
        last = random.choice(LAST)
        base = (f"{first}.{last}".lower()
                .replace("á","a").replace("é","e").replace("í","i")
                .replace("ó","o").replace("ú","u").replace("ñ","n"))
        uname = base if base not in used_user else f"{base}{random.randint(1, 999)}"
        if uname in used_user:
            continue
        email = f"{uname}@{random.choice(MAIL_DOMAINS)}"
        if email in used_email:
            continue
        used_user.add(uname); used_email.add(email)

        p = Person()
        p.first, p.last, p.gender = first, last, gender
        p.age = max(17, min(74, int(random.gauss(38, 11))))
        p.city = random.choices(CITY_NAMES, CITY_WEIGHT)[0]
        p.club = random.choice(CLUBS) if random.random() < 0.42 else None
        p.username, p.email = uname, email
        # Ritmo base de 10K: la media de la población amateur ronda 5:45/km.
        base10k = (random.gauss(345, 52) + (20 if gender == "F" else 0)
                   + max(0, p.age - 38) * 1.1 + max(0, 24 - p.age) * 1.4)
        p.base10k = max(190.0, min(560.0, base10k))
        p.runner_id = p.user_id = None
        people.append(p)

    random.shuffle(people)
    # 1.500 con cuenta en la app; de esas, 1.200 también corren carreras oficiales.
    for i, p in enumerate(people):
        p.app = i < N_APP_USERS
        p.racer = (i < N_APP_RACERS) or (i >= N_APP_USERS)

    # El demo es una cuenta más de la comunidad, con email y clave conocidos.
    demo = people[0]
    demo.app = demo.racer = True
    demo.email, demo.username = DEMO_EMAIL, "demo"
    demo.city, demo.club = "Rosario", "Nightrunners"
    demo.base10k = 302.0

    for p in people:
        if p.app:
            # Curva de adopción: pico de lanzamiento y goteo sostenido después.
            r = random.random()
            if r < 0.22:   d_ago = random.randint(160, 182)     # early adopters
            elif r < 0.55: d_ago = random.randint(80, 160)
            else:          d_ago = random.randint(3, 80)
            p.joined = TODAY - timedelta(days=d_ago)
            p.runs_per_week = random.choices([1, 2, 3, 4, 5, 6], [10, 20, 26, 22, 15, 7])[0]
            days_since = (TODAY - p.joined).days
            # ~28% abandona la app en algún momento (churn realista).
            p.active_days = (int(days_since * random.uniform(0.25, 0.8))
                             if random.random() < 0.28 else days_since)
            p.morning = random.random() < 0.58
            p.premium = random.random() < 0.16
            p.web_active = random.random() < 0.82   # entró alguna vez al portal
        else:
            p.joined = None
            p.runs_per_week = p.active_days = 0
            p.morning = p.premium = p.web_active = False
        # Carreras que espera correr en el semestre (apetito, no cupo rígido).
        p.budget = random.choices([1, 2, 3, 4, 5, 6, 8, 10, 13],
                                  [10, 13, 15, 14, 12, 10, 10, 7, 3])[0] if p.racer else 0
        p.raced = 0
    demo.joined = TODAY - timedelta(days=175)
    demo.runs_per_week, demo.active_days = 4, 175
    demo.premium, demo.web_active, demo.budget = True, True, 9
    return people


def race_calendar() -> list:
    """Convierte CALENDAR + UPCOMING en carreras con fecha real dentro de la ventana."""
    races = []
    entries = [(c, None, None) for c in CALENDAR] + [(u[:8], u[8], u[9]) for u in UPCOMING]
    for (month, day, name, city, dists, kind, hour, size), capacity, reg_url in entries:
        rdate = date(TODAY.year, month, day)
        planned = rdate > TODAY
        if not planned and rdate < START:
            continue
        h, m = int(hour), int(round((hour % 1) * 60))
        races.append({
            "name": f"{name} {rdate.year}", "city": city, "date": rdate,
            "dists": dists, "kind": kind, "size": size, "planned": planned,
            "capacity": capacity, "registration_url": reg_url,
            "start_dt": datetime(rdate.year, rdate.month, rdate.day, h, m),
            "women_only": "Mujer" in name,
        })
    races.sort(key=lambda r: r["date"])
    return races


def pick_participants(people: list, race: dict) -> list:
    """Muestreo sin reemplazo ponderado (Efraimidis-Spirakis) por apetito de
    carreras, cercanía y tipo de prueba. El apetito no se consume: se penaliza
    de forma suave a quien ya corrió mucho, así ninguna fecha del calendario
    se queda sin campo por haber agotado la comunidad en las fechas previas."""
    pool = []
    for p in people:
        if not p.racer or p.budget <= 0:
            continue
        if p.app and p.joined and race["date"] < p.joined - timedelta(days=30):
            continue  # todavía no estaba en la comunidad
        if race["women_only"] and p.gender != "F" and random.random() > 0.05:
            continue
        w = p.budget * (3.5 if p.city == race["city"] else 1.0)
        w *= 0.5 ** (p.raced / p.budget)           # ya corrió su cupo: menos probable
        if race["kind"] == "trail":
            w *= 2.2 if p.club and "Trail" in p.club else 0.6
        if max(race["dists"]) >= 30:
            w *= 1.6 if p.base10k < 330 else 0.5   # las largas convocan a los rodados
        pool.append((random.random() ** (1.0 / w), p))
    pool.sort(key=lambda t: t[0], reverse=True)
    chosen = [p for _, p in pool[: race["size"]]]
    for p in chosen:
        p.raced += 1
    return chosen


# ── Fase 1: app de escritorio ────────────────────────────────────────────────

async def seed_desktop(people, races):
    await init_db()
    async with AsyncSessionLocal() as db:
        for model in (Split, TimestampCapture, Registration, Race, Runner):
            await db.execute(delete(model))
        await db.commit()

        # El padrón del escritorio son los corredores de carreras oficiales:
        # los usuarios de la app que no compiten no existen para el organizador.
        roster = [p for p in people if p.racer]
        rows = [{
            "first_name": p.first, "last_name": p.last, "email": p.email,
            "dni": str(random.randint(20_000_000, 47_000_000)),
            "birth_date": date(TODAY.year - p.age, random.randint(1, 12), random.randint(1, 28)),
            "gender": Gender.F if p.gender == "F" else Gender.M,
            "category": cat_for(p.gender, p.age), "club": p.club,
        } for p in roster]
        await db.execute(insert(Runner), rows)
        await db.commit()
        ids = (await db.execute(select(Runner.id).order_by(Runner.id))).scalars().all()
        for p, rid in zip(roster, ids):
            p.runner_id = rid

        race_ids, n_regs, n_results = [], 0, 0
        for race in races:
            start_ns = None if race["planned"] else int(race["start_dt"].timestamp() * 1e9)
            r = Race(name=race["name"], location=race["city"], race_date=race["date"],
                     distance_km=race["dists"][0], race_start_ns=start_ns,
                     capacity=race["capacity"], registration_url=race["registration_url"],
                     status=RaceStatus.PLANNED if race["planned"] else RaceStatus.FINISHED)
            db.add(r)
            await db.flush()
            race["id"] = r.id
            # Se publican todas: el escritorio manda resultados si ya se corrió
            # y un anuncio de calendario si todavía no.
            race_ids.append(r.id)

            participants = pick_participants(people, race)
            dists = sorted(race["dists"])
            # La distancia corta se lleva la mayoría del campo.
            dweights = {1: [1.0], 2: [0.66, 0.34], 3: [0.55, 0.32, 0.13]}[len(dists)]

            reg_rows, meta = [], []
            bib_counter = {d: 1000 * (i + 1) for i, d in enumerate(dists)}
            for p in participants:
                d = random.choices(dists, dweights)[0]
                if d >= 30 and p.base10k > 380 and random.random() < 0.6:
                    d = dists[0]                       # los más lentos bajan de distancia
                bib_counter[d] += 1
                if race["planned"]:
                    status = RegistrationStatus.OK
                else:
                    roll = random.random()
                    dnf_rate = 0.045 if d >= 21 else 0.014
                    if roll < 0.042:                status = RegistrationStatus.DNS
                    elif roll < 0.042 + dnf_rate:   status = RegistrationStatus.DNF
                    elif roll < 0.044 + dnf_rate:   status = RegistrationStatus.DQ
                    else:                           status = RegistrationStatus.OK
                reg_rows.append({"runner_id": p.runner_id, "race_id": r.id,
                                 "bib_number": str(bib_counter[d]), "distance_km": d,
                                 "status": status})
                meta.append((p, d, status))
            await db.execute(insert(Registration), reg_rows)
            await db.commit()
            n_regs += len(reg_rows)
            reg_ids = (await db.execute(
                select(Registration.id).where(Registration.race_id == r.id)
                .order_by(Registration.id))).scalars().all()

            if race["planned"]:
                continue

            # Tiempos: ritmo del corredor para esa distancia + día bueno/malo.
            timed = []
            months_in = (race["date"] - START).days / 182.0
            for reg_id, (p, d, status) in zip(reg_ids, meta):
                if status != RegistrationStatus.OK:
                    continue
                improve = 1.0 - 0.035 * months_in * (1.0 if p.app else 0.4)
                pace = pace_for(p.base10k * improve, d, race["kind"]) * random.gauss(1.0, 0.035)
                timed.append((reg_id, int(d * pace * 1e9)))
            timed.sort(key=lambda t: t[1])

            cap_rows = [{"race_id": r.id, "captured_ns": start_ns + net,
                         "sequence_order": i + 1, "capture_device": "operator-1",
                         "status": CaptureStatus.ASSIGNED}
                        for i, (_, net) in enumerate(timed)]
            if cap_rows:
                await db.execute(insert(TimestampCapture), cap_rows)
                await db.commit()
                cap_ids = (await db.execute(
                    select(TimestampCapture.id).where(TimestampCapture.race_id == r.id)
                    .order_by(TimestampCapture.id))).scalars().all()
                await db.execute(insert(Split), [
                    {"timestamp_id": cid, "registration_id": reg_id, "assigned_by": "operator-1"}
                    for cid, (reg_id, _) in zip(cap_ids, timed)])
                await db.commit()
                n_results += len(cap_rows)

        print(f"  escritorio · corredores={len(roster)} carreras={len(races)} "
              f"inscripciones={n_regs} resultados={n_results}")
        return race_ids


# ── Fase 2: portal / app móvil ───────────────────────────────────────────────

def seed_cloud(people):
    CloudBase.metadata.create_all(cloud_engine)
    db = SessionLocal()
    for model in (Claim, CouponRedemption, Friendship, Activity, PublishedResult, PublishedRace):
        db.query(model).delete()
    db.query(PortalUser).delete()
    db.commit()

    pw = hash_password(DEMO_PASS)   # misma clave de demo para toda la comunidad
    now = datetime.utcnow()
    app_users = [p for p in people if p.app]
    db.execute(insert(PortalUser), [{
        "email": p.email, "password_hash": pw, "full_name": f"{p.first} {p.last}",
        "username": p.username, "weekly_goal": max(2, min(6, p.runs_per_week)),
        "created_at": datetime(p.joined.year, p.joined.month, p.joined.day,
                               random.randint(8, 22), random.randint(0, 59)),
        "premium_until": (now + timedelta(days=random.randint(10, 300))) if p.premium else None,
        "is_admin": 0,
    } for p in app_users])
    db.commit()
    id_by_email = dict(db.execute(select(PortalUser.email, PortalUser.id)).all())
    for p in app_users:
        p.user_id = id_by_email[p.email]

    # ── Entrenamientos (los seis meses de uso de la app móvil) ──
    # Semana a semana, no día a día: un corredor sostiene una frecuencia y de vez
    # en cuando afloja o se lesiona. Tirar una moneda por día daría semanas de 1 y
    # de 6 salidas alternadas, que rompen la racha y no se parecen a un plan real.
    DOW = [1.05, 0.70, 1.15, 0.80, 1.00, 1.25, 1.35]   # lun..dom
    acts, n_acts = [], 0
    for p in app_users:
        last_day = min(TODAY, p.joined + timedelta(days=p.active_days))
        week, n = p.joined - timedelta(days=p.joined.weekday()), 0
        while week <= last_day:
            days = [d for d in (week + timedelta(days=i) for i in range(7))
                    if p.joined <= d <= last_day]
            roll = random.random()
            if roll < 0.03:    target = 0                              # lesión / viaje
            elif roll < 0.13:  target = max(0, p.runs_per_week - 2)    # semana floja
            else:              target = int(round(random.gauss(p.runs_per_week, 0.7)))
            target = max(0, min(target, len(days)))
            picked = sorted(days, key=lambda d: random.random() ** (1.0 / DOW[d.weekday()]),
                            reverse=True)[:target]
            week += timedelta(days=7)
            for day in sorted(picked):
                n += 1
                progress = (day - p.joined).days / max(1, p.active_days)
                fitness = 1.0 - 0.04 * progress
                long_run = day.weekday() >= 5 and random.random() < 0.45
                tempo = (not long_run) and random.random() < 0.18
                if long_run:
                    dist = round(random.uniform(11, 22 if p.runs_per_week >= 4 else 16), 2)
                    mult = random.uniform(1.06, 1.18)
                elif tempo:
                    dist = round(random.uniform(6, 12), 2)
                    mult = random.uniform(0.95, 1.03)
                else:
                    dist = round(random.uniform(4, 9), 2)
                    mult = random.uniform(1.10, 1.26)
                pace = pace_for(p.base10k * fitness, dist, "road") * mult
                hour = random.randint(6, 9) if p.morning else random.randint(18, 21)
                acts.append({
                    "user_id": p.user_id, "client_uuid": f"sim-{p.user_id}-{day.isoformat()}-{n}",
                    "started_at": datetime(day.year, day.month, day.day, hour, random.randint(0, 59)),
                    "duration_s": int(dist * pace), "distance_m": round(dist * 1000.0, 1),
                    "avg_pace_s_per_km": round(pace, 1),
                    "splits": json.dumps([round(pace + random.uniform(-9, 9), 1)
                                          for _ in range(int(dist))]),
                    "created_at": datetime(day.year, day.month, day.day, hour, random.randint(0, 59)),
                })
                if len(acts) >= 5000:
                    db.execute(insert(Activity), acts); db.commit()
                    n_acts += len(acts); acts = []
    if acts:
        db.execute(insert(Activity), acts); db.commit(); n_acts += len(acts)

    # ── Amistades: club y ciudad concentran el grafo social ──
    by_city = {}
    for p in app_users:
        by_city.setdefault(p.city, []).append(p)
    pairs, rows = set(), []
    while len(pairs) < 6000:
        a = random.choice(app_users)
        b = random.choice(by_city[a.city] if random.random() < 0.7 else app_users)
        if a.user_id == b.user_id:
            continue
        key = tuple(sorted((a.user_id, b.user_id)))
        if key in pairs:
            continue
        pairs.add(key)
        created = now - timedelta(days=random.randint(1, 180))
        rows.append({"requester_id": a.user_id, "addressee_id": b.user_id,
                     "status": "accepted", "created_at": created, "accepted_at": created})
    demo = next(p for p in app_users if p.email == DEMO_EMAIL)
    friends_of_demo = random.sample([p for p in app_users if p.user_id != demo.user_id], 46)
    for p in friends_of_demo[:38]:
        key = tuple(sorted((demo.user_id, p.user_id)))
        if key in pairs:
            continue
        pairs.add(key)
        created = now - timedelta(days=random.randint(1, 150))
        rows.append({"requester_id": demo.user_id, "addressee_id": p.user_id,
                     "status": "accepted", "created_at": created, "accepted_at": created})
    for p in friends_of_demo[38:]:          # solicitudes entrantes pendientes
        key = tuple(sorted((demo.user_id, p.user_id)))
        if key in pairs:
            continue
        pairs.add(key)
        rows.append({"requester_id": p.user_id, "addressee_id": demo.user_id,
                     "status": "pending", "created_at": now - timedelta(days=random.randint(0, 6))})
    db.execute(insert(Friendship), rows)
    db.commit()

    n_users = db.query(PortalUser).count()
    db.close()
    print(f"  web · cuentas={n_users} entrenamientos={n_acts} amistades={len(rows)}")


# ── Fase 3: publicar al portal por el endpoint real del escritorio ───────────

def publish_all(race_ids, port):
    ok, events, total, failed = 0, 0, 0, []
    for rid in race_ids:
        url = f"http://127.0.0.1:{port}/api/v1/races/{rid}/publish"
        req = urllib.request.Request(url, data=b"", method="POST",
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                body = json.loads(resp.read().decode())
            if body.get("event"):
                events += 1
            else:
                ok += 1
                total += body.get("published_results", 0)
        except urllib.error.HTTPError as e:
            failed.append((rid, e.code, e.read().decode("utf-8", "replace")[:160]))
        except Exception as e:                      # noqa: BLE001
            failed.append((rid, "?", str(e)[:160]))
    print(f"  publicación · resultados={ok} carreras ({total} marcas) · calendario={events} eventos")
    for rid, code, detail in failed:
        print(f"    ! carrera {rid}: {code} {detail}")
    return ok, total


def link_claims(people):
    """Vincula resultados a las cuentas que entraron al portal (mismo criterio
    que cloud.main._autolink, aplicado en lote para los usuarios 'web activos')."""
    db = SessionLocal()
    wanted = {hashlib.sha256(("chronotrack-v1:" + p.email).encode()).hexdigest(): p.user_id
              for p in people if p.app and p.web_active}
    rows = []
    for res_id, h in db.execute(select(PublishedResult.id, PublishedResult.email_hash)).all():
        uid = wanted.get(h)
        if uid:
            rows.append({"user_id": uid, "result_id": res_id, "claimed_at": datetime.utcnow()})
    if rows:
        db.execute(insert(Claim), rows)
        db.commit()
    n = db.query(Claim).count()
    db.close()
    print(f"  perfiles · resultados vinculados a cuentas={n}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-publish", action="store_true",
                    help="no publicar al portal (la publicación necesita el backend corriendo)")
    ap.add_argument("--port", default=os.environ.get("CT_DESKTOP_PORT", "8001"),
                    help="puerto del backend de escritorio")
    args = ap.parse_args()

    print(f"Simulación de {MONTHS} meses · {START} → {TODAY}")
    people = build_population()
    races = race_calendar()
    race_ids = asyncio.run(seed_desktop(people, races))
    seed_cloud(people)
    if args.no_publish:
        print("  publicación · omitida (--no-publish)")
        return
    publish_all(race_ids, args.port)
    link_claims(people)


if __name__ == "__main__":
    main()
