"""Endpoints de cobro (Mercado Pago) para ChronoTrack Run."""
from fastapi import APIRouter, Depends, HTTPException, Request

from cloud import billing
from cloud.db import get_db
from cloud.deps import current_user, rate_limit
from cloud.models import PortalUser
from sqlalchemy.orm import Session

router = APIRouter(prefix="/api/run/billing", tags=["Billing"])


@router.get("/mode")
def billing_mode():
    """Modo del cobro según el prefijo del token (sin exponer el secreto):
    test = credenciales TEST-, prod = APP_USR-, none = sin configurar."""
    t = billing.MP_ACCESS_TOKEN
    mode = "test" if t.startswith("TEST-") else ("prod" if t.startswith("APP_USR") else "none")
    return {"mode": mode}


@router.get("/info")
def billing_info(user: PortalUser = Depends(current_user)):
    """Precio y disponibilidad del cobro para mostrar en la app/web. El precio
    en pesos se calcula al dólar del día (USD fijo como fuente de verdad)."""
    return {
        "available": billing.is_configured(),
        "price": billing.price_for(user.pending_discount_percent),
        "base_price": billing.base_price_ars(),
        "currency": billing.CURRENCY,
        "usd": billing.PRICE_USD,
        "discount_percent": user.pending_discount_percent,
    }


@router.post("/subscribe")
def subscribe(request: Request, user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    """Crea la suscripción en Mercado Pago y devuelve el link de pago (init_point)."""
    rate_limit(request, "subscribe", limit=10, window=60.0)
    if not billing.is_configured():
        raise HTTPException(503, "El cobro todavía no está habilitado.")
    try:
        return billing.create_subscription(user, db)
    except billing.MPError as e:
        # Mensaje real de Mercado Pago (útil para diagnosticar la config).
        raise HTTPException(502, f"Mercado Pago rechazó la suscripción: {e}")
    except Exception:
        raise HTTPException(502, "No se pudo iniciar el pago. Intentá de nuevo en un rato.")


@router.post("/webhook")
async def webhook(request: Request, db: Session = Depends(get_db)):
    """Recibe las notificaciones de Mercado Pago. MP manda el tipo y el id por
    query o body; solo nos interesan los pagos. La autenticidad se garantiza
    consultando el pago real a MP con nuestro token (no confiamos en el body)."""
    payment_id = request.query_params.get("data.id") or request.query_params.get("id")
    notif_type = request.query_params.get("type") or request.query_params.get("topic")
    if not payment_id or not notif_type:
        try:
            body = await request.json()
        except Exception:
            body = {}
        notif_type = notif_type or body.get("type") or body.get("topic")
        payment_id = payment_id or (body.get("data") or {}).get("id") or body.get("id")
    # Solo procesamos pagos; los demás avisos (preapproval, etc.) se aceptan y ya.
    if notif_type in ("payment", "subscription_authorized_payment") and payment_id:
        try:
            billing.apply_payment(str(payment_id), db)
        except Exception:
            # No reventamos: MP reintenta. Responder 200 evita reintentos infinitos
            # por errores transitorios nuestros; los pagos no procesados se
            # recuperan en el próximo aviso.
            pass
    return {"received": True}
