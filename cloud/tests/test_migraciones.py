"""Las migraciones de arranque (cloud/migraciones.py) tienen que andar igual en
SQLite (Render, escritorio) y en Postgres (Cloud Run). Con CT_TEST_DB apuntando
a Postgres, estos mismos tests corren contra ese motor."""

from datetime import datetime

from sqlalchemy import inspect, select, text

from cloud import migraciones
from cloud.db import engine
from cloud.models import Activity, PortalUser
from cloud.run import _dia_argentino


def _usuarios_de_antes(conn) -> None:
    """Deja portal_users como era antes de las columnas de Run (tabla vieja)."""
    cascade = "" if engine.dialect.name == "sqlite" else " CASCADE"
    conn.execute(text(f"DROP TABLE IF EXISTS portal_users{cascade}"))
    conn.execute(
        text(
            "CREATE TABLE portal_users (id INTEGER PRIMARY KEY, email VARCHAR(255) NOT NULL, "
            "password_hash VARCHAR(255) NOT NULL, full_name VARCHAR(200), created_at TIMESTAMP)"
        )
    )
    conn.execute(text("INSERT INTO portal_users (id, email, password_hash) VALUES (1, 'viejo@test.com', 'x')"))


def _columnas_de_usuarios() -> set[str]:
    return {c["name"] for c in inspect(engine).get_columns("portal_users")}


def test_columnas_de_una_tabla_que_no_existe_es_vacio():
    with engine.connect() as conn:
        assert migraciones._columnas(conn, "no_existe") == []


def test_columnas_lista_los_nombres():
    with engine.connect() as conn:
        assert {"id", "email", "avatar_url"} <= set(migraciones._columnas(conn, "portal_users"))


def test_agrega_las_columnas_de_run_a_una_tabla_vieja_y_es_idempotente():
    with engine.begin() as conn:
        _usuarios_de_antes(conn)
    for _ in range(2):
        migraciones._ensure_run_columns()
        migraciones._ensure_password_set_column()
    assert {"google_id", "username", "weekly_goal", "is_admin", "email_verified_at", "password_set"} <= (
        _columnas_de_usuarios()
    )
    with engine.connect() as conn:
        fila = conn.execute(text("SELECT weekly_goal, is_admin, password_set FROM portal_users WHERE id = 1")).one()
    assert tuple(fila) == (3, 0, 1)  # los defaults valen para la cuenta que ya existía


def test_las_cuentas_de_google_quedan_verificadas():
    with engine.begin() as conn:
        _usuarios_de_antes(conn)
    migraciones._ensure_run_columns()
    with engine.begin() as conn:
        conn.execute(text("UPDATE portal_users SET google_id = 'g-1' WHERE id = 1"))
    migraciones._ensure_run_columns()
    with engine.connect() as conn:
        verificado = conn.execute(text("SELECT email_verified_at FROM portal_users WHERE id = 1")).scalar()
    assert verificado is not None
    if isinstance(verificado, str):  # SQLite devuelve el texto crudo con text()
        verificado = datetime.fromisoformat(verificado)
    assert abs((datetime.utcnow() - verificado).total_seconds()) < 3600  # UTC, no la zona del servidor


def test_los_avatares_con_host_pasan_a_ruta_relativa(db):
    db.add_all(
        [
            PortalUser(email="a@t.com", password_hash="x", avatar_url="https://viejo.onrender.com/avatars/7.jpg?v=1"),
            PortalUser(email="b@t.com", password_hash="x", avatar_url="/avatars/8.png?v=2"),
            PortalUser(email="c@t.com", password_hash="x", avatar_url="https://lh3.googleusercontent.com/a/foto"),
            PortalUser(email="d@t.com", password_hash="x", avatar_url=None),
        ]
    )
    db.commit()
    for _ in range(2):
        migraciones._migrar_avatares_a_relativo()
    with engine.connect() as conn:
        urls = dict(conn.execute(text("SELECT email, avatar_url FROM portal_users")).all())
    assert urls == {
        "a@t.com": "/avatars/7.jpg?v=1",
        "b@t.com": "/avatars/8.png?v=2",
        "c@t.com": "https://lh3.googleusercontent.com/a/foto",
        "d@t.com": None,
    }


def test_el_dia_argentino_cae_en_el_dia_anterior_de_madrugada_utc(db):
    """02:30 UTC son las 23:30 del día anterior en Argentina: tiene que dar el mismo
    día en los dos motores (SQLite: date(x, '-10800 seconds'); Postgres: date(x + interval))."""
    user = PortalUser(email="r@t.com", password_hash="x")
    db.add(user)
    db.flush()
    db.add(
        Activity(
            user_id=user.id, client_uuid="u1", started_at=datetime(2026, 10, 21, 2, 30), duration_s=60, distance_m=1
        )
    )
    db.add(
        Activity(
            user_id=user.id, client_uuid="u2", started_at=datetime(2026, 10, 21, 15, 0), duration_s=60, distance_m=1
        )
    )
    db.commit()
    dias = db.scalars(
        select(_dia_argentino(db, Activity.started_at, datetime(2026, 10, 19))).order_by(Activity.started_at)
    ).all()
    assert [str(d) for d in dias] == ["2026-10-20", "2026-10-21"]
