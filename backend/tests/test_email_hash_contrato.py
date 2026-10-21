"""Contrato del hash de email entre el escritorio y el portal.

El escritorio publica `sha256("chronotrack-v1:" + email)` y el portal lo compara
con el de la cuenta del corredor: si las dos puntas divergen, el autovínculo
deja de funcionar sin ningún error. Las dos copias son independientes a
propósito (el .exe del escritorio no incluye `cloud/`), así que este test es lo
que las ata."""

import hashlib

import pytest

from backend.api.routes import _email_hash as hash_escritorio
from cloud.security import email_hash as hash_portal

EMAILS = [
    "ana@test.com",
    "Ana@Test.COM",
    "  ana@test.com  ",
    "ana+carrera@test.com",
    "jose.perez@correo.com.ar",
    "ñandú@test.com",
    "ana@bücher.example",
]


@pytest.mark.parametrize("email", EMAILS)
def test_escritorio_y_portal_hashean_igual(email):
    assert hash_escritorio(email) == hash_portal(email)


def test_vector_dorado_fija_sal_y_algoritmo():
    esperado = "8d84407a8524d7b6c59b3e66299dfa6b0d6407fe19d7125d9d5a6ea0c9265c74"
    assert hashlib.sha256(b"chronotrack-v1:ana@test.com").hexdigest() == esperado
    assert hash_escritorio("ana@test.com") == esperado
    assert hash_portal("ana@test.com") == esperado


def test_normaliza_mayusculas_y_espacios():
    assert hash_escritorio("  ANA@Test.com ") == hash_escritorio("ana@test.com")
    assert hash_portal("  ANA@Test.com ") == hash_portal("ana@test.com")


def test_email_vacio_el_escritorio_no_publica_hash():
    # Diferencia deliberada: sin email no hay nada que vincular.
    assert hash_escritorio("") is None
    assert hash_escritorio(None) is None
