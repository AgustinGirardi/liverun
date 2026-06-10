"""Lógica pura de racha semanal (cloud/run.py::compute_streak)."""
from datetime import date, timedelta

from cloud.run import compute_streak, week_start

# Miércoles 2026-06-10; su semana arranca el lunes 2026-06-08.
TODAY = date(2026, 6, 10)
MON = date(2026, 6, 8)


def days(monday, *offsets):
    return {monday + timedelta(days=o) for o in offsets}


def test_week_start_es_lunes():
    assert week_start(TODAY) == MON
    assert week_start(MON) == MON
    assert week_start(MON + timedelta(days=6)) == MON  # domingo


def test_sin_actividades_racha_cero():
    assert compute_streak(set(), 3, TODAY) == 0


def test_semana_en_curso_cumplida_cuenta():
    # Lun, mar y mié de esta semana: meta 3 ya cumplida.
    assert compute_streak(days(MON, 0, 1, 2), 3, TODAY) == 1


def test_semana_en_curso_incompleta_no_rompe():
    # Esta semana solo corrió 1 día (meta 3), pero las DOS semanas anteriores
    # cumplieron: la racha es 2 y la semana en curso no la rompe.
    prev1 = MON - timedelta(days=7)
    prev2 = MON - timedelta(days=14)
    run_dates = days(MON, 0) | days(prev1, 0, 2, 4) | days(prev2, 1, 3, 5)
    assert compute_streak(run_dates, 3, TODAY) == 2


def test_semana_en_curso_suma_a_las_anteriores():
    prev1 = MON - timedelta(days=7)
    run_dates = days(MON, 0, 1, 2) | days(prev1, 0, 2, 4)
    assert compute_streak(run_dates, 3, TODAY) == 2


def test_hueco_corta_la_racha():
    # Semana -1 no cumplió: las semanas -2 y -3 cumplidas no cuentan.
    prev2 = MON - timedelta(days=14)
    prev3 = MON - timedelta(days=21)
    run_dates = days(prev2, 0, 2, 4) | days(prev3, 0, 2, 4)
    assert compute_streak(run_dates, 3, TODAY) == 0


def test_varios_corridas_un_dia_cuentan_como_un_dia():
    # Tres salidas el mismo lunes = 1 día; con meta 2 no alcanza.
    assert compute_streak({MON}, 2, TODAY) == 0


def test_meta_uno():
    prev1 = MON - timedelta(days=7)
    assert compute_streak(days(prev1, 6), 1, TODAY) == 1
