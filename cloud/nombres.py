"""Comparación y normalización de nombres de corredores."""

import unicodedata
import re


# ── Coincidencia de nombre (para verificar identidad al guardar resultados) ───
def _name_tokens(s: str) -> set[str]:
    s = unicodedata.normalize("NFKD", (s or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return {t for t in re.findall(r"[a-z]+", s) if len(t) >= 3}


def normalizar_nombre(s: str) -> str:
    """Forma buscable de un nombre: minúsculas, sin acentos (la ñ queda como n)
    y solo letras y números separados por un espacio. "José Pérez-Núñez" →
    "jose perez nunez". Se guarda en PublishedResult.name_norm y se aplica
    igual a lo que escribe el usuario, así las dos puntas comparan lo mismo."""
    s = unicodedata.normalize("NFKD", (s or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(re.findall(r"[a-z0-9]+", s))


def _name_matches(a: str, b: str) -> bool:
    return bool(_name_tokens(a) & _name_tokens(b))


def _last_name_matches(provisto: str, full_name: str) -> bool:
    """El apellido provisto tiene que ser una palabra COMPLETA del nombre.

    Antes esto era `provisto in full_name.lower()`, un substring sin longitud
    minima: `last_name="a"` matcheaba a casi cualquier corredor y permitia
    adjudicarse resultados ajenos en masa (los result_id son publicos).
    `_name_tokens` ya descarta tokens de menos de 3 letras.
    """
    return bool(_name_tokens(provisto) & _name_tokens(full_name))
