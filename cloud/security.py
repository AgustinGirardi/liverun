"""Hash de contraseñas (PBKDF2) y tokens firmados (HMAC). Sin dependencias externas."""
import os
import time
import hmac
import base64
import hashlib

SECRET = os.environ.get("CT_CLOUD_SECRET", "dev-insecure-secret-change-me")
TOKEN_TTL = 60 * 60 * 24 * 30  # 30 días
_ITERS = 200_000


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _ITERS)
    return f"pbkdf2${_ITERS}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iters, b64salt, b64dk = stored.split("$")
        salt = base64.b64decode(b64salt)
        expected = base64.b64decode(b64dk)
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, int(iters))
        return hmac.compare_digest(dk, expected)
    except Exception:
        return False


def make_token(user_id: int, iat: int = 0) -> str:
    """Token firmado con el momento de emisión (iat) además del vencimiento.

    El iat es lo que permite invalidar sesiones: al cambiar la contraseña se
    guarda un corte y todo token emitido antes deja de valer.

    `iat` explícito lo usa el cambio de contraseña para emitir el token nuevo
    justo EN el corte. Sin eso, un token emitido en el mismo segundo que el
    cambio sobreviviría, porque la comparación es en segundos enteros.
    """
    now = iat or int(time.time())
    payload = f"{user_id}.{now}.{now + TOKEN_TTL}"
    sig = hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def verify_token(token: str):
    """Devuelve (user_id, iat) si el token es válido, o None.

    Acepta el formato viejo de 3 partes (sin iat) para no cerrar las sesiones
    que ya estaban abiertas: se les asigna iat=0, así siguen andando pero
    quedan invalidadas en cuanto el usuario cambie su contraseña.
    """
    try:
        partes = token.split(".")
        if len(partes) == 4:
            user_id, iat, exp, sig = partes
        elif len(partes) == 3:
            user_id, exp, sig = partes
            iat = "0"
        else:
            return None
        payload = ".".join(partes[:-1])
        good = hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(good, sig):
            return None
        if int(exp) < time.time():
            return None
        return int(user_id), int(iat)
    except Exception:
        return None
