"""Base de datos del servicio cloud (separada de la app de escritorio).
SQLite síncrono para el MVP; migrable a Postgres cambiando la URL."""
import os
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

DB_URL = os.environ.get("CT_CLOUD_DB", f"sqlite:///{Path(__file__).parent / 'cloud.db'}")

engine = create_engine(
    DB_URL,
    connect_args={"check_same_thread": False} if DB_URL.startswith("sqlite") else {},
)
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
