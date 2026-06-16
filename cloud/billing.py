"""Cobro de ChronoTrack Run premium con Mercado Pago (suscripción recurrente).

Flujo:
  app/web → POST /api/run/billing/subscribe → creamos un preapproval en MP →
  devolvemos init_point → el usuario autoriza el pago → MP cobra cada mes y
  notifica al webhook → extendemos premium_until +1 mes (idempotente por
  mp_payment_id). El backend es la única fuente de verdad del acceso.

Config (env): CT_MP_ACCESS_TOKEN (credencial del vendedor), CT_PREMIUM_PRICE
(monto mensual), CT_PREMIUM_CURRENCY (default ARS), CT_PUBLIC_URL.
"""
import json
import math
import os
import time as _time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from cloud.models import BillingPayment, BillingSubscription, PortalUser

MP_ACCESS_TOKEN = os.environ.get("CT_MP_ACCESS_TOKEN", "")
# Precio en dólares (fuente de verdad). El monto en pesos se calcula al dólar
# del día en cada alta. CT_PREMIUM_PRICE (ARS fijo) queda como override opcional.
PRICE_USD = float(os.environ.get("CT_PREMIUM_PRICE_USD", "1.99"))
FIXED_PRICE_ARS = os.environ.get("CT_PREMIUM_PRICE")  # si está, ignora el dólar
CURRENCY = os.environ.get("CT_PREMIUM_CURRENCY", "ARS")
# Qué dólar usar para convertir: oficial | blue | tarjeta | cripto (dolarapi.com).
RATE_SOURCE = os.environ.get("CT_USD_RATE_SOURCE", "oficial")
MANUAL_RATE = os.environ.get("CT_USD_RATE")           # override manual del tipo de cambio
RATE_FALLBACK = float(os.environ.get("CT_USD_RATE_FALLBACK", "1100"))
PUBLIC_URL = os.environ.get("CT_PUBLIC_URL", "https://chronotrack-portal.onrender.com").rstrip("/")
MP_API = "https://api.mercadopago.com"

_RATE_TTL = 3600  # cacheamos la cotización 1 hora
_rate_cache = {"rate": 0.0, "ts": 0.0}


def is_configured() -> bool:
    return bool(MP_ACCESS_TOKEN)


def _fetch_usd_ars_rate() -> float:
    """Cotización de venta del dólar elegido, desde dolarapi.com (Argentina)."""
    src = RATE_SOURCE if RATE_SOURCE in ("oficial", "blue", "tarjeta", "cripto", "mayorista") else "oficial"
    req = urllib.request.Request(
        f"https://dolarapi.com/v1/dolares/{src}", headers={"User-Agent": "ChronoTrack"}
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return float(json.loads(resp.read())["venta"])


def usd_ars_rate() -> float:
    """Tipo de cambio vigente. Override manual > caché (1h) > API > último > fallback."""
    if MANUAL_RATE:
        return float(MANUAL_RATE)
    now = _time.time()
    if _rate_cache["rate"] and now - _rate_cache["ts"] < _RATE_TTL:
        return _rate_cache["rate"]
    try:
        r = _fetch_usd_ars_rate()
        _rate_cache["rate"] = r
        _rate_cache["ts"] = now
        return r
    except Exception:
        return _rate_cache["rate"] or RATE_FALLBACK  # último conocido o piso configurable


def base_price_ars() -> float:
    """Precio mensual base en pesos: monto fijo si se definió, o USD×dólar del día
    redondeado hacia arriba a la decena (para no quedar corto)."""
    if FIXED_PRICE_ARS:
        return float(FIXED_PRICE_ARS)
    ars = PRICE_USD * usd_ars_rate()
    return float(math.ceil(ars / 10.0) * 10)


def price_for(discount_percent: Optional[int]) -> float:
    """Precio mensual con el descuento del cupón aplicado (redondeado a 2)."""
    p = base_price_ars()
    if discount_percent:
        p = p * (1 - min(max(discount_percent, 0), 100) / 100)
    return round(p, 2)


class MPError(Exception):
    """Error de la API de Mercado Pago, con el mensaje que ellos devuelven."""


def mp_request(method: str, path: str, body: Optional[dict] = None) -> dict:
    """Llamada a la API de Mercado Pago. Se monkeypatchea en tests."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        MP_API + path, data=data, method=method,
        headers={"Authorization": f"Bearer {MP_ACCESS_TOKEN}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try:
            payload = json.loads(e.read())
            detail = payload.get("message") or payload.get("error") or str(payload)
        except Exception:
            detail = f"HTTP {e.code}"
        # Visible en los logs de Render para diagnosticar configuraciones.
        print(f"[MP] {method} {path} -> {e.code}: {detail}", flush=True)
        raise MPError(detail)


def create_subscription(user: PortalUser, db: Session) -> dict:
    """Crea el preapproval en MP y devuelve {init_point, amount}."""
    amount = price_for(user.pending_discount_percent)
    payload = {
        "reason": "ChronoTrack Run Premium",
        "external_reference": str(user.id),
        "payer_email": user.email,
        "auto_recurring": {
            "frequency": 1,
            "frequency_type": "months",
            "transaction_amount": amount,
            "currency_id": CURRENCY,
        },
        "back_url": f"{PUBLIC_URL}/?sub=ok",
        "status": "pending",
    }
    res = mp_request("POST", "/preapproval", payload)
    pre_id = str(res.get("id") or "")
    init_point = res.get("init_point") or res.get("sandbox_init_point")
    if not pre_id or not init_point:
        raise RuntimeError("Mercado Pago no devolvió la suscripción")
    sub = db.scalar(select(BillingSubscription).where(BillingSubscription.mp_preapproval_id == pre_id))
    if not sub:
        db.add(BillingSubscription(user_id=user.id, mp_preapproval_id=pre_id, status="pending"))
        db.commit()
    return {"init_point": init_point, "amount": amount, "currency": CURRENCY}


def _user_for_payment(payment: dict, db: Session) -> Optional[PortalUser]:
    """Mapea un pago de MP a nuestro usuario: por external_reference (id) o,
    si falta, por el preapproval asociado."""
    ext = payment.get("external_reference")
    if ext and str(ext).isdigit():
        u = db.get(PortalUser, int(ext))
        if u:
            return u
    pre_id = payment.get("preapproval_id") or (payment.get("metadata") or {}).get("preapproval_id")
    if pre_id:
        sub = db.scalar(select(BillingSubscription).where(BillingSubscription.mp_preapproval_id == str(pre_id)))
        if sub:
            return db.get(PortalUser, sub.user_id)
    return None


def apply_payment(payment_id: str, db: Session) -> dict:
    """Procesa un pago notificado por el webhook. Idempotente: si ya se aplicó,
    no hace nada. Si está aprobado, extiende premium_until +1 mes."""
    if db.scalar(select(BillingPayment).where(BillingPayment.mp_payment_id == str(payment_id))):
        return {"status": "ya_procesado"}
    payment = mp_request("GET", f"/v1/payments/{payment_id}")
    status = payment.get("status")
    user = _user_for_payment(payment, db)
    if not user:
        return {"status": "sin_usuario"}
    if status != "approved":
        return {"status": status or "desconocido"}

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    base = user.premium_until if (user.premium_until and user.premium_until > now) else now
    user.premium_until = base + timedelta(days=30)
    user.pending_discount_percent = None  # el descuento ya se usó en este cobro
    db.add(BillingPayment(
        user_id=user.id, mp_payment_id=str(payment_id),
        amount=payment.get("transaction_amount"), status=status,
    ))
    try:
        db.commit()
    except IntegrityError:
        # Webhook duplicado en paralelo: el unique de mp_payment_id gana.
        db.rollback()
        return {"status": "ya_procesado"}
    return {"status": "premium_extendido", "premium_until": user.premium_until.isoformat()}
