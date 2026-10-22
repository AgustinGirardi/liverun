from sqlalchemy import inspect, text
from cloud.db import engine
from cloud.models import PublishedResult


def test_published_result_has_email_hash_column():
    cols = {c.name for c in PublishedResult.__table__.columns}
    assert "email_hash" in cols


def test_migration_adds_column_to_existing_table():
    # Simula una tabla vieja sin email_hash, luego corre la migración.
    from cloud.migraciones import _ensure_email_hash_column

    with engine.begin() as conn:
        # Postgres no deja borrar una tabla referenciada (claims) sin CASCADE; SQLite no lo admite.
        cascade = "" if engine.dialect.name == "sqlite" else " CASCADE"
        conn.execute(text(f"DROP TABLE IF EXISTS published_results{cascade}"))
        conn.execute(
            text(
                "CREATE TABLE published_results ("
                "id INTEGER PRIMARY KEY, race_id INTEGER, bib_number VARCHAR, "
                "full_name VARCHAR, category VARCHAR, club VARCHAR, distance_km FLOAT, "
                "net_time_ns BIGINT, finish_time_ns BIGINT, position INTEGER, status VARCHAR)"
            )
        )
    _ensure_email_hash_column()  # idempotente
    _ensure_email_hash_column()  # segunda llamada no debe romper
    insp = inspect(engine)
    cols = {c["name"] for c in insp.get_columns("published_results")}
    assert "email_hash" in cols
    idxs = [i["name"] for i in inspect(engine).get_indexes("published_results")]
    assert "ix_published_results_email_hash" in idxs
