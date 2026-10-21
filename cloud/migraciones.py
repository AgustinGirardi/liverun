"""Migraciones livianas de columnas e índices que corren al arrancar el portal."""

from cloud.deps import admin_emails
from cloud.nombres import normalizar_nombre


def _ensure_run_columns():
    """Migración suave para SQLite: columnas de ChronoTrack Run en portal_users.
    Mismo criterio que _ensure_email_hash_column. Idempotente."""
    from sqlalchemy import text
    from cloud.db import engine

    with engine.begin() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(portal_users)"))]
        if not cols:
            return  # tabla inexistente: create_all la crea completa
        wanted = {
            "google_id": "ALTER TABLE portal_users ADD COLUMN google_id VARCHAR(64)",
            "username": "ALTER TABLE portal_users ADD COLUMN username VARCHAR(30)",
            "weekly_goal": "ALTER TABLE portal_users ADD COLUMN weekly_goal INTEGER NOT NULL DEFAULT 3",
            "avatar_url": "ALTER TABLE portal_users ADD COLUMN avatar_url VARCHAR(400)",
            "is_admin": "ALTER TABLE portal_users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0",
            "premium_until": "ALTER TABLE portal_users ADD COLUMN premium_until DATETIME",
            "pending_discount_percent": "ALTER TABLE portal_users ADD COLUMN pending_discount_percent INTEGER",
            "tokens_valid_from": "ALTER TABLE portal_users ADD COLUMN tokens_valid_from INTEGER",
            "email_verified_at": "ALTER TABLE portal_users ADD COLUMN email_verified_at DATETIME",
        }
        for col, ddl in wanted.items():
            if col not in cols:
                conn.execute(text(ddl))
        # Las cuentas con Google ya tienen el email verificado (lo verificó
        # Google). Las de solo contraseña quedan sin verificar. Idempotente:
        # solo toca las que siguen en NULL. CURRENT_TIMESTAMP de SQLite es UTC.
        conn.execute(
            text(
                "UPDATE portal_users SET email_verified_at = CURRENT_TIMESTAMP "
                "WHERE google_id IS NOT NULL AND email_verified_at IS NULL"
            )
        )
        # SQLite: UNIQUE de columnas nuevas via indices (ALTER no admite constraints)
        conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ux_portal_users_username ON portal_users (username)"))
        conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ux_portal_users_google_id ON portal_users (google_id)"))


def _ensure_admins():
    """Sincroniza is_admin con CT_ADMIN_EMAILS (CSV). Idempotente: corre en
    cada arranque, así agregar o sacar un admin es solo tocar la env var.

    Solo se promueve a cuentas con el email verificado (link del mail,
    reset de contraseña o Google): el registro no lo verifica, así que
    cualquiera podía crear la cuenta de un email de admin antes que su dueño y
    quedar como admin en el próximo arranque. Y quien ya no está en la lista
    (o no está verificado ni tiene Google) pierde el admin: antes la marca
    quedaba para siempre.
    """
    emails = sorted(admin_emails())
    from sqlalchemy import text, bindparam
    from cloud.db import engine

    with engine.begin() as conn:
        if emails:
            conn.execute(
                text(
                    "UPDATE portal_users SET is_admin=1 "
                    "WHERE lower(email) IN :emails "
                    "AND (google_id IS NOT NULL OR email_verified_at IS NOT NULL)"
                ).bindparams(bindparam("emails", expanding=True)),
                {"emails": emails},
            )
            conn.execute(
                text(
                    "UPDATE portal_users SET is_admin=0 WHERE is_admin=1 "
                    "AND (lower(email) NOT IN :emails "
                    "OR (google_id IS NULL AND email_verified_at IS NULL))"
                ).bindparams(bindparam("emails", expanding=True)),
                {"emails": emails},
            )
        else:
            conn.execute(text("UPDATE portal_users SET is_admin=0 WHERE is_admin=1"))


def _ensure_billing_columns():
    """Migración suave para SQLite: run_billing_payments.granted_s (cuánto
    premium sumó cada pago, para revocarlo si se devuelve). Columna nullable:
    un ADD COLUMN en SQLite no reescribe la tabla y los pagos viejos quedan en
    NULL (se asume un mes). Idempotente."""
    from sqlalchemy import text
    from cloud.db import engine

    with engine.begin() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(run_billing_payments)"))]
        if not cols:
            return  # tabla inexistente: create_all ya la crea con la columna
        if "granted_s" not in cols:
            conn.execute(text("ALTER TABLE run_billing_payments ADD COLUMN granted_s INTEGER"))


def _migrar_avatares_a_relativo():
    """Los avatares propios se guardaban con el host adentro, así que un cambio
    de dominio los rompía en la base. Los pasa a ruta relativa. Idempotente.
    No toca las fotos de Google: esas no contienen "/avatars/"."""
    from sqlalchemy import text
    from cloud.db import engine

    with engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE portal_users "
                "SET avatar_url = substr(avatar_url, instr(avatar_url, '/avatars/')) "
                "WHERE avatar_url LIKE '%/avatars/%' AND avatar_url NOT LIKE '/avatars/%'"
            )
        )


def _ensure_email_hash_column():
    """Migración suave para SQLite: agrega published_results.email_hash si falta.
    create_all() no altera tablas existentes, así que en bases ya creadas
    (p. ej. Render) hay que hacer el ALTER manualmente. Idempotente."""
    from sqlalchemy import text
    from cloud.db import engine

    with engine.begin() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(published_results)"))]
        if not cols:
            return  # tabla inexistente: create_all (ya corrió en init_db) la crea con la columna
        if "email_hash" not in cols:
            conn.execute(text("ALTER TABLE published_results ADD COLUMN email_hash VARCHAR(64)"))
            conn.execute(
                text("CREATE INDEX IF NOT EXISTS ix_published_results_email_hash ON published_results (email_hash)")
            )


def _ensure_name_norm_column(lote: int = 500):
    """Migración suave para SQLite: agrega published_results.name_norm y la
    completa para los resultados que ya estaban publicados. El relleno va en
    Python (SQLite no sabe sacar acentos) y por lotes, cada uno en su propia
    transacción, para no tener la base bloqueada de una sola vez. Idempotente:
    si no quedan filas en NULL, no hace nada."""
    from sqlalchemy import text
    from cloud.db import engine

    with engine.begin() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(published_results)"))]
        if not cols:
            return  # tabla inexistente: create_all ya la crea con la columna
        if "name_norm" not in cols:
            conn.execute(text("ALTER TABLE published_results ADD COLUMN name_norm VARCHAR(200)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_published_results_name_norm ON published_results (name_norm)"))
    while True:
        with engine.begin() as conn:
            filas = conn.execute(
                text("SELECT id, full_name FROM published_results WHERE name_norm IS NULL LIMIT :n"), {"n": lote}
            ).all()
            if not filas:
                return
            conn.execute(
                text("UPDATE published_results SET name_norm = :nn WHERE id = :id"),
                [{"id": fid, "nn": normalizar_nombre(nombre)} for fid, nombre in filas],
            )


def _ensure_category_position_column():
    """Migración suave para SQLite: agrega published_results.category_position.
    Mismo criterio que _ensure_email_hash_column. Idempotente."""
    from sqlalchemy import text
    from cloud.db import engine

    with engine.begin() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(published_results)"))]
        if not cols:
            return  # tabla inexistente: create_all ya la crea con la columna
        if "category_position" not in cols:
            conn.execute(text("ALTER TABLE published_results ADD COLUMN category_position INTEGER"))


def _ensure_owner_key_column():
    """Migracion suave para SQLite: agrega published_races.owner_key_hash.
    Las carreras que ya existian quedan en NULL y adoptan dueño la proxima vez
    que se republican, asi una base viva no se bloquea sola. Idempotente."""
    from sqlalchemy import text
    from cloud.db import engine

    with engine.begin() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(published_races)"))]
        if not cols:
            return  # tabla inexistente: create_all ya la crea con la columna
        if "owner_key_hash" not in cols:
            conn.execute(text("ALTER TABLE published_races ADD COLUMN owner_key_hash VARCHAR(64)"))


def _ensure_password_set_column():
    """Migración suave para SQLite: agrega portal_users.password_set. Las
    cuentas sin Google eligieron su contraseña al registrarse (1); las
    vinculadas a Google quedan en NULL porque no se puede saber si alguna vez
    eligieron una. Idempotente."""
    from sqlalchemy import text
    from cloud.db import engine

    with engine.begin() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(portal_users)"))]
        if not cols:
            return  # tabla inexistente: create_all ya la crea con la columna
        if "password_set" not in cols:
            conn.execute(text("ALTER TABLE portal_users ADD COLUMN password_set INTEGER"))
            conn.execute(text("UPDATE portal_users SET password_set = 1 WHERE google_id IS NULL"))


def _ensure_event_columns():
    """Migración suave para SQLite: columnas de calendario en published_races.
    Las carreras que ya estaban publicadas son resultados, así que el default
    'finished' las deja donde estaban. Idempotente."""
    from sqlalchemy import text
    from cloud.db import engine

    with engine.begin() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(published_races)"))]
        if not cols:
            return
        wanted = {
            "event_status": "ALTER TABLE published_races ADD COLUMN event_status VARCHAR(12) NOT NULL DEFAULT 'finished'",
            "registration_url": "ALTER TABLE published_races ADD COLUMN registration_url VARCHAR(400)",
            "capacity": "ALTER TABLE published_races ADD COLUMN capacity INTEGER",
            "registered_count": "ALTER TABLE published_races ADD COLUMN registered_count INTEGER",
        }
        for col, ddl in wanted.items():
            if col not in cols:
                conn.execute(text(ddl))
