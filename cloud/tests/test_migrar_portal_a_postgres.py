"""scripts/migrar_portal_a_postgres.py: copia la base del portal a otro motor y la verifica.

Los tests copian entre archivos SQLite (corren en cualquier lado). El que
comprueba las secuencias necesita un Postgres real y corre cuando CT_TEST_DB
apunta a uno (el job python-postgres de la CI)."""

import hashlib
import importlib.util
import os
from datetime import datetime
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from cloud import models as m
from cloud.db import Base, normalizar_url
from cloud.nombres import normalizar_nombre

_RUTA = Path(__file__).parents[2] / "scripts" / "migrar_portal_a_postgres.py"
_spec = importlib.util.spec_from_file_location("migrar_portal_a_postgres", _RUTA)
migrador = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(migrador)

TEST_DB = os.environ.get("CT_TEST_DB", "")
HAY_POSTGRES = TEST_DB.startswith(("postgresql", "postgres"))

AHORA = datetime(2026, 10, 21, 12, 0, 0)


def _poblar(engine) -> None:
    """Una fila (o más) en cada una de las tablas del portal."""
    Base.metadata.create_all(engine)
    with Session(engine) as s:
        ana = m.PortalUser(email="ana@test.com", password_hash="h1", full_name="Ana Ñandú", created_at=AHORA)
        beto = m.PortalUser(email="beto@test.com", password_hash="h2", username="beto", avatar_url="/avatars/2.jpg")
        s.add_all([ana, beto])
        s.flush()
        carrera = m.PublishedRace(source_id="ct-1", code="ABC123", name="Maratón de prueba")
        s.add(carrera)
        s.flush()
        resultado = m.PublishedResult(
            race_id=carrera.id,
            bib_number="101",
            full_name="Ana Ñandú",
            name_norm=normalizar_nombre("Ana Ñandú"),  # como queda después del relleno de la migración
            net_time_ns=3_600_000_000_000,
        )
        s.add(resultado)
        s.flush()
        cupon = m.Coupon(code="PROMO", kind="days")
        s.add(cupon)
        s.flush()
        s.add_all(
            [
                m.PublishKey(name="Club", key_hash="a" * 64, key_prefix="lr_pub_ab", created_at=AHORA),
                m.Claim(user_id=ana.id, result_id=resultado.id),
                m.Activity(user_id=ana.id, client_uuid="u-1", started_at=AHORA, duration_s=1800, distance_m=5000.5),
                m.Friendship(requester_id=ana.id, addressee_id=beto.id, status="accepted"),
                m.CoachAthlete(coach_id=ana.id, athlete_id=beto.id),
                m.CouponRedemption(coupon_id=cupon.id, user_id=beto.id),
                m.BillingSubscription(user_id=ana.id, mp_preapproval_id="pre-1"),
                m.BillingPayment(user_id=ana.id, mp_payment_id="pay-1", amount=Decimal("1999.50"), status="approved"),
            ]
        )
        s.commit()


@pytest.fixture
def origen_url(tmp_path):
    url = f"sqlite:///{tmp_path / 'origen.db'}"
    motor = create_engine(url)
    _poblar(motor)
    motor.dispose()
    return url


@pytest.fixture
def destino_url(tmp_path):
    return f"sqlite:///{tmp_path / 'destino.db'}"


def _sha(url: str) -> str:
    return hashlib.sha256(Path(url.removeprefix("sqlite:///")).read_bytes()).hexdigest()


def _cuentas(url: str) -> dict[str, int]:
    motor = create_engine(url)
    try:
        return migrador._filas_por_tabla(motor)
    finally:
        motor.dispose()


def test_el_origen_de_prueba_tiene_datos_en_todas_las_tablas(origen_url):
    assert all(n > 0 for n in _cuentas(origen_url).values())


def test_copia_todas_las_tablas_y_las_verifica(origen_url, destino_url):
    antes = _sha(origen_url)
    salida = []
    assert migrador.migrar(origen_url, destino_url, salida=salida.append) == 0
    assert _cuentas(destino_url) == _cuentas(origen_url)
    assert "Verificado" in salida[-1]
    assert _sha(origen_url) == antes  # el archivo de origen no se toca


def test_el_origen_viejo_se_actualiza_en_la_copia(origen_url, destino_url):
    motor = create_engine(origen_url)
    with motor.begin() as conn:
        conn.execute(text("ALTER TABLE published_results DROP COLUMN category_position"))
    motor.dispose()
    assert migrador.migrar(origen_url, destino_url, salida=lambda _: None) == 0
    motor = create_engine(destino_url)
    with motor.connect() as conn:
        assert conn.execute(text("SELECT category_position FROM published_results")).scalar() is None
    motor.dispose()


def test_se_niega_si_el_destino_tiene_datos_y_con_vaciar_repite_el_ensayo(origen_url, destino_url):
    assert migrador.migrar(origen_url, destino_url, salida=lambda _: None) == 0
    with pytest.raises(migrador.ErrorDeMigracion, match="--vaciar"):
        migrador.migrar(origen_url, destino_url, salida=lambda _: None)
    assert migrador.migrar(origen_url, destino_url, vaciar=True, salida=lambda _: None) == 0
    assert _cuentas(destino_url) == _cuentas(origen_url)  # sin filas duplicadas


def test_detecta_una_diferencia_de_contenido(origen_url, destino_url):
    migrador.migrar(origen_url, destino_url, salida=lambda _: None)
    destino = create_engine(destino_url)
    with destino.begin() as conn:
        conn.execute(text("UPDATE portal_users SET full_name = 'Otra' WHERE email = 'ana@test.com'"))
    problemas = migrador.verificar(create_engine(origen_url), destino)
    assert problemas == ["portal_users: origen 2 filas, destino 2 filas, contenido distinto"]


def test_si_la_copia_falla_no_queda_nada_en_el_destino(origen_url, destino_url, monkeypatch):
    original = migrador._reasignar_secuencias

    def _rompe(conn):
        original(conn)
        raise RuntimeError("se cayó a mitad de camino")

    monkeypatch.setattr(migrador, "_reasignar_secuencias", _rompe)
    with pytest.raises(migrador.ErrorDeMigracion, match="no se guardó nada"):
        migrador.migrar(origen_url, destino_url, salida=lambda _: None)
    assert sum(_cuentas(destino_url).values()) == 0


def test_origen_inexistente_dice_que_revisar(tmp_path, destino_url):
    with pytest.raises(migrador.ErrorDeMigracion, match="No existe el archivo de origen"):
        migrador.migrar(f"sqlite:///{tmp_path / 'no_esta.db'}", destino_url, salida=lambda _: None)


def test_origen_y_destino_iguales_se_rechazan(origen_url):
    with pytest.raises(migrador.ErrorDeMigracion, match="la misma base"):
        migrador.migrar(origen_url, origen_url, salida=lambda _: None)


def test_main_sin_destino_sale_con_2(origen_url, monkeypatch, capsys):
    monkeypatch.delenv("CT_DESTINO_DB", raising=False)
    assert migrador.main(["--origen", origen_url]) == 2
    assert "CT_DESTINO_DB" in capsys.readouterr().err


def test_main_copia_y_sale_con_0(origen_url, destino_url, capsys):
    assert migrador.main(["--origen", origen_url, "--destino", destino_url]) == 0
    assert "Verificado" in capsys.readouterr().out


def test_la_salida_no_muestra_la_clave_del_destino():
    motor = create_engine("postgresql+psycopg://usuario:secretisima@localhost/base")
    assert "secretisima" not in migrador._url_visible(motor)


@pytest.mark.parametrize(
    "entrada, esperada",
    [
        ("postgresql://u:p@host/db?sslmode=require", "postgresql+psycopg://u:p@host/db?sslmode=require"),
        ("postgres://u:p@host/db", "postgresql+psycopg://u:p@host/db"),
        ("postgresql+psycopg://u:p@host/db", "postgresql+psycopg://u:p@host/db"),
        ("sqlite:///cloud.db", "sqlite:///cloud.db"),
    ],
)
def test_normalizar_url_lleva_postgres_al_driver_psycopg(entrada, esperada):
    assert normalizar_url(entrada) == esperada


@pytest.mark.skipif(not HAY_POSTGRES, reason="necesita CT_TEST_DB apuntando a un Postgres")
def test_en_postgres_las_secuencias_quedan_listas_para_seguir_insertando(origen_url):
    assert migrador.migrar(origen_url, TEST_DB, vaciar=True, salida=lambda _: None) == 0
    destino = create_engine(normalizar_url(TEST_DB))
    try:
        with Session(destino) as s:
            nuevo = m.PortalUser(email="nuevo@test.com", password_hash="h")
            s.add(nuevo)
            s.commit()  # sin la reasignación de secuencias esto choca con el id 1
            assert nuevo.id == 3
    finally:
        destino.dispose()
