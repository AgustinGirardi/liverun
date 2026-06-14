"""Endpoints de cobro (Mercado Pago) para ChronoTrack Run."""
from fastapi import APIRouter, Depends, HTTPException, Request

from cloud import billing
from cloud.db import get_db
from cloud.deps import current_user, rate_limit
from cloud.models import PortalUser
from sqlalchemy.orm import Session

router = APIRouter(prefix="/api/run/billing", tags=["Billing"])


@router.get("/info")
def billing_info(user: PortalUser = Depends(current_user)):
    """Precio y disponibilidad del cobro para mostrar en la app/web."""
    return {
        "available": billing.is_configured(),
        "price": billing.price_for(user.pending_discount_percent),
        "base_price": billing.PRICE,
        "currency": billing.CURRENCY,
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
