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


def make_token(user_id: int) -> str:
    exp = int(time.time()) + TOKEN_TTL
    payload = f"{user_id}.{exp}"
    sig = hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def verify_token(token: str):
    try:
        user_id, exp, sig = token.split(".")
        payload = f"{user_id}.{exp}"
        good = hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(good, sig):
            return None
        if int(exp) < time.time():
            return None
        return int(user_id)
    except Exception:
        return None
