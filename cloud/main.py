"""ChronoTrack Cloud — portal público de resultados.

Roles:
  - Organizador: publica resultados vía POST /api/publish (protegido por API key).
  - Corredor:   crea cuenta, reclama sus resultados (dorsal + apellido) y ve su historial.
"""

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from cloud import mailer
from cloud.auth import router as auth_router
from cloud.billing_routes import router as billing_router
from cloud.claims import router as claims_router
from cloud.db import SessionLocal, init_db
from cloud.deps import PUBLIC_URL, avisar_si_multiworker, en_produccion
from cloud.google_auth import router as google_router
from cloud.migraciones import _ensure_admins, migrar_esquema
from cloud.organizadores import router as organizadores_router
from cloud.publish import PUBLISH_API_KEY, router as publish_router
from cloud.run import avatar_dir, router as run_router
from cloud.search import router as search_router


# Docs interactivas: utiles en desarrollo, pero en produccion son un catalogo
# gratis de los endpoints de admin y organizador para cualquier escaneo
# automatizado. CT_PRODUCCION=1 (o RENDER, que setea Render) lo marca; en local
# siguen disponibles.
_EN_PRODUCCION = en_produccion()


@asynccontextmanager
async def _lifespan(_app):
    # Reemplaza al @app.on_event("startup") deprecado. _startup se resuelve
    # recién al arrancar, así que puede estar definida más abajo.
    _startup()
    yield


app = FastAPI(
    lifespan=_lifespan,
    title="LiveRun Cloud",
    version="1.0",
    docs_url=None if _EN_PRODUCCION else "/docs",
    redoc_url=None if _EN_PRODUCCION else "/redoc",
    openapi_url=None if _EN_PRODUCCION else "/openapi.json",
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[PUBLIC_URL, "http://localhost:8002", "http://127.0.0.1:8002"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# Ni script-src ni style-src llevan 'unsafe-inline': el portal engancha sus
# acciones con data-act/data-submit y un solo listener (static/js/ui/acciones.js),
# y las medidas dinámicas (alto de las barras, ancho del cupo) viajan en data-*
# y se aplican por CSSOM (static/js/ui/componentes.js, iniciarMedidas). Así un
# HTML inyectado no puede ejecutar nada ni reestilizar la página.
# img-src incluye https: por las fotos de perfil de Google, que se guardan con
# su URL completa (lh3.googleusercontent.com).
_CSP = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self'; "
    "img-src 'self' https: data:; "
    "connect-src 'self'; "
    "object-src 'none'; "
    "base-uri 'none'; "
    "form-action 'self'; "
    "frame-ancestors 'none'"
)


def _cache_control(path: str) -> Optional[str]:
    """Caché de los archivos del portal. Sin esta cabecera el navegador aplica
    su heurística (un 10 % de la edad del archivo) y, después de publicar,
    podía juntar un index.html nuevo con un app.js viejo. HTML, JS y CSS se
    revalidan siempre (un 304 con ETag cuesta poco); las imágenes duran un día."""
    if path.startswith("/api/"):
        return None
    if path == "/" or path.endswith((".html", ".js", ".css")):
        return "no-cache"
    if path.endswith((".svg", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".woff2")):
        return "public, max-age=86400"
    return None


@app.middleware("http")
async def _security_headers(request: Request, call_next):
    """Cabeceras defensivas: sin sniffing de content-type (avatares subidos),
    sin embeber el portal en iframes de terceros, referrer mínimo."""
    resp = await call_next(request)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    resp.headers.setdefault("Content-Security-Policy", _CSP)
    cache = _cache_control(request.url.path)
    if cache:
        resp.headers.setdefault("Cache-Control", cache)
    if _EN_PRODUCCION:
        # Solo en produccion: en local el portal se sirve por http y el HSTS
        # dejaria el navegador forzando https contra localhost.
        resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return resp


@app.get("/api/health", include_in_schema=False)
def health():
    """Chequeo de vida para Render: confirma que la base responde, sin listar datos."""
    from sqlalchemy import text

    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
    except Exception:
        raise HTTPException(503, "Base de datos no disponible")
    return {"status": "ok"}


def _startup():
    # En producción (CT_PRODUCCION=1, o RENDER en Render) NO arrancar con secretos
    # por defecto: tokens y publicación quedarían falsificables. Fallar temprano y claro.
    if en_produccion():
        from cloud.security import SECRET

        if SECRET == "dev-insecure-secret-change-me" or PUBLISH_API_KEY == "dev-publish-key-change-me":
            raise RuntimeError(
                "Faltan secretos en producción: definí CT_CLOUD_SECRET y CT_PUBLISH_KEY "
                "(Render los genera vía render.yaml; en Cloud Run vienen de Secret Manager)."
            )
    if en_produccion() and not mailer.configurado():
        # No se frena el arranque: sin mails solo se pierden la verificación
        # y el reset de contraseña, no el resto del portal.
        mailer.log.warning(
            "CT_SMTP_HOST no está configurado: los mails de verificación y de "
            "'olvidé mi contraseña' NO van a salir (ver DEPLOY.md)."
        )
    avisar_si_multiworker()
    init_db()
    migrar_esquema()
    _ensure_admins()


# ── Routers por dominio ──────────────────────────────────────────────────────
app.include_router(publish_router)
app.include_router(search_router)
app.include_router(auth_router)
app.include_router(claims_router)
app.include_router(run_router)
app.include_router(google_router)
app.include_router(billing_router)
app.include_router(organizadores_router)


# ── Estáticos: avatares y portal (al final para no tapar /api) ────────────────
app.mount("/avatars", StaticFiles(directory=str(avatar_dir())), name="avatars")

_static = Path(__file__).parent / "static"
if _static.exists():
    app.mount("/", StaticFiles(directory=str(_static), html=True), name="portal")
