import sys
from pathlib import Path
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import text

# ── Ruta de la base de datos ──────────────────────────────────────────────────
# En modo frozen (PyInstaller), la BD se guarda junto al .exe para persistir entre ejecuciones.
# En modo desarrollo, se guarda en la raíz del proyecto.

if getattr(sys, "frozen", False):
    # Directorio del ejecutable (no del temp de extracción)
    DB_PATH = Path(sys.executable).parent / "chronotrack.db"
else:
    DB_PATH = Path(__file__).parent.parent.parent / "chronotrack.db"

DATABASE_URL = f"sqlite+aiosqlite:///{DB_PATH}"

engine = create_async_engine(DATABASE_URL, echo=False, pool_pre_ping=True)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise

async def init_db():
    from backend.models.models import Base
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as session:
        await session.execute(text("PRAGMA journal_mode=WAL"))
        await session.execute(text("PRAGMA foreign_keys=ON"))
        await session.commit()

        # ── Migraciones incrementales ─────────────────────────────────────────
        # SQLite no soporta ADD COLUMN IF NOT EXISTS, así que capturamos el error
        # si la columna ya existe (idempotente en reinicios).

        migrations = [
            "ALTER TABLE registrations ADD COLUMN status VARCHAR(10) NOT NULL DEFAULT 'OK'",
            "ALTER TABLE runners ADD COLUMN dni VARCHAR(20)",
            "ALTER TABLE registrations ADD COLUMN distance_km FLOAT",
            "ALTER TABLE runners ADD COLUMN email VARCHAR(200)",
        ]
        for sql in migrations:
            try:
                await session.execute(text(sql))
                await session.commit()
            except Exception:
                await session.rollback()
