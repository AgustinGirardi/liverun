"""El diccionario de rate-limiting purga IPs viejas (no crece para siempre)."""
import time

import cloud.main as cm


def test_rate_limit_purges_stale_ips(client):
    cm._RATE["login:9.9.9.9"] = [time.time() - 3600]   # hace 1 hora
    cm._RATE["login:8.8.8.8"] = [time.time()]          # reciente
    cm._LAST_SWEEP[0] = 0.0                            # fuerza el barrido

    r = client.post("/api/auth/login", json={"email": "x@mail.com", "password": "12345678"})
    assert r.status_code == 401  # credenciales inválidas; sólo nos importa el side-effect

    assert "login:9.9.9.9" not in cm._RATE
    assert "login:8.8.8.8" in cm._RATE
