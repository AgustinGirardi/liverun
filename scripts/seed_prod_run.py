"""Seed de corredores Run en PRODUCCIÓN (vía API pública) para poblar el ranking
mundial. Respeta los rate limits con pausas. Datos de prueba, reversibles.

Uso:  .venv/Scripts/python.exe scripts/seed_prod_run.py [TARGET_USERNAME]
Si pasás TARGET_USERNAME, ~15 corredores le mandan solicitud de amistad
(para poblar también tu ranking de Amigos).
"""
import json
import random
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = "https://chronotrack-portal.onrender.com"
N_USERS = 120
random.seed(7)

FIRST = ["Lucas","Lucia","Mateo","Sofia","Diego","Valentina","Juan","Camila","Tomas","Martina",
         "Nicolas","Florencia","Bruno","Julieta","Santiago","Micaela","Gonzalo","Carla","Federico","Romina",
         "Joaquin","Antonella","Ramiro","Paula","Ignacio","Belen","Emiliano","Daniela","Facundo","Rocio",
         "Pablo","Agostina","Matias","Brenda","Franco","Luciana","Gaston","Ailen","Leandro","Abril"]
LAST = ["Gomez","Fernandez","Rodriguez","Lopez","Martinez","Garcia","Perez","Sanchez","Romero","Sosa",
        "Torres","Alvarez","Ruiz","Ramirez","Flores","Acosta","Benitez","Medina","Suarez","Herrera",
        "Aguirre","Pereyra","Gimenez","Ibarra","Cabrera","Rojas","Molina","Ortiz","Silva","Nunez"]


def req(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    for attempt in range(6):
        try:
            with urllib.request.urlopen(r, timeout=30) as resp:
                return resp.status, json.loads(resp.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            if e.code == 429:  # rate limit → esperar y reintentar
                time.sleep(8)
                continue
            return e.code, None
        except Exception:
            time.sleep(3)
    return 0, None


def main():
    target = sys.argv[1].strip().lower() if len(sys.argv) > 1 else None
    used = set()
    created = []
    for i in range(N_USERS):
        fn, ln = random.choice(FIRST), random.choice(LAST)
        uname = f"{fn}.{ln}".lower()
        while uname in used:
            uname = f"{fn}.{ln}{random.randint(1,999)}".lower()
        used.add(uname)
        email = f"demo.{uname}@chronotrack.run"
        st, data = req("POST", "/api/auth/register",
                       {"email": email, "password": "corremos2026", "full_name": f"{fn} {ln}"})
        if not data or "token" not in data:
            continue
        token = data["token"]
        req("PATCH", "/api/run/profile", {"username": uname}, token=token)
        # actividades: 2 esta semana, 2 la anterior
        for d_ago in random.sample(range(0, 6), 2) + random.sample(range(7, 13), 2):
            day = datetime.now(timezone.utc) - timedelta(days=d_ago)
            dist_km = round(random.choice([4, 5, 6, 8, 10, 12]) + random.uniform(-0.5, 1.0), 2)
            pace = random.uniform(290, 370)
            started = day.replace(hour=7, minute=random.randint(0, 59), second=0, microsecond=0)
            req("POST", "/api/run/activities", {
                "client_uuid": f"prodseed-{uname}-{d_ago}",
                "started_at": started.isoformat(),
                "duration_s": int(dist_km * pace),
                "distance_m": dist_km * 1000.0,
                "avg_pace_s_per_km": round(pace, 1),
            }, token=token)
        created.append((uname, token))
        if (i + 1) % 20 == 0:
            print(f"  {i+1}/{N_USERS} usuarios…", flush=True)
            time.sleep(35)  # respetar rate limit de register (40/60s)

    print(f"creados {len(created)} corredores con salidas", flush=True)

    if target:
        sent = 0
        for uname, token in created[:15]:
            st, _ = req("POST", "/api/run/friends/request", {"username": target}, token=token)
            if st in (200, 201):
                sent += 1
            time.sleep(1)
        print(f"solicitudes de amistad enviadas a '{target}': {sent}", flush=True)


if __name__ == "__main__":
    main()
