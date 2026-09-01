"""Cobro con Mercado Pago: precio con descuento, alta de suscripción, webhook
de pago (idempotente) y extensión de premium. Las llamadas a MP se mockean."""
from datetime import datetime

from sqlalchemy import select

import cloud.billing as billing
from cloud.models import BillingPayment, BillingSubscription, PortalUser
from cloud.tests.conftest import make_user


# ── Precio puro ───────────────────────────────────────────────────────────────

def test_precio_al_dolar_del_dia(monkeypatch):
    # USD 2.00 a un dólar de 1000 → 2000 ARS (redondeado a la decena).
    monkeypatch.setattr(billing, "FIXED_PRICE_ARS", None)
    monkeypatch.setattr(billing, "PRICE_USD", 2.0)
    monkeypatch.setattr(billing, "usd_ars_rate", lambda strict=False: 1000.0)
    assert billing.base_price_ars() == 2000.0
    assert billing.price_for(None) == 2000.0
    assert billing.price_for(25) == 1500.0
    assert billing.price_for(100) == 0.0


def test_precio_redondea_hacia_arriba_a_la_decena(monkeypatch):
    monkeypatch.setattr(billing, "FIXED_PRICE_ARS", None)
    monkeypatch.setattr(billing, "PRICE_USD", 1.99)
    monkeypatch.setattr(billing, "usd_ars_rate", lambda strict=False: 1007.0)  # 1.99*1007 = 2003.93
    assert billing.base_price_ars() == 2010.0


def test_precio_fijo_override_ignora_dolar(monkeypatch):
    monkeypatch.setattr(billing, "FIXED_PRICE_ARS", "2800")
    assert billing.base_price_ars() == 2800.0


def test_rate_usa_fallback_si_la_api_falla(monkeypatch):
    monkeypatch.setattr(billing, "MANUAL_RATE", None)
    monkeypatch.setattr(billing, "RATE_FALLBACK", 1234.0)
    billing._rate_cache["rate"] = 0.0
    def boom():
        raise RuntimeError("sin red")
    monkeypatch.setattr(billing, "_fetch_usd_ars_rate", boom)
    assert billing.usd_ars_rate() == 1234.0


# ── Alta de suscripción ───────────────────────────────────────────────────────

def test_subscribe_devuelve_init_point_y_guarda(client, db, monkeypatch):
    monkeypatch.setattr(billing, "MP_ACCESS_TOKEN", "tok")
    monkeypatch.setattr(billing, "FIXED_PRICE_ARS", None)
    monkeypatch.setattr(billing, "usd_ars_rate", lambda strict=False: 1000.0)  # sin red
    calls = {}
    def fake(method, path, body=None, **kw):
        calls["body"] = body
        calls["idem"] = kw.get("idempotency_key")
        return {"id": "PRE-123", "init_point": "https://mp/checkout/PRE-123"}
    monkeypatch.setattr(billing, "mp_request", fake)

    h = make_user(client, email="pagador@test.com")
    r = client.post("/api/run/billing/subscribe", headers=h)
    assert r.status_code == 200
    assert r.json()["init_point"].endswith("PRE-123")
    # external_reference = id del usuario (para mapear el pago después)
    u = db.scalar(select(PortalUser).where(PortalUser.email == "pagador@test.com"))
    assert calls["body"]["external_reference"] == str(u.id)
    assert db.scalar(select(BillingSubscription).where(BillingSubscription.mp_preapproval_id == "PRE-123"))


def test_subscribe_sin_config_da_503(client, monkeypatch):
    monkeypatch.setattr(billing, "MP_ACCESS_TOKEN", "")
    h = make_user(client)
    assert client.post("/api/run/billing/subscribe", headers=h).status_code == 503


# ── Webhook de pago ───────────────────────────────────────────────────────────

def _setup_payment(monkeypatch, user_id, status="approved", amount=1.99):
    def fake(method, path, body=None, **kw):
        if path.startswith("/v1/payments/"):
            return {"id": path.rsplit("/", 1)[1], "status": status,
                    "external_reference": str(user_id), "transaction_amount": amount}
        return {}
    monkeypatch.setattr(billing, "mp_request", fake)


def test_webhook_pago_aprobado_extiende_premium(client, db, monkeypatch):
    h = make_user(client, email="p1@test.com")
    u = db.scalar(select(PortalUser).where(PortalUser.email == "p1@test.com"))
    assert u.premium_until is None
    _setup_payment(monkeypatch, u.id)

    r = client.post("/api/run/billing/webhook?type=payment&data.id=90001")
    assert r.status_code == 200
    db.refresh(u)
    assert u.premium_until is not None and u.premium_until > datetime.now()
    assert db.scalar(select(BillingPayment).where(BillingPayment.mp_payment_id == "90001"))


def test_webhook_es_idempotente(client, db, monkeypatch):
    h = make_user(client, email="p2@test.com")
    u = db.scalar(select(PortalUser).where(PortalUser.email == "p2@test.com"))
    _setup_payment(monkeypatch, u.id)
    client.post("/api/run/billing/webhook?type=payment&data.id=90002")
    db.refresh(u)
    first = u.premium_until
    # Segundo aviso del MISMO pago: no vuelve a sumar.
    client.post("/api/run/billing/webhook?type=payment&data.id=90002")
    db.refresh(u)
    assert u.premium_until == first


def test_webhook_ignora_id_no_numerico(client, monkeypatch):
    """Un id armado (p. ej. '../preapproval/1') no debe llegar a la API de MP:
    iría inyectado en la URL del GET autenticado con nuestro token."""
    calls = []
    monkeypatch.setattr(billing, "mp_request", lambda *a, **k: calls.append(a) or {})
    r = client.post("/api/run/billing/webhook?type=payment&data.id=..%2Fpreapproval%2F1")
    assert r.status_code == 200 and r.json() == {"received": True}
    assert calls == []


def test_webhook_pago_rechazado_no_da_premium(client, db, monkeypatch):
    h = make_user(client, email="p3@test.com")
    u = db.scalar(select(PortalUser).where(PortalUser.email == "p3@test.com"))
    _setup_payment(monkeypatch, u.id, status="rejected")
    client.post("/api/run/billing/webhook?type=payment&data.id=90003")
    db.refresh(u)
    assert u.premium_until is None


def test_webhook_consume_descuento_pendiente(client, db, monkeypatch):
    h = make_user(client, email="p4@test.com")
    u = db.scalar(select(PortalUser).where(PortalUser.email == "p4@test.com"))
    u.pending_discount_percent = 30
    db.commit()
    _setup_payment(monkeypatch, u.id)
    client.post("/api/run/billing/webhook?type=payment&data.id=90004")
    db.refresh(u)
    assert u.pending_discount_percent is None  # se usó en este cobro


def test_webhook_otro_topic_se_ignora(client, db, monkeypatch):
    # Un aviso que no es ni pago ni preapproval no debe llamar a MP.
    calls = []
    monkeypatch.setattr(billing, "mp_request", lambda *a, **k: calls.append(a) or {})
    r = client.post("/api/run/billing/webhook?type=subscription_preapproval_plan&data.id=PLAN-9")
    assert r.status_code == 200 and r.json()["received"] is True
    assert calls == []


# ── Ciclo de vida de la suscripción ───────────────────────────────────────────

def test_subscribe_rechaza_si_ya_hay_una_autorizada(client, db, monkeypatch):
    """Dos suscripciones autorizadas son dos débitos mensuales a la misma
    persona, y no hay endpoint de reembolso."""
    monkeypatch.setattr(billing, "MP_ACCESS_TOKEN", "tok")
    monkeypatch.setattr(billing, "FIXED_PRICE_ARS", "2000")
    h = make_user(client, email="doble@test.com")
    u = db.scalar(select(PortalUser).where(PortalUser.email == "doble@test.com"))
    db.add(BillingSubscription(user_id=u.id, mp_preapproval_id="PRE-YA", status="authorized"))
    db.commit()
    calls = []
    monkeypatch.setattr(billing, "mp_request", lambda *a, **k: calls.append(a) or {})

    r = client.post("/api/run/billing/subscribe", headers=h)
    assert r.status_code == 409
    assert calls == []          # ni se le pide a MP


def test_subscribe_falla_si_no_hay_cotizacion(client, monkeypatch):
    """El monto queda fijo en el preapproval y se cobra para siempre: con el
    dólar caído preferimos 503 antes que acuñar una suscripción subvaluada."""
    monkeypatch.setattr(billing, "MP_ACCESS_TOKEN", "tok")
    monkeypatch.setattr(billing, "FIXED_PRICE_ARS", None)
    monkeypatch.setattr(billing, "MANUAL_RATE", None)
    billing._rate_cache["rate"] = 0.0
    def boom():
        raise RuntimeError("sin red")
    monkeypatch.setattr(billing, "_fetch_usd_ars_rate", boom)
    calls = []
    monkeypatch.setattr(billing, "mp_request", lambda *a, **k: calls.append(a) or {})

    h = make_user(client, email="sindolar@test.com")
    r = client.post("/api/run/billing/subscribe", headers=h)
    assert r.status_code == 503
    assert calls == []


def test_descuento_vuelve_al_precio_de_lista_tras_el_primer_cobro(client, db, monkeypatch):
    """El cupón descuenta el PRIMER cobro. Como el monto vive dentro del
    preapproval, MP lo seguiría cobrando descontado de por vida."""
    make_user(client, email="cupon@test.com")
    u = db.scalar(select(PortalUser).where(PortalUser.email == "cupon@test.com"))
    u.pending_discount_percent = 50
    db.add(BillingSubscription(user_id=u.id, mp_preapproval_id="PRE-CUP", status="authorized"))
    db.commit()
    monkeypatch.setattr(billing, "FIXED_PRICE_ARS", "2000")
    puts = []
    def fake(method, path, body=None, **kw):
        if path.startswith("/v1/payments/"):
            return {"id": "90050", "status": "approved",
                    "external_reference": str(u.id), "transaction_amount": 1000.0}
        puts.append((method, path, body))
        return {}
    monkeypatch.setattr(billing, "mp_request", fake)

    client.post("/api/run/billing/webhook?type=payment&data.id=90050")
    assert puts == [("PUT", "/preapproval/PRE-CUP",
                     {"auto_recurring": {"transaction_amount": 2000.0,
                                         "currency_id": billing.CURRENCY}})]
