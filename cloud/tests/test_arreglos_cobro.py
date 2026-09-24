"""Regresiones del cobro con Mercado Pago (revisión): reintentos del webhook,
avisos subscription_authorized_payment, validación y mapeo de pagos,
devoluciones, margen de gracia y cupón del 100%. MP siempre mockeado."""
import inspect
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

import cloud.billing as billing
import cloud.billing_routes as br
from cloud.models import BillingPayment, BillingSubscription, Coupon, PortalUser
from cloud.tests.conftest import make_user


def _ahora():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _usuario(client, db, email):
    make_user(client, email=email)
    return db.scalar(select(PortalUser).where(PortalUser.email == email))


def _con_sub(db, user, pre_id, status="authorized"):
    db.add(BillingSubscription(user_id=user.id, mp_preapproval_id=pre_id, status=status))
    db.commit()


def _pago(pid, **extra):
    base = {"id": pid, "status": "approved", "currency_id": "ARS", "transaction_amount": 2000.0}
    base.update(extra)
    return base


@pytest.fixture(autouse=True)
def _precio_fijo(monkeypatch):
    # Sin esto la validación del monto consultaría el dólar en red.
    monkeypatch.setattr(billing, "FIXED_PRICE_ARS", "2000")


def _mp(monkeypatch, pagos: dict, otros: dict | None = None, llamadas: list | None = None):
    """Fake de mp_request: `pagos` por id de /v1/payments, `otros` por path."""
    def fake(method, path, body=None, **kw):
        if llamadas is not None:
            llamadas.append((method, path, body))
        if path.startswith("/v1/payments/"):
            return pagos[path.rsplit("/", 1)[1]]
        return (otros or {}).get(path, {})
    monkeypatch.setattr(billing, "mp_request", fake)


# ── 1. Webhook: reintentos y threadpool ───────────────────────────────────────

def test_webhook_es_sync_para_correr_en_el_threadpool():
    assert not inspect.iscoroutinefunction(br.webhook)


def test_error_procesando_el_pago_devuelve_500_y_el_reintento_acredita(client, db, monkeypatch):
    """Antes el error se tragaba con 200: MP no reintentaba y el pago aprobado
    quedaba sin premium para siempre."""
    u = _usuario(client, db, "reintento@test.com")
    def caido(*a, **k):
        raise billing.MPError("MP caído")
    monkeypatch.setattr(billing, "mp_request", caido)
    r = client.post("/api/run/billing/webhook?type=payment&data.id=81001")
    assert r.status_code == 500
    db.refresh(u)
    assert u.premium_until is None

    # MP reintenta: ahora anda y acredita una sola vez.
    _mp(monkeypatch, {"81001": _pago("81001", external_reference=str(u.id))})
    assert client.post("/api/run/billing/webhook?type=payment&data.id=81001").status_code == 200
    db.refresh(u)
    primero = u.premium_until
    assert primero is not None
    assert client.post("/api/run/billing/webhook?type=payment&data.id=81001").status_code == 200
    db.refresh(u)
    assert u.premium_until == primero


def test_error_sincronizando_preapproval_devuelve_500(client, monkeypatch):
    def caido(*a, **k):
        raise billing.MPError("MP caído")
    monkeypatch.setattr(billing, "mp_request", caido)
    r = client.post("/api/run/billing/webhook?type=subscription_preapproval&data.id=PRE-1")
    assert r.status_code == 500


def test_aviso_con_body_json_sigue_andando(client, db, monkeypatch):
    u = _usuario(client, db, "body@test.com")
    _mp(monkeypatch, {"81002": _pago("81002", external_reference=str(u.id))})
    r = client.post("/api/run/billing/webhook", json={"type": "payment", "data": {"id": "81002"}})
    assert r.status_code == 200
    db.refresh(u)
    assert u.premium_until is not None


def test_aviso_con_body_no_json_no_revienta(client):
    r = client.post("/api/run/billing/webhook", content=b"no es json",
                    headers={"content-type": "text/plain"})
    assert r.status_code == 200


# ── 2. subscription_authorized_payment ────────────────────────────────────────

def test_authorized_payment_consulta_authorized_payments_y_acredita(client, db, monkeypatch):
    u = _usuario(client, db, "cuota@test.com")
    _con_sub(db, u, "PRE-AUT")
    llamadas = []
    # El pago no trae preapproval ni external_reference: el mapeo sale del
    # authorized_payment, que sí lo informa.
    _mp(monkeypatch, {"777001": _pago("777001")},
        {"/authorized_payments/555001": {"id": 555001, "preapproval_id": "PRE-AUT",
                                         "status": "processed",
                                         "payment": {"id": 777001, "status": "approved"}}},
        llamadas)
    r = client.post("/api/run/billing/webhook?type=subscription_authorized_payment&data.id=555001")
    assert r.status_code == 200
    paths = [p for _, p, _ in llamadas]
    assert paths[0] == "/authorized_payments/555001"
    assert "/v1/payments/555001" not in paths       # el id no es de un pago
    assert "/v1/payments/777001" in paths
    db.refresh(u)
    assert u.premium_until is not None
    assert db.scalar(select(BillingPayment).where(BillingPayment.mp_payment_id == "777001"))


def test_authorized_payment_sin_pago_todavia_no_acredita(client, db, monkeypatch):
    llamadas = []
    _mp(monkeypatch, {}, {"/authorized_payments/555002": {"id": 555002, "status": "recycling",
                                                          "preapproval_id": "PRE-X"}}, llamadas)
    r = client.post("/api/run/billing/webhook?type=subscription_authorized_payment&data.id=555002")
    assert r.status_code == 200
    assert [p for _, p, _ in llamadas] == ["/authorized_payments/555002"]


# ── 3. Validación y mapeo ─────────────────────────────────────────────────────

@pytest.mark.parametrize("cambio", [
    {"currency_id": "USD"},
    {"currency_id": None},
    {"transaction_amount": 0},
    {"transaction_amount": 10.0},     # pago suelto muy por debajo del precio
])
def test_pago_invalido_no_da_premium(client, db, monkeypatch, cambio):
    u = _usuario(client, db, "invalido@test.com")
    _mp(monkeypatch, {"82001": _pago("82001", external_reference=str(u.id), **cambio)})
    assert client.post("/api/run/billing/webhook?type=payment&data.id=82001").status_code == 200
    db.refresh(u)
    assert u.premium_until is None
    assert not db.scalar(select(BillingPayment).where(BillingPayment.mp_payment_id == "82001"))


def test_pago_de_preapproval_propio_acepta_monto_con_cupon(client, db, monkeypatch):
    """Con preapproval nuestro el monto lo fijamos nosotros (un cupón lo baja)."""
    u = _usuario(client, db, "cupon90@test.com")
    _con_sub(db, u, "PRE-90")
    _mp(monkeypatch, {"82002": _pago("82002", preapproval_id="PRE-90", transaction_amount=200.0)})
    client.post("/api/run/billing/webhook?type=payment&data.id=82002")
    db.refresh(u)
    assert u.premium_until is not None


def test_preapproval_manda_sobre_external_reference(client, db, monkeypatch):
    a = _usuario(client, db, "duenio@test.com")
    b = _usuario(client, db, "otro@test.com")
    _con_sub(db, a, "PRE-A")
    _mp(monkeypatch, {"82003": _pago("82003", preapproval_id="PRE-A", external_reference=str(b.id))})
    client.post("/api/run/billing/webhook?type=payment&data.id=82003")
    db.refresh(a)
    db.refresh(b)
    assert a.premium_until is not None
    assert b.premium_until is None


def test_preapproval_ajeno_no_cae_en_external_reference(client, db, monkeypatch):
    """Cobro huérfano de una cuenta borrada cuyo id se reutilizó: el
    external_reference apunta a la cuenta nueva, pero el preapproval no es suyo."""
    nuevo = _usuario(client, db, "nuevo@test.com")
    llamadas = []
    _mp(monkeypatch, {"82004": _pago("82004", preapproval_id="PRE-BORRADO",
                                     external_reference=str(nuevo.id))}, llamadas=llamadas)
    client.post("/api/run/billing/webhook?type=payment&data.id=82004")
    db.refresh(nuevo)
    assert nuevo.premium_until is None
    assert ("PUT", "/preapproval/PRE-BORRADO", {"status": "cancelled"}) in llamadas


def test_pago_suelto_anterior_a_la_cuenta_no_se_acredita(client, db, monkeypatch):
    u = _usuario(client, db, "reciclado@test.com")
    viejo = (u.created_at - timedelta(days=40)).isoformat() + "Z"
    _mp(monkeypatch, {"82005": _pago("82005", external_reference=str(u.id), date_created=viejo)})
    client.post("/api/run/billing/webhook?type=payment&data.id=82005")
    db.refresh(u)
    assert u.premium_until is None


def test_pago_suelto_posterior_a_la_cuenta_se_acredita(client, db, monkeypatch):
    u = _usuario(client, db, "fecha@test.com")
    reciente = (_ahora() + timedelta(seconds=1)).isoformat() + "-00:00"
    _mp(monkeypatch, {"82006": _pago("82006", external_reference=str(u.id), date_created=reciente)})
    client.post("/api/run/billing/webhook?type=payment&data.id=82006")
    db.refresh(u)
    assert u.premium_until is not None


@pytest.mark.parametrize("estado", ["refunded", "charged_back"])
def test_devolucion_revoca_lo_otorgado_una_sola_vez(client, db, monkeypatch, estado):
    u = _usuario(client, db, f"{estado}@test.com")
    antes = _ahora() + timedelta(days=10)
    u.premium_until = antes
    db.commit()
    pagos = {"83001": _pago("83001", external_reference=str(u.id))}
    _mp(monkeypatch, pagos)
    client.post("/api/run/billing/webhook?type=payment&data.id=83001")
    db.refresh(u)
    assert u.premium_until > antes

    pagos["83001"] = _pago("83001", external_reference=str(u.id), status=estado)
    assert client.post("/api/run/billing/webhook?type=payment&data.id=83001").status_code == 200
    db.refresh(u)
    assert abs((u.premium_until - antes).total_seconds()) < 2
    fila = db.scalar(select(BillingPayment).where(BillingPayment.mp_payment_id == "83001"))
    assert fila.status == estado

    # Un segundo aviso de la devolución no vuelve a restar.
    client.post("/api/run/billing/webhook?type=payment&data.id=83001")
    db.refresh(u)
    assert abs((u.premium_until - antes).total_seconds()) < 2


def test_devolucion_de_pago_viejo_sin_granted_s_resta_un_mes(client, db, monkeypatch):
    u = _usuario(client, db, "viejo@test.com")
    fin = _ahora() + timedelta(days=40)
    u.premium_until = fin
    db.add(BillingPayment(user_id=u.id, mp_payment_id="83002", amount=2000, status="approved"))
    db.commit()
    _mp(monkeypatch, {"83002": _pago("83002", status="refunded", external_reference=str(u.id))})
    client.post("/api/run/billing/webhook?type=payment&data.id=83002")
    db.refresh(u)
    assert abs((u.premium_until - (fin - timedelta(days=30))).total_seconds()) < 2


# ── 4. Margen de gracia ───────────────────────────────────────────────────────

def test_primer_cobro_da_30_dias_mas_gracia(client, db, monkeypatch):
    u = _usuario(client, db, "gracia@test.com")
    _mp(monkeypatch, {"84001": _pago("84001", external_reference=str(u.id))})
    client.post("/api/run/billing/webhook?type=payment&data.id=84001")
    db.refresh(u)
    esperado = _ahora() + timedelta(days=billing.DIAS_POR_COBRO + billing.DIAS_DE_GRACIA)
    assert abs((u.premium_until - esperado).total_seconds()) < 5


def test_renovacion_suma_30_desde_el_vencimiento_sin_acumular_gracia(client, db, monkeypatch):
    u = _usuario(client, db, "renueva@test.com")
    venc = _ahora() + timedelta(days=5)   # la gracia del mes anterior
    u.premium_until = venc
    db.commit()
    _mp(monkeypatch, {"84002": _pago("84002", external_reference=str(u.id))})
    client.post("/api/run/billing/webhook?type=payment&data.id=84002")
    db.refresh(u)
    # max(venc + 30, ahora + 35) = venc + 30: la gracia no se apila.
    assert abs((u.premium_until - (venc + timedelta(days=30))).total_seconds()) < 5


def test_premium_regalado_no_se_pierde_al_pagar(client, db, monkeypatch):
    u = _usuario(client, db, "regalo@test.com")
    venc = _ahora() + timedelta(days=180)
    u.premium_until = venc
    db.commit()
    _mp(monkeypatch, {"84003": _pago("84003", external_reference=str(u.id))})
    client.post("/api/run/billing/webhook?type=payment&data.id=84003")
    db.refresh(u)
    assert abs((u.premium_until - (venc + timedelta(days=30))).total_seconds()) < 5


# ── 11. Cupón del 100% ────────────────────────────────────────────────────────

def test_cupon_100_se_canjea_como_un_mes_gratis(client, db):
    h = make_user(client, email="cien@test.com")
    db.add(Coupon(code="GRATIS100", kind="discount", percent_off=100, active=1, redeemed_count=0))
    db.commit()
    r = client.post("/api/run/coupons/redeem", json={"code": "GRATIS100"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "free_months" and r.json()["months"] == 1
    u = db.scalar(select(PortalUser).where(PortalUser.email == "cien@test.com"))
    assert u.pending_discount_percent is None
    assert u.premium_until and u.premium_until > _ahora() + timedelta(days=29)


def test_descuento_100_pendiente_no_manda_monto_cero_a_mp(client, db, monkeypatch):
    """Cuentas que canjearon un 100% antes del arreglo: el mes se da directo y
    la suscripción arranca a precio de lista (antes: monto 0 → MP → 502)."""
    monkeypatch.setattr(billing, "MP_ACCESS_TOKEN", "tok")
    h = make_user(client, email="cienpend@test.com")
    u = db.scalar(select(PortalUser).where(PortalUser.email == "cienpend@test.com"))
    u.pending_discount_percent = 100
    db.commit()
    enviado = {}
    def fake(method, path, body=None, **kw):
        enviado["monto"] = body["auto_recurring"]["transaction_amount"]
        return {"id": "PRE-CIEN", "init_point": "https://mp/checkout/PRE-CIEN"}
    monkeypatch.setattr(billing, "mp_request", fake)
    r = client.post("/api/run/billing/subscribe", headers=h)
    assert r.status_code == 200, r.text
    assert enviado["monto"] == 2000.0
    db.refresh(u)
    assert u.pending_discount_percent is None
    assert u.premium_until and u.premium_until > _ahora() + timedelta(days=29)
