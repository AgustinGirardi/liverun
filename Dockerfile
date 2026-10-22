# Portal público de LiveRun (cloud/) para Google Cloud Run.
# Un solo proceso: Cloud Run escala por instancias y el rate limit vive en
# memoria (ver DEPLOY.md: max-instances=1).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    CT_PRODUCCION=1 \
    CT_AVATAR_DIR=/data/avatars

WORKDIR /app

# Primero el lock: la capa de dependencias se reutiliza mientras no cambie.
COPY cloud/requirements.lock cloud/requirements.lock
RUN pip install -r cloud/requirements.lock

COPY cloud/ cloud/

# Sin root. /data/avatars es el punto de montaje del bucket de avatares.
RUN useradd --system --uid 10001 --no-create-home portal \
    && mkdir -p /data/avatars \
    && chown -R portal /data
USER portal

# Cloud Run inyecta PORT; 8080 es el valor por defecto de la plataforma.
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn cloud.main:app --host 0.0.0.0 --port ${PORT}"]
