"""El diccionario de rate-limiting purga IPs viejas (no crece para siempre)."""
import time

import cloud.main as cm


def test_rate_limit_prioriza_cf_connecting_ip(client):
    """La clave del bucket es CF-Connecting-IP (infalsificable, la pone
    Cloudflare). Variar el X-Forwarded-For no debe repartir los intentos en
    buckets distintos si la CF-Connecting-IP es la misma."""
    cm._RATE.clear()
    for fake in ("1.1.1.1", "2.2.2.2", "3.3.3.3"):
        client.post("/api/auth/login",
                    json={"email": "x@mail.com", "password": "12345678"},
                    headers={"CF-Connecting-IP": "8.8.8.8",
                             "X-Forwarded-For": f"{fake}, 7.7.7.7"})
    assert len(cm._RATE["login:8.8.8.8"]) == 3
    assert "login:1.1.1.1" not in cm._RATE


def test_rate_limit_fallback_xff_ultimo_salto(client):
    """Sin Cloudflare (acceso directo al origen), el fallback usa el último
    salto del XFF — el que agrega la infra, no el primero que manda el cliente."""
    cm._RATE.clear()
    for fake in ("1.1.1.1", "2.2.2.2", "3.3.3.3"):
        client.post("/api/auth/login",
                    json={"email": "x@mail.com", "password": "12345678"},
                    headers={"X-Forwarded-For": f"{fake}, 7.7.7.7"})
    assert len(cm._RATE["login:7.7.7.7"]) == 3


def test_rate_limit_purges_stale_ips(client):
    cm._RATE["login:9.9.9.9"] = [time.time() - 3600]   # hace 1 hora
    cm._RATE["login:8.8.8.8"] = [time.time()]          # reciente
    cm._LAST_SWEEP[0] = 0.0                            # fuerza el barrido

    r = client.post("/api/auth/login", json={"email": "x@mail.com", "password": "12345678"})
    assert r.status_code == 401  # credenciales inválidas; sólo nos importa el side-effect

    assert "login:9.9.9.9" not in cm._RATE
    assert "login:8.8.8.8" in cm._RATE
