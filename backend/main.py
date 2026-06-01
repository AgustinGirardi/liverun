import sys
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager

from backend.core.database import init_db
from backend.api.routes import router

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield

app = FastAPI(title="ChronoTrack API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api/v1")

# ── Static files (frontend) ───────────────────────────────────────────────────
# En modo frozen (PyInstaller) los archivos están en sys._MEIPASS.
# En modo desarrollo están en ../frontend/dist.

if getattr(sys, "frozen", False):
    STATIC = Path(sys._MEIPASS) / "frontend" / "dist"
else:
    STATIC = Path(__file__).parent.parent / "frontend" / "dist"

if STATIC.exists():
    app.mount("/assets", StaticFiles(directory=STATIC / "assets"), name="assets")

    @app.get("/icons.svg")
    async def icons():
        return FileResponse(STATIC / "icons.svg")

    @app.get("/favicon.svg")
    async def favicon():
        return FileResponse(STATIC / "favicon.svg")

    @app.get("/")
    async def serve_root():
        return FileResponse(STATIC / "index.html")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # No interceptar rutas de la API
        if full_path.startswith("api/"):
            from fastapi import HTTPException
            raise HTTPException(404)
        file = STATIC / full_path
        if file.exists() and file.is_file():
            return FileResponse(file)
        return FileResponse(STATIC / "index.html")

@app.get("/health")
async def health():
    return {"status": "ok", "service": "ChronoTrack", "version": "2.0.0"}
