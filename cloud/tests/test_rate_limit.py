"""El diccionario de rate-limiting purga IPs viejas (no crece para siempre)."""
import time

import cloud.main as cm


# 172.68.0.1 cae en 172.64.0.0/13 (rango real de Cloudflare); 7.7.7.7 no.
_CF_HOP = "172.68.0.1"
_NO_CF_HOP = "7.7.7.7"


def test_rate_limit_usa_cf_connecting_ip_detras_de_cloudflare(client):
    """Si el último salto ES Cloudflare, CF-Connecting-IP es la clave real:
    variar el X-Forwarded-For del cliente no reparte los intentos."""
    cm._RATE.clear()
    for fake in ("1.1.1.1", "2.2.2.2", "3.3.3.3"):
        client.post("/api/auth/login",
                    json={"email": "x@mail.com", "password": "12345678"},
                    headers={"CF-Connecting-IP": "8.8.8.8",
                             "X-Forwarded-For": f"{fake}, {_CF_HOP}"})
    assert len(cm._RATE["login:8.8.8.8"]) == 3
    assert "login:1.1.1.1" not in cm._RATE


def test_rate_limit_ignora_cf_connecting_ip_si_no_viene_de_cloudflare(client):
    """Golpeando el origen directo (sin Cloudflare delante), una CF-Connecting-IP
    inventada y distinta por request NO debe crear un bucket nuevo cada vez:
    si lo hiciera, el rate limit sería puro adorno."""
    cm._RATE.clear()
    for fake in ("1.1.1.1", "2.2.2.2", "3.3.3.3"):
        client.post("/api/auth/login",
                    json={"email": "x@mail.com", "password": "12345678"},
                    headers={"CF-Connecting-IP": fake,
                             "X-Forwarded-For": f"9.9.9.9, {_NO_CF_HOP}"})
    assert len(cm._RATE[f"login:{_NO_CF_HOP}"]) == 3
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


# ── Backend intercambiable (memoria hoy; Redis si se escala a >1 worker) ──────
import pytest
from fastapi import HTTPException

import cloud.deps as deps


def test_limitador_en_memoria_corta_en_el_limite_y_libera_con_la_ventana(monkeypatch):
    lim = deps.LimitadorEnMemoria()
    ahora = [1000.0]
    monkeypatch.setattr(deps.time, "time", lambda: ahora[0])
    assert lim.permitir("k", 2, 60.0) is True
    assert lim.permitir("k", 2, 60.0) is True
    assert lim.permitir("k", 2, 60.0) is False
    ahora[0] += 61
    assert lim.permitir("k", 2, 60.0) is True
    deps._RATE.clear()


def test_crear_limitador_default_es_en_memoria():
    assert isinstance(deps.crear_limitador(None), deps.LimitadorEnMemoria)
    assert isinstance(deps.crear_limitador("memoria"), deps.LimitadorEnMemoria)


def test_crear_limitador_desconocido_dice_que_variable_corregir():
    with pytest.raises(RuntimeError) as e:
        deps.crear_limitador("redis")
    assert "CT_RATE_LIMIT_BACKEND" in str(e.value)
    assert "memoria" in str(e.value)


def test_rate_limit_key_usa_el_limitador_inyectado(monkeypatch):
    class Falso:
        llamadas = []

        def permitir(self, clave, limite, ventana):
            self.llamadas.append((clave, limite, ventana))
            return len(self.llamadas) <= 1

    falso = Falso()
    monkeypatch.setattr(deps, "_limitador", falso)
    deps.rate_limit_key("x", limit=1, window=5.0)
    with pytest.raises(HTTPException) as e:
        deps.rate_limit_key("x", limit=1, window=5.0)
    assert e.value.status_code == 429
    assert falso.llamadas[0] == ("x", 1, 5.0)
