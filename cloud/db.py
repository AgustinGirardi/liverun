"""Base de datos del servicio cloud (separada de la app de escritorio).
SQLite por defecto (escritorio, desarrollo, Render); Postgres cambiando CT_CLOUD_DB."""

import os
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase


def normalizar_url(url: str) -> str:
    """Neon (y la mayoría de los proveedores) entrega postgresql://...; SQLAlchemy
    lo asocia a psycopg2, que no usamos. Lo lleva al driver psycopg 3."""
    for prefijo in ("postgres://", "postgresql://"):
        if url.startswith(prefijo):
            return "postgresql+psycopg://" + url[len(prefijo) :]
    return url


DB_URL = normalizar_url(os.environ.get("CT_CLOUD_DB", f"sqlite:///{Path(__file__).parent / 'cloud.db'}"))

# Postgres (Neon, en Cloud Run): una sola instancia con pocos hilos alcanza con un
# pool chico, y pre_ping descarta las conexiones que Neon cierra al suspender.
_ARGS_POR_MOTOR = (
    {"connect_args": {"check_same_thread": False}}
    if DB_URL.startswith("sqlite")
    else {"pool_size": 5, "max_overflow": 5, "pool_pre_ping": True, "pool_recycle": 300}
)

engine = create_engine(DB_URL, **_ARGS_POR_MOTOR)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from cloud import models  # noqa: F401 — registra los modelos

    Base.metadata.create_all(engine)
