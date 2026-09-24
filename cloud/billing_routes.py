"""Endpoints de cobro (Mercado Pago) para ChronoTrack Run."""
import hashlib
import hmac
import os
import re
import traceback

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from cloud import billing
from cloud.db import get_db
from cloud.deps import current_user, rate_limit
from cloud.models import PortalUser
from sqlalchemy.orm import Session

router = APIRouter(prefix="/api/run/billing", tags=["Billing"])

# Clave secreta del webhook, del panel de MP. Es un valor DISTINTO del access
# token: mezclarlos hace que la verificación falle en silencio.
MP_WEBHOOK_SECRET = os.environ.get("CT_MP_WEBHOOK_SECRET", "")

# En produccion no aceptamos avisos sin firma. Fuera de produccion si, para no
# obligar a configurar el secreto del webhook en cada entorno de desarrollo.
_EXIGIR_FIRMA = bool(os.environ.get("RENDER"))

# Los ids de preapproval de MP son alfanuméricos. Igual que con los ids de pago,
# validamos el formato antes de meterlos en la URL del GET autenticado.
_ID_PREAPPROVAL = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _firma_valida(request: Request, data_id) -> bool:
    """Verifica el HMAC que MP manda en x-signature.

    Es defensa en profundidad: la autenticidad ya está garantizada porque nunca
    confiamos en el body y re-consultamos el pago a MP con nuestro token. La
    firma agrega que ni siquiera gastemos esa consulta en un aviso inventado.

    Si CT_MP_WEBHOOK_SECRET no está configurada, en desarrollo no rechazamos
    nada (el re-fetch sigue siendo la defensa real), pero en producción sí:
    sin firma, cualquiera podía disparar en bucle una consulta autenticada
    nuestra a la API de MP por cada request, quemando la cuota de la cuenta del
    vendedor y bloqueando el worker 20 s por vez.
    """
    if not MP_WEBHOOK_SECRET:
        return not _EXIGIR_FIRMA
    crudo = request.headers.get("x-signature") or ""
    partes = dict(t.split("=", 1) for t in crudo.split(",") if "=" in t)
    ts, v1 = partes.get("ts", "").strip(), partes.get("v1", "").strip()
    if not ts or not v1:
        return False
    pedido = request.headers.get("x-request-id", "")
    # MP arma el manifest con el data.id en minúsculas cuando es alfanumérico.
    # Con los ids de pago (numéricos) da igual, pero los de preapproval no lo son
    # y ahí la firma no cerraría nunca.
    manifest = f"id:{str(data_id).lower()};request-id:{pedido};ts:{ts};"
    esperado = hmac.new(MP_WEBHOOK_SECRET.encode(), manifest.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(esperado, v1)


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
    except billing.SubscriptionExists:
        raise HTTPException(409, "Ya tenés una suscripción activa.")
    except billing.RateUnavailable:
        # El monto queda fijo en MP para siempre: mejor reintentar que cobrar mal.
        raise HTTPException(503, "No pudimos calcular el precio ahora. Probá de nuevo en un rato.")
    except billing.MPError as e:
        # Mensaje real de Mercado Pago (útil para diagnosticar la config).
        raise HTTPException(502, f"Mercado Pago rechazó la suscripción: {e}")
    except Exception:
        raise HTTPException(502, "No se pudo iniciar el pago. Intentá de nuevo en un rato.")


async def _cuerpo_json(request: Request) -> dict:
    """Body del aviso, tolerante: MP a veces manda todo por query y el body
    viene vacío o no es JSON. Es async (leer el body lo exige) pero no hace
    I/O bloqueante; el trabajo pesado corre en el endpoint sync."""
    try:
        body = await request.json()
    except Exception:
        return {}
    return body if isinstance(body, dict) else {}


def _reintentar(notif_type, data_id) -> JSONResponse:
    """500 para que MP reintente el aviso. Antes un error nuestro (MP caído,
    base bloqueada) se tragaba con 200 y un pago aprobado quedaba sin premium
    para siempre. Reintentar es seguro: apply_payment es idempotente por
    mp_payment_id y sync_preapproval solo copia el estado."""
    print(f"[MP] error procesando {notif_type}/{data_id}; MP va a reintentar\n"
          f"{traceback.format_exc()}", flush=True)
    return JSONResponse({"received": False}, status_code=500)


@router.post("/webhook")
def webhook(request: Request, body: dict = Depends(_cuerpo_json), db: Session = Depends(get_db)):
    """Recibe las notificaciones de Mercado Pago. MP manda el tipo y el id por
    query o body. La autenticidad se garantiza consultando el recurso real a MP
    con nuestro token (no confiamos en el body).

    Es `def` y no `async def` a propósito: consulta a MP con urllib (hasta
    20 s) y usa SQLAlchemy sync. En un async eso bloqueaba el event loop y con
    él a todo el portal; como def, FastAPI lo corre en el threadpool."""
    # Endpoint publico que dispara una llamada saliente a MP por request: sin
    # tope es un amplificador contra nuestra propia cuota. El limite es holgado
    # para no perder avisos legitimos en una rafaga de cobros.
    rate_limit(request, "mp_webhook", limit=120, window=60.0)
    payment_id = request.query_params.get("data.id") or request.query_params.get("id")
    notif_type = request.query_params.get("type") or request.query_params.get("topic")
    if not payment_id or not notif_type:
        notif_type = notif_type or body.get("type") or body.get("topic")
        payment_id = payment_id or (body.get("data") or {}).get("id") or body.get("id")
    if not _firma_valida(request, payment_id):
        # Queda logueado: si algún día rechazáramos un aviso legítimo (por un
        # cambio de MP en cómo arma el manifest) sería un pago perdido, y sin
        # esta línea no habría forma de enterarse.
        print(f"[MP] aviso {notif_type}/{payment_id} descartado: firma inválida", flush=True)
        # 200 a propósito: no queremos que MP reintente un aviso que descartamos.
        return {"received": True, "ignored": "firma"}

    # Los ids de pago de MP son numéricos; validar acá evita que un id armado
    # (p. ej. "../preapproval/X") se inyecte en la URL del GET a la API de MP.
    es_numerico = bool(payment_id) and str(payment_id).isdigit()
    if notif_type == "payment" and es_numerico:
        try:
            billing.apply_payment(str(payment_id), db)
        except Exception:
            return _reintentar(notif_type, payment_id)
    elif notif_type == "subscription_authorized_payment" and es_numerico:
        # Su data.id es de /authorized_payments, no de /v1/payments.
        try:
            billing.apply_authorized_payment(str(payment_id), db)
        except Exception:
            return _reintentar(notif_type, payment_id)
    elif notif_type in ("subscription_preapproval", "preapproval") \
            and payment_id and _ID_PREAPPROVAL.match(str(payment_id)):
        # Altas y bajas de la suscripción. Sin esto el estado local se queda
        # en "pending" para siempre y no nos enteramos de una cancelación.
        try:
            billing.sync_preapproval(str(payment_id), db)
        except Exception:
            return _reintentar(notif_type, payment_id)
    # Los demás avisos (tipos que no usamos, ids mal formados) se aceptan con
    # 200: reintentarlos no cambiaría nada.
    return {"received": True}
