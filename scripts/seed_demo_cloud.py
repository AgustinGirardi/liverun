"""Seed de demo para el portal/cloud (móvil + web).

Crea:
- usuario demo (demo@chronotrack.run / corremos2026, username agusdemo)
- 700 corredores con actividades recientes (semana/mes) -> ranking poblado
- amistades del demo (aceptadas + algunas solicitudes entrantes)
- 55 carreras publicadas con resultados -> portal web

Uso:  .venv/Scripts/python.exe scripts/seed_demo_cloud.py
"""
import hashlib
import json
import os
import random
import sys
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from cloud.db import Base, SessionLocal, engine  # noqa: E402
from cloud.models import (  # noqa: E402
    Activity, Friendship, PortalUser, PublishedRace, PublishedResult,
)
from cloud.security import hash_password  # noqa: E402

random.seed(2026)

FIRST = ["Agustin","Lucia","Mateo","Sofia","Diego","Valentina","Juan","Camila","Tomas","Martina",
         "Nicolas","Florencia","Lucas","Julieta","Santiago","Micaela","Gonzalo","Carla","Federico","Romina",
         "Bruno","Antonella","Joaquin","Paula","Ramiro","Belen","Ignacio","Daniela","Emiliano","Rocio",
         "Facundo","Agostina","Pablo","Brenda","Matias","Luciana","Franco","Ailen","Maximiliano","Abril",
         "Gaston","Milagros","Leandro","Catalina","Hernan","Victoria","Andres","Guadalupe","Cristian","Pilar",
         "Esteban","Sol","Marcos","Renata","Damian","Ariana","Sebastian","Morena","Alan","Jazmin"]
LAST = ["Gomez","Fernandez","Rodriguez","Lopez","Martinez","Garcia","Perez","Sanchez","Romero","Sosa",
        "Torres","Alvarez","Ruiz","Ramirez","Flores","Acosta","Benitez","Medina","Suarez","Herrera",
        "Aguirre","Pereyra","Gimenez","Ibarra","Cabrera","Rojas","Molina","Ortiz","Silva","Nunez",
        "Luna","Juarez","Vega","Cardozo","Ferreyra","Maldonado","Quiroga","Villalba","Ojeda","Bravo",
        "Paez","Coronel","Godoy","Ledesma","Vera","Campos","Carrizo","Figueroa","Dominguez","Castro"]
CLUBS = ["Nightrunners","Pampa RC","Costa Team","Río Runners","Club Atlético Sur","Maratón Norte",
         "Pumas Running","Veloz RC","Andes Trail","Independiente Run", None, None]
CITIES = ["Rosario","Buenos Aires","Córdoba","Mendoza","La Plata","Mar del Plata","Santa Fe","Tucumán"]
RACE_NAMES = ["Nocturna","Maratón","Media Maratón","Cross","Desafío","Corre","Circuito","Carrera Aniversario",
              "Trail","Clásica","Gran Fondo","Urbana","Solidaria","Costanera Run","Parque Run"]


def cat_for(gender, age):
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


def main():
    Base.metadata.create_all(engine)
    db = SessionLocal()

    # Limpieza idempotente de tablas que seedeamos
    for model in (Friendship, Activity, PublishedResult, PublishedRace):
        db.query(model).delete()
    db.query(PortalUser).delete()
    db.commit()

    now = datetime.utcnow()
    pw = hash_password("corremos2026")

    # ── Demo user ──
    demo = PortalUser(email="demo@chronotrack.run", password_hash=pw, full_name="Agustin Demo",
                      username="agusdemo", weekly_goal=4, created_at=now - timedelta(days=3))
    db.add(demo)

    # ── 700 corredores ──
    users = []
    used_user = set(); used_email = set()
    while len(users) < 700:
        fn = random.choice(FIRST); ln = random.choice(LAST)
        base = f"{fn}.{ln}".lower()
        uname = base if base not in used_user else f"{base}{random.randint(1,999)}"
        if uname in used_user: continue
        email = f"{uname}@demo.run"
        if email in used_email: continue
        used_user.add(uname); used_email.add(email)
        gender = random.choice(["M", "F"])
        u = PortalUser(
            email=email, password_hash=pw, full_name=f"{fn} {ln}",
            username=uname, weekly_goal=random.choice([3, 3, 4, 5]),
            created_at=now - timedelta(days=random.randint(5, 200)),
            premium_until=(now + timedelta(days=200)) if random.random() < 0.18 else None,
        )
        u._gender = gender
        u._age = random.randint(18, 62)
        u._fn, u._ln = fn, ln
        users.append(u)
        db.add(u)
    db.commit()

    # ── Actividades: muchas en la semana y el mes en curso ──
    today = date.today()
    act_n = 0
    for u in users:
        # corredor más o menos activo
        weekly = random.choices([0, 1, 2, 3, 4, 5], weights=[6, 12, 20, 24, 20, 18])[0]
        days_pool = list(range(0, 35))
        random.shuffle(days_pool)
        picked = sorted(days_pool[: weekly + random.randint(2, 8)])
        for d_ago in picked:
            day = today - timedelta(days=d_ago)
            dist_km = round(random.choice([3, 5, 5, 8, 10, 10, 12, 15, 21]) + random.uniform(-0.6, 0.8), 2)
            dist_km = max(2.0, dist_km)
            pace = random.uniform(290, 380)  # s/km
            dur = int(dist_km * pace)
            started = datetime(day.year, day.month, day.day,
                               random.randint(6, 20), random.randint(0, 59))
            db.add(Activity(
                user_id=u.id, client_uuid=f"seed-{u.id}-{d_ago}", started_at=started,
                duration_s=dur, distance_m=dist_km * 1000.0, avg_pace_s_per_km=round(pace, 1),
                splits=json.dumps([round(pace + random.uniform(-8, 8), 1) for _ in range(int(dist_km))]),
            ))
            act_n += 1
    db.commit()

    # ── Demo: actividades propias esta semana ──
    for d_ago in (0, 2, 4):
        day = today - timedelta(days=d_ago)
        dist = round(random.uniform(5, 11), 2)
        pace = random.uniform(300, 330)
        db.add(Activity(user_id=demo.id, client_uuid=f"seed-demo-{d_ago}",
                        started_at=datetime(day.year, day.month, day.day, 7, 30),
                        duration_s=int(dist * pace), distance_m=dist * 1000.0,
                        avg_pace_s_per_km=round(pace, 1)))
    db.commit()

    # ── Amistades del demo: 28 aceptadas + 6 solicitudes entrantes ──
    pool = random.sample(users, 40)
    for u in pool[:28]:
        db.add(Friendship(requester_id=demo.id, addressee_id=u.id, status="accepted",
                          accepted_at=now, created_at=now - timedelta(days=random.randint(1, 60))))
    for u in pool[28:34]:
        db.add(Friendship(requester_id=u.id, addressee_id=demo.id, status="pending",
                          created_at=now - timedelta(days=random.randint(0, 4))))
    # amistades aleatorias entre corredores (densidad para el grafo social)
    for _ in range(1200):
        a, b = random.sample(users, 2)
        if a.id == b.id: continue
        db.add(Friendship(requester_id=a.id, addressee_id=b.id, status="accepted",
                          accepted_at=now, created_at=now - timedelta(days=random.randint(1, 90))))
    try:
        db.commit()
    except Exception:
        db.rollback()  # colisiones de uq_friendship_pair: ignorar

    # ── 55 carreras publicadas con resultados ──
    code_used = set()
    for i in range(55):
        rdate = today - timedelta(days=random.randint(3, 400))
        dists = random.choice([[5.0, 10.0], [10.0, 21.0], [5.0], [10.0], [5.0, 10.0, 21.0]])
        name = f"{random.choice(RACE_NAMES)} {random.choice(CITIES)} {rdate.year}"
        code = "".join(random.choices("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", k=6))
        while code in code_used:
            code = "".join(random.choices("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", k=6))
        code_used.add(code)
        race = PublishedRace(source_id=f"seed-race-{i}", code=code, name=name,
                             location=random.choice(CITIES), race_date=rdate,
                             distances=",".join(str(d) for d in dists),
                             published_at=now - timedelta(days=random.randint(1, 380)))
        db.add(race); db.flush()

        participants = random.sample(users, random.randint(60, 280))
        # incluir al demo en algunas carreras
        if i < 6:
            participants = [demo] + participants
        by_dist = {d: [] for d in dists}
        for p in participants:
            by_dist[random.choice(dists)].append(p)
        bib = 100
        for d, plist in by_dist.items():
            base_pace = {5.0: 300, 10.0: 320, 21.0: 345}.get(d, 330)
            results = []
            for p in plist:
                gender = getattr(p, "_gender", random.choice(["M", "F"]))
                age = getattr(p, "_age", random.randint(20, 55))
                pace = base_pace + random.uniform(-25, 70)
                net_ns = int(d * pace * 1_000_000_000)
                results.append((p, net_ns, cat_for(gender, age)))
            results.sort(key=lambda r: r[1])
            for pos, (p, net_ns, cat) in enumerate(results, start=1):
                bib += 1
                db.add(PublishedResult(
                    race_id=race.id, bib_number=str(bib), full_name=p.full_name,
                    category=cat, club=random.choice(CLUBS), distance_km=d,
                    net_time_ns=net_ns, finish_time_ns=net_ns, position=pos, status="FINISHER",
                    email_hash=hashlib.sha256(p.email.encode()).hexdigest(),
                ))
        db.commit()

    n_users = db.query(PortalUser).count()
    n_acts = db.query(Activity).count()
    n_races = db.query(PublishedRace).count()
    n_results = db.query(PublishedResult).count()
    n_friends = db.query(Friendship).count()
    db.close()
    print(f"OK · usuarios={n_users} actividades={n_acts} amistades={n_friends} "
          f"carreras={n_races} resultados={n_results}")


if __name__ == "__main__":
    main()
