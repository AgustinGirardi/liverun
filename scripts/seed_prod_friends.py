"""Crea ~15 corredores de prueba en PRODUCCIÓN con salidas de esta semana y les
hace mandar una solicitud de amistad a un usuario objetivo, para poblar su
ranking de Amigos. Datos de prueba, reversibles.

Uso:  .venv/Scripts/python.exe scripts/seed_prod_friends.py <TARGET_USERNAME>
"""
import json
import random
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = "https://chronotrack-portal.onrender.com"
random.seed(99)

NAMES = [("Martin","Costa"),("Sofia","Vega"),("Bruno","Ramos"),("Lucia","Diaz"),("Tomas","Rios"),
         ("Carla","Mora"),("Diego","Luna"),("Paula","Soto"),("Nacho","Cruz"),("Vale","Pena"),
         ("Gonza","Real"),("Mica","Leon"),("Facu","Sol"),("Romi","Mar"),("Lauti","Paz")]


def req(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    for _ in range(6):
        try:
            with urllib.request.urlopen(r, timeout=30) as resp:
                return resp.status, json.loads(resp.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(8); continue
            return e.code, None
        except Exception:
            time.sleep(3)
    return 0, None


def main():
    if len(sys.argv) < 2:
        print("falta TARGET_USERNAME"); return
    target = sys.argv[1].strip().lower()
    sent = 0
    for i, (fn, ln) in enumerate(NAMES):
        uname = f"{fn}.{ln}".lower()
        email = f"amigo.{uname}@chronotrack.run"
        st, data = req("POST", "/api/auth/register",
                       {"email": email, "password": "corremos2026", "full_name": f"{fn} {ln}"})
        if not data or "token" not in data:
            # quizás ya existe (re-run): login
            st, data = req("POST", "/api/auth/login", {"email": email, "password": "corremos2026"})
            if not data or "token" not in data:
                continue
        token = data["token"]
        req("PATCH", "/api/run/profile", {"username": uname}, token=token)
        for d_ago in random.sample(range(0, 6), 3):
            day = datetime.now(timezone.utc) - timedelta(days=d_ago)
            dist_km = round(random.uniform(5, 12), 2)
            pace = random.uniform(300, 360)
            req("POST", "/api/run/activities", {
                "client_uuid": f"amigoseed-{uname}-{d_ago}",
                "started_at": day.replace(hour=8, minute=i, second=0, microsecond=0).isoformat(),
                "duration_s": int(dist_km * pace), "distance_m": dist_km * 1000.0,
                "avg_pace_s_per_km": round(pace, 1),
            }, token=token)
        st, _ = req("POST", "/api/run/friends/request", {"username": target}, token=token)
        if st in (200, 201):
            sent += 1
        time.sleep(1)
    print(f"OK · {sent} solicitudes de amistad enviadas a '{target}'")


if __name__ == "__main__":
    main()
