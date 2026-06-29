"""Limpieza total de datos del portal cloud — deja todo en cero MENOS una cuenta.

Pensado para correr en la Render Shell del servicio chronotrack-portal, donde
CT_CLOUD_DB apunta al SQLite del disco persistente (/var/data/cloud.db).

Qué hace:
  1. Backup consistente de la base (online backup API → cloud.db.bak.<ts>).
  2. Borra TODAS las filas de todas las tablas de datos, salvo la fila de
     portal_users cuyo email == KEEP_EMAIL (se conserva el login + sus flags).
     "Cero total": también se borran las salidas (run_activities) de esa cuenta.
  3. Limpia los avatares de los demás usuarios del disco.
  4. VACUUM para compactar.

Borra explícitamente las tablas hijas (SQLite NO aplica ON DELETE CASCADE si no
está PRAGMA foreign_keys=ON por conexión), así no quedan filas huérfanas.

Uso:   python scripts/wipe_cloud_data.py
Recuperar:  reemplazar cloud.db por el cloud.db.bak.<ts> generado.
"""
import os
import sqlite3
import sys
import time
from pathlib import Path

KEEP_EMAIL = os.environ.get("KEEP_EMAIL", "agustingirardi1@gmail.com")

# Orden hijas → padres (por las FKs). portal_users se trata aparte (se conserva 1).
DATA_TABLES = [
    "claims",
    "published_results",
    "published_races",
    "run_activities",
    "run_friendships",
    "run_coupon_redemptions",
    "run_coupons",
    "run_billing_payments",
    "run_billing_subscriptions",
]


def db_path() -> str:
    url = os.environ.get("CT_CLOUD_DB", "sqlite:////var/data/cloud.db")
    if not url.startswith("sqlite"):
        sys.exit(f"CT_CLOUD_DB no es SQLite ({url}); este script es solo para SQLite.")
    p = url.removeprefix("sqlite:///")  # sqlite:////var/... -> /var/...
    if not Path(p).exists():
        sys.exit(f"No existe la base en {p}")
    return p


def counts(cur) -> dict:
    out = {}
    for t in DATA_TABLES + ["portal_users"]:
        try:
            out[t] = cur.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        except sqlite3.OperationalError:
            out[t] = "—"  # tabla inexistente
    return out


def main():
    path = db_path()
    con = sqlite3.connect(path, timeout=30)
    cur = con.cursor()
    cur.execute("PRAGMA busy_timeout=30000")  # el server de prod sigue conectado

    keep = cur.execute(
        "SELECT id, email FROM portal_users WHERE lower(email)=?",
        (KEEP_EMAIL.lower(),),
    ).fetchone()
    if not keep:
        sys.exit(f"ABORT: no encontré la cuenta {KEEP_EMAIL}. No borro nada.")
    keep_id = keep[0]

    print(f"Base: {path}")
    print(f"Conservo cuenta id={keep_id} <{keep[1]}>\n")
    print("ANTES:", counts(cur))

    # 1) Backup consistente (incluye WAL) vía online backup API.
    ts = time.strftime("%Y%m%d-%H%M%S")
    backup_path = f"{path}.bak.{ts}"
    bak = sqlite3.connect(backup_path)
    with bak:
        con.backup(bak)
    bak.close()
    print(f"\nBackup: {backup_path}")

    # 2) Borrado total salvo la cuenta a conservar.
    cur.execute("PRAGMA foreign_keys=OFF")
    for t in DATA_TABLES:
        try:
            cur.execute(f"DELETE FROM {t}")
        except sqlite3.OperationalError as e:
            print(f"  (salteo {t}: {e})")
    cur.execute("DELETE FROM portal_users WHERE id <> ?", (keep_id,))
    con.commit()
    try:
        cur.execute("VACUUM")  # compacta; requiere lock exclusivo
        con.commit()
    except sqlite3.OperationalError as e:
        print(f"  (VACUUM salteado, no afecta el borrado: {e})")

    print("DESPUES:", counts(cur))
    con.close()

    # 3) Avatares de otros usuarios (mismo disco que la base).
    avatars = Path(path).parent / "avatars"
    removed = 0
    if avatars.is_dir():
        for f in avatars.iterdir():
            if f.is_file() and not f.name.startswith(f"{keep_id}."):
                f.unlink()
                removed += 1
    print(f"Avatares de otros usuarios borrados: {removed}")
    print("\nOK: limpieza completa. Si algo salio mal, restaura el .bak.")


if __name__ == "__main__":
    main()
