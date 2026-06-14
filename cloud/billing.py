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
import os
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from cloud.models import BillingPayment, BillingSubscription, PortalUser

MP_ACCESS_TOKEN = os.environ.get("CT_MP_ACCESS_TOKEN", "")
PRICE = float(os.environ.get("CT_PREMIUM_PRICE", "1.99"))
CURRENCY = os.environ.get("CT_PREMIUM_CURRENCY", "ARS")
PUBLIC_URL = os.environ.get("CT_PUBLIC_URL", "https://chronotrack-portal.onrender.com").rstrip("/")
MP_API = "https://api.mercadopago.com"


def is_configured() -> bool:
    return bool(MP_ACCESS_TOKEN)


def price_for(discount_percent: Optional[int]) -> float:
    """Precio mensual con el descuento del cupón aplicado (redondeado a 2)."""
    p = PRICE
    if discount_percent:
        p = p * (1 - min(max(discount_percent, 0), 100) / 100)
    return round(p, 2)


def mp_request(method: str, path: str, body: Optional[dict] = None) -> dict:
    """Llamada a la API de Mercado Pago. Se monkeypatchea en tests."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        MP_API + path, data=data, method=method,
        headers={"Authorization": f"Bearer {MP_ACCESS_TOKEN}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read())


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
