"""Cuentas de corredor: registro, login, contraseña y verificación de email."""

import time
import re
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Header, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, delete as sa_delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from cloud import mailer
from cloud.db import get_db
from cloud.deps import PUBLIC_URL, admin_emails, current_user, rate_limit, rate_limit_key
from cloud.models import PortalUser
from cloud.run import ahora_utc
from cloud.security import (
    hash_password,
    verify_password,
    make_token,
    make_mail_token,
    mail_token_uid,
    verify_mail_token,
)
from cloud.claims import _autolink

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

router = APIRouter()


class RegisterIn(BaseModel):
    email: str
    password: str = Field(..., min_length=8)
    full_name: Optional[str] = None

    @field_validator("email")
    @classmethod
    def _valid_email(cls, v: str) -> str:
        if not _EMAIL_RE.match(v.strip()):
            raise ValueError("Email inválido")
        return v.strip().lower()


class LoginIn(BaseModel):
    email: str
    password: str


class ChangePasswordIn(BaseModel):
    # Opcional sólo para cuentas que nunca eligieron contraseña (entran con
    # Google): ver change_password.
    current_password: Optional[str] = None
    new_password: str = Field(..., min_length=8)


class MailTokenIn(BaseModel):
    token: str = Field(..., max_length=2000)


class VerifyIn(MailTokenIn):
    # Sin sesión de esa misma cuenta, verificar pide la contraseña (ver verify_email).
    password: Optional[str] = Field(None, max_length=200)


class ForgotIn(BaseModel):
    email: str = Field(..., max_length=255)


class ResetIn(BaseModel):
    token: str = Field(..., max_length=2000)
    new_password: str = Field(..., min_length=8)


# ── Cuentas de corredor ──────────────────────────────────────────────────────

# Hash de descarte para igualar el tiempo del login cuando el email no existe.
# Se calcula una vez al importar (200.000 iteraciones no son gratis).
_DUMMY_HASH = hash_password("contraseña-que-nunca-va-a-coincidir")


@router.post("/api/auth/register", tags=["Corredor"])
def register(body: RegisterIn, request: Request, background: BackgroundTasks, db: Session = Depends(get_db)):
    # Registro permisivo: en un evento muchos corredores se anotan desde la misma
    # WiFi (mismo IP). El abuso de registro es de bajo valor (sólo da acceso a datos
    # ya públicos), así que el límite apunta a frenar floods automáticos, no a personas.
    rate_limit(request, "register", limit=40, window=60.0)
    email = body.email.lower()
    if db.scalar(select(PortalUser).where(PortalUser.email == email)):
        raise HTTPException(409, "Ya existe una cuenta con ese email")
    # tokens_valid_from = alta: si SQLite le reasigna el id de una cuenta
    # borrada, los tokens de aquella (mismo id, iat anterior) no abren esta.
    user = PortalUser(
        email=email,
        password_hash=hash_password(body.password),
        full_name=body.full_name,
        tokens_valid_from=int(time.time()),
        password_set=1,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # Dos registros simultáneos con el mismo email: el segundo pierde contra
        # el unique de la tabla. Mismo mensaje que el chequeo previo, no un 500.
        db.rollback()
        raise HTTPException(409, "Ya existe una cuenta con ese email")
    # Sin autolink acá: la cuenta nace sin verificar. Los resultados se
    # vinculan cuando el usuario abre el link del mail.
    _mandar_verificacion(user, background)
    return {"token": make_token(user.id), "email": user.email, "full_name": user.full_name, "linked": 0}


@router.post("/api/auth/login", tags=["Corredor"])
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    # Login más estricto: es el vector de fuerza-bruta de contraseñas.
    rate_limit(request, "login", limit=15, window=60.0)
    user = db.scalar(select(PortalUser).where(PortalUser.email == body.email.lower()))
    if not user:
        # Gastar el mismo PBKDF2 que gastariamos con un usuario real. Sin esto
        # un email inexistente respondia en ~1 ms y uno registrado en ~80 ms
        # (200.000 iteraciones), y esa diferencia sola permite listar quien
        # tiene cuenta en el portal.
        verify_password(body.password, _DUMMY_HASH)
        raise HTTPException(401, "Email o contraseña incorrectos")
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Email o contraseña incorrectos")
    try:
        linked = _autolink(user, db)
    except Exception:
        db.rollback()
        linked = 0
    return {"token": make_token(user.id), "email": user.email, "full_name": user.full_name, "linked": linked}


@router.delete("/api/auth/account", tags=["Corredor"])
def delete_account(request: Request, user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    """Borra la cuenta y todos sus datos personales (requisito de App Store
    5.1.1(v) y Google Play). Los resultados publicados de las carreras no se
    tocan (son datos del organizador, ya públicos): solo se rompe el vínculo
    (claims). Irreversible."""
    rate_limit(request, "delete_account", limit=5, window=60.0)

    # Mejor esfuerzo: cancelar la suscripción de Mercado Pago para no seguir
    # cobrando una cuenta que ya no existe. Si MP falla, el borrado procede.
    from cloud import billing
    from cloud.models import (
        BillingPayment,
        BillingSubscription,
        CouponRedemption,
        Friendship,
    )

    subs = db.scalars(select(BillingSubscription).where(BillingSubscription.user_id == user.id)).all()
    for sub in subs:
        if sub.status == "cancelled" or not billing.is_configured():
            continue
        try:
            billing.cancel_preapproval(sub.mp_preapproval_id)
        except Exception as e:
            # El borrado NO se bloquea por una caída de MP: es una decisión
            # deliberada (ver test_borrar_sigue_aunque_mp_falle). Pero antes esto
            # era un `pass` mudo y el preapproval quedaba vivo cobrando todos los
            # meses sin ningún rastro. Ahora queda registrado, y si llega a
            # cobrar, apply_payment lo cancela al no poder mapearlo a nadie.
            print(
                f"[MP] no se pudo cancelar {sub.mp_preapproval_id} al borrar "
                f"la cuenta {user.id}: {e} — queda como huérfano",
                flush=True,
            )

    # El avatar es un archivo en disco: el CASCADE de la DB no lo cubre.
    from cloud.run import avatar_dir

    try:
        for f in avatar_dir().glob(f"{user.id}.*"):
            f.unlink(missing_ok=True)
    except OSError:
        pass

    # Dependencias sin relationship en el ORM: borrado explícito (no dependemos
    # del ondelete=CASCADE, que en SQLite requiere PRAGMA foreign_keys).
    db.execute(sa_delete(Friendship).where((Friendship.requester_id == user.id) | (Friendship.addressee_id == user.id)))
    db.execute(sa_delete(CouponRedemption).where(CouponRedemption.user_id == user.id))
    db.execute(sa_delete(BillingPayment).where(BillingPayment.user_id == user.id))
    db.execute(sa_delete(BillingSubscription).where(BillingSubscription.user_id == user.id))
    db.delete(user)  # el cascade del ORM borra claims y actividades
    db.commit()
    return {"deleted": True}


@router.post("/api/auth/password", tags=["Corredor"])
def change_password(
    body: ChangePasswordIn, request: Request, user: PortalUser = Depends(current_user), db: Session = Depends(get_db)
):
    """Cambia la contraseña y cierra el resto de las sesiones abiertas.

    Devuelve un token nuevo para no echar de la app a quien acaba de hacer el
    cambio: el suyo se emite después del corte, los demás quedan abajo.
    """
    rate_limit(request, "password", limit=5, window=300.0)
    # Una cuenta creada con Google tiene de contraseña un valor al azar que
    # nadie conoce: pedirle "la actual" la dejaba sin forma de elegir una. Ahí
    # la sesión (que salió de Google) alcanza como prueba. Solo con 0 explícito:
    # en NULL (cuentas viejas vinculadas a Google) no se sabe y se pide igual.
    sin_contrasena = user.password_set == 0
    if not sin_contrasena:
        if not body.current_password or not verify_password(body.current_password, user.password_hash):
            raise HTTPException(400, "La contraseña actual no es correcta.")
        if body.new_password == body.current_password:
            raise HTTPException(400, "La contraseña nueva tiene que ser distinta de la actual.")

    # +1 segundo: el corte tiene que quedar por ENCIMA de cualquier token ya
    # emitido, incluidos los de este mismo segundo. El token que devolvemos se
    # emite exactamente en el corte, así que es el único que lo pasa.
    corte = int(time.time()) + 1
    user.password_hash = hash_password(body.new_password)
    user.password_set = 1
    user.tokens_valid_from = corte
    db.commit()
    return {"token": make_token(user.id, iat=corte)}


# ── Verificación de email y "olvidé mi contraseña" ───────────────────────────
# Los links apuntan a la SPA (/?verificar=… y /?reset=…); app.js los levanta y
# llama a estos endpoints. Los mails salen en segundo plano (BackgroundTasks).

_LINK_INVALIDO = "El link no es válido o ya venció. Pedí uno nuevo."
_MSG_OLVIDE = "Si hay una cuenta con ese email, te mandamos un link. Revisá también spam."


def _mandar_verificacion(user: PortalUser, background: BackgroundTasks) -> None:
    link = f"{PUBLIC_URL}/?verificar=" + make_mail_token("verificar", user.id, user.email)
    asunto, texto, html = mailer.mail_verificacion(user.full_name, link)
    background.add_task(mailer.enviar, user.email, asunto, texto, html, link)


def _marcar_verificado(user: PortalUser) -> None:
    """Marca el email como verificado y, si está en CT_ADMIN_EMAILS, lo
    promueve ya (sin esperar al próximo arranque). El commit lo hace quien llama."""
    if not user.email_verified_at:
        user.email_verified_at = ahora_utc()
    if user.email.lower() in admin_emails():
        user.is_admin = 1


def _usuario_del_link(token: str, proposito: str, db: Session) -> PortalUser:
    uid = mail_token_uid(token)
    user = db.get(PortalUser, uid) if uid else None
    ok = user is not None and verify_mail_token(
        token, proposito, user.id, user.email, password_hash=user.password_hash if proposito == "reset" else ""
    )
    if not ok:
        raise HTTPException(400, _LINK_INVALIDO)
    return user


@router.post("/api/auth/verify/send", tags=["Corredor"])
def verify_send(request: Request, background: BackgroundTasks, user: PortalUser = Depends(current_user)):
    """Reenvía el mail de verificación al usuario logueado."""
    if user.email_verified_at:
        return {"sent": False, "email_verified": True}
    try:
        rate_limit(request, "verify_send", limit=10, window=600.0)
        rate_limit_key(f"verify_send:{user.id}", limit=3, window=600.0)
    except HTTPException as e:
        if e.status_code == 429:
            raise HTTPException(
                429, "Ya te mandamos el mail hace poco. Esperá unos minutos y revisá también la carpeta de spam."
            )
        raise
    _mandar_verificacion(user, background)
    return {"sent": True, "email_verified": False}


@router.post("/api/auth/verify", tags=["Corredor"])
def verify_email(body: VerifyIn, request: Request, db: Session = Depends(get_db), authorization: str = Header(None)):
    """Confirma el email con el token del link. Idempotente: abrir el link
    dos veces no falla. Después de verificar corre el autolink.

    El link solo prueba que quien lo abre lee ese buzón, no que haya creado
    la cuenta. Si un intruso registró el email de otro, el dueño del buzón
    podía tocar "verificar" y dejarle la cuenta verificada al intruso (con
    su contraseña y los resultados del dueño). Por eso hace falta además la
    sesión de esa misma cuenta o su contraseña: el dueño legítimo la sabe, la
    víctima de un intruso no, y esa cuenta queda sin verificar."""
    rate_limit(request, "verify", limit=20, window=60.0)
    user = _usuario_del_link(body.token, "verificar", db)
    if not user.email_verified_at:
        sesion_propia = False
        if authorization and authorization.lower().startswith("bearer "):
            try:
                sesion_propia = current_user(authorization, db).id == user.id
            except HTTPException:
                sesion_propia = False
        if not sesion_propia:
            if not body.password:
                raise HTTPException(401, "Para confirmar, ingresá la contraseña de esta cuenta.")
            rate_limit_key(f"verify_pw:{user.id}", limit=5, window=600.0)
            if not verify_password(body.password, user.password_hash):
                raise HTTPException(401, "La contraseña no coincide con la de esta cuenta.")
    _marcar_verificado(user)
    db.commit()
    try:
        linked = _autolink(user, db)
    except Exception:
        db.rollback()
        linked = 0
    return {"email_verified": True, "email": user.email, "linked": linked}


@router.post("/api/auth/password/forgot", tags=["Corredor"])
def forgot_password(body: ForgotIn, request: Request, background: BackgroundTasks, db: Session = Depends(get_db)):
    """Manda el link de reset. SIEMPRE responde lo mismo, exista o no la
    cuenta: si no, este endpoint servía para listar quién tiene cuenta."""
    rate_limit(request, "forgot", limit=10, window=600.0)
    email = body.email.strip().lower()
    try:
        # Por email: frena usar el portal para llenarle el buzón a alguien
        # desde muchas IPs. Se corta en silencio (mismo 200) para no filtrar nada.
        rate_limit_key(f"forgot:{email}", limit=3, window=3600.0)
    except HTTPException:
        return {"message": _MSG_OLVIDE}
    user = db.scalar(select(PortalUser).where(PortalUser.email == email)) if _EMAIL_RE.match(email) else None
    if user:
        link = f"{PUBLIC_URL}/?reset=" + make_mail_token("reset", user.id, user.email, password_hash=user.password_hash)
        asunto, texto, html = mailer.mail_reset(user.full_name, link)
        background.add_task(mailer.enviar, user.email, asunto, texto, html, link)
    return {"message": _MSG_OLVIDE}


@router.post("/api/auth/password/reset", tags=["Corredor"])
def reset_password(body: ResetIn, request: Request, db: Session = Depends(get_db)):
    """Elige contraseña nueva con el link del mail. El link es de un solo uso
    (su firma incluye la contraseña actual), cierra todas las sesiones y marca
    el email verificado: abrir el link prueba que el buzón es suyo. Devuelve
    una sesión nueva, igual que el login."""
    rate_limit(request, "reset", limit=10, window=600.0)
    user = _usuario_del_link(body.token, "reset", db)
    # +1 s, igual que change_password: el token que devolvemos se emite
    # exactamente en el corte y los de este mismo segundo quedan afuera.
    corte = int(time.time()) + 1
    user.password_hash = hash_password(body.new_password)
    user.password_set = 1
    user.tokens_valid_from = corte
    _marcar_verificado(user)
    db.commit()
    try:
        linked = _autolink(user, db)
    except Exception:
        db.rollback()
        linked = 0
    return {"token": make_token(user.id, iat=corte), "email": user.email, "full_name": user.full_name, "linked": linked}
