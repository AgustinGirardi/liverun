"""Copia la base del portal (SQLite de Render) a Postgres sin perder nada.

Uso (desde la raíz del repo):

    python scripts/migrar_portal_a_postgres.py --origen sqlite:////ruta/a/cloud.db \\
        --destino "postgresql://usuario:clave@host/base?sslmode=require"

El destino también puede venir de la variable CT_DESTINO_DB, así la clave no queda
en el historial de la terminal. Se puede correr las veces que haga falta: si el
destino ya tiene datos se niega a seguir, salvo con --vaciar.

Qué hace:
  1. Si el origen es SQLite, trabaja sobre una COPIA (el archivo original no se
     toca) y le corre las migraciones de columnas, para que tenga el esquema actual.
  2. Crea el esquema en el destino y copia todas las tablas, en el orden de las
     claves foráneas, en una sola transacción: o entra todo o no entra nada.
  3. En Postgres reasigna las secuencias de los ids (sin eso el primer INSERT
     después de la copia choca con un id existente).
  4. Verifica cada tabla en origen y destino: cantidad de filas y un hash de su
     contenido. Si algo no coincide, sale con código 1.

Códigos de salida: 0 todo copiado y verificado, 1 no coincide, 2 no se pudo correr.
Los avatares no están en la base: se copian aparte (ver DEPLOY.md).
"""

import argparse
import hashlib
import os
import subprocess
import sys
import tempfile
from decimal import Decimal
from pathlib import Path

from sqlalchemy import create_engine, func, select, text
from sqlalchemy.engine import Engine

RAIZ = Path(__file__).resolve().parents[1]
if str(RAIZ) not in sys.path:
    sys.path.insert(0, str(RAIZ))

from cloud import models  # noqa: E402,F401  registra los modelos
from cloud.db import Base, normalizar_url  # noqa: E402

LOTE = 1000


class ErrorDeMigracion(Exception):
    """Algo impide migrar; el mensaje dice qué pasó y cómo seguir."""


def _es_sqlite(url: str) -> bool:
    return url.startswith("sqlite")


def _ruta_sqlite(url: str) -> Path:
    return Path(url.removeprefix("sqlite:///"))


def _url_visible(engine: Engine) -> str:
    return engine.url.render_as_string(hide_password=True)


def _tablas():
    return Base.metadata.sorted_tables


# ── 1. Origen al día ──────────────────────────────────────────────────────────


def preparar_origen(url: str, carpeta_temporal: Path) -> str:
    """Devuelve la URL desde la que se va a leer. Un origen SQLite se copia y se
    le corren las migraciones de columnas; otro motor se lee tal cual."""
    if not _es_sqlite(url):
        return url
    archivo = _ruta_sqlite(url)
    if not archivo.is_file():
        raise ErrorDeMigracion(f"No existe el archivo de origen {archivo}. Revisá --origen (sqlite:///<ruta>).")
    copia = carpeta_temporal / "origen.db"
    _copiar_sqlite(archivo, copia)
    entorno = {**os.environ, "CT_CLOUD_DB": f"sqlite:///{copia}"}
    codigo = "from cloud.db import init_db; from cloud.migraciones import migrar_esquema; init_db(); migrar_esquema()"
    r = subprocess.run([sys.executable, "-c", codigo], cwd=RAIZ, env=entorno, capture_output=True, text=True)
    if r.returncode != 0:
        raise ErrorDeMigracion(f"Fallaron las migraciones sobre la copia del origen:\n{r.stderr.strip()}")
    return f"sqlite:///{copia}"


def _copiar_sqlite(origen: Path, destino: Path) -> None:
    """Copia consistente aunque la base tenga un -wal pendiente (backup de SQLite)."""
    import sqlite3

    with sqlite3.connect(f"file:{origen.as_posix()}?mode=ro", uri=True) as src, sqlite3.connect(destino) as dst:
        src.backup(dst)
    dst.close()
    src.close()


# ── 2. Destino ────────────────────────────────────────────────────────────────


def _filas_por_tabla(engine: Engine) -> dict[str, int]:
    with engine.connect() as conn:
        return {t.name: conn.scalar(select(func.count()).select_from(t)) for t in _tablas()}


def preparar_destino(destino: Engine, vaciar: bool) -> None:
    Base.metadata.create_all(destino)
    con_datos = {nombre: n for nombre, n in _filas_por_tabla(destino).items() if n}
    if not con_datos:
        return
    if not vaciar:
        detalle = ", ".join(f"{n} ({c})" for n, c in con_datos.items())
        raise ErrorDeMigracion(
            f"El destino ya tiene datos: {detalle}. Si es un ensayo anterior, volvé a correr con --vaciar."
        )
    with destino.begin() as conn:
        if destino.dialect.name == "postgresql":
            nombres = ", ".join(destino.dialect.identifier_preparer.quote(t.name) for t in _tablas())
            conn.execute(text(f"TRUNCATE {nombres} RESTART IDENTITY CASCADE"))
        else:
            for t in reversed(_tablas()):
                conn.execute(t.delete())


# ── 3. Copia ──────────────────────────────────────────────────────────────────


def copiar(origen: Engine, destino: Engine) -> dict[str, int]:
    copiadas = {}
    try:
        with origen.connect() as src, destino.begin() as dst:
            for t in _tablas():
                n = 0
                resultado = src.execution_options(stream_results=True).execute(select(t))
                for lote in resultado.mappings().partitions(LOTE):
                    dst.execute(t.insert(), [dict(fila) for fila in lote])
                    n += len(lote)
                copiadas[t.name] = n
            _reasignar_secuencias(dst)
    except ErrorDeMigracion:
        raise
    except Exception as e:
        raise ErrorDeMigracion(
            f"Falló la copia (no se guardó nada en el destino): {e}. "
            "Lo más común: un valor más largo que su VARCHAR o un dato que Postgres no acepta."
        ) from e
    return copiadas


def _reasignar_secuencias(conn) -> None:
    """Postgres: deja cada secuencia en el máximo id copiado (o sin usar si la tabla está vacía)."""
    if conn.dialect.name != "postgresql":
        return
    for t in _tablas():
        pk = [c for c in t.primary_key.columns if c.type.python_type is int]
        if len(pk) != 1:
            continue
        tabla = conn.dialect.identifier_preparer.format_table(t)
        columna = conn.dialect.identifier_preparer.quote(pk[0].name)
        conn.execute(
            text(
                f"SELECT setval(pg_get_serial_sequence(:tabla, :columna), "
                f"COALESCE((SELECT MAX({columna}) FROM {tabla}), 1), "
                f"(SELECT MAX({columna}) FROM {tabla}) IS NOT NULL)"
            ),
            {"tabla": tabla, "columna": pk[0].name},
        )


# ── 4. Verificación ───────────────────────────────────────────────────────────


def _canonico(valor) -> str:
    """Texto estable de un valor, igual para SQLite y Postgres (p. ej. Decimal('12.5') y Decimal('12.50'))."""
    if valor is None:
        return "\x00"
    if isinstance(valor, Decimal):
        return format(valor.normalize(), "f")
    if isinstance(valor, float):
        return repr(valor)
    if isinstance(valor, bool):
        return str(int(valor))
    return str(valor)


def huella(engine: Engine, tabla) -> tuple[int, str]:
    """(cantidad de filas, sha256 del contenido ordenado por clave primaria)."""
    h = hashlib.sha256()
    n = 0
    orden = list(tabla.primary_key.columns) or list(tabla.columns)
    with engine.connect() as conn:
        for fila in conn.execute(select(tabla).order_by(*orden)):
            h.update("\x1f".join(_canonico(v) for v in fila).encode("utf-8"))
            h.update(b"\x1e")
            n += 1
    return n, h.hexdigest()


def verificar(origen: Engine, destino: Engine) -> list[str]:
    """Una línea por tabla que no coincide; lista vacía si todo está igual."""
    problemas = []
    for t in _tablas():
        a, b = huella(origen, t), huella(destino, t)
        if a != b:
            problemas.append(
                f"{t.name}: origen {a[0]} filas, destino {b[0]} filas, contenido {'igual' if a[1] == b[1] else 'distinto'}"
            )
    return problemas


# ── Entrada ───────────────────────────────────────────────────────────────────


def migrar(url_origen: str, url_destino: str, vaciar: bool = False, salida=print) -> int:
    url_origen, url_destino = normalizar_url(url_origen), normalizar_url(url_destino)
    if url_origen == url_destino:
        raise ErrorDeMigracion("El origen y el destino son la misma base.")
    with tempfile.TemporaryDirectory(prefix="migrar_portal_") as tmp:
        origen = create_engine(preparar_origen(url_origen, Path(tmp)))
        destino = create_engine(url_destino, pool_pre_ping=True)
        try:
            salida(f"Origen:  {_url_visible(origen)}")
            salida(f"Destino: {_url_visible(destino)}")
            preparar_destino(destino, vaciar)
            for nombre, n in copiar(origen, destino).items():
                salida(f"  copiada {nombre}: {n} filas")
            problemas = verificar(origen, destino)
        finally:
            origen.dispose()
            destino.dispose()
    if problemas:
        salida("NO COINCIDE:\n  " + "\n  ".join(problemas))
        return 1
    salida("Verificado: todas las tablas coinciden en cantidad y contenido.")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Copia la base del portal de SQLite a Postgres y la verifica.")
    ap.add_argument("--origen", required=True, help="URL SQLAlchemy de origen, p. ej. sqlite:////ruta/cloud.db")
    ap.add_argument("--destino", default=os.environ.get("CT_DESTINO_DB"), help="URL del Postgres (o CT_DESTINO_DB)")
    ap.add_argument("--vaciar", action="store_true", help="vacía el destino si ya tiene datos (ensayos repetidos)")
    args = ap.parse_args(argv)
    if not args.destino:
        print("Falta el destino: pasá --destino o definí CT_DESTINO_DB.", file=sys.stderr)
        return 2
    try:
        return migrar(args.origen, args.destino, vaciar=args.vaciar)
    except ErrorDeMigracion as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
