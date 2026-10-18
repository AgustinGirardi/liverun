"""Envío de mails del portal (verificar email y resetear contraseña).

SMTP genérico con smtplib, sin dependencias. Config por entorno:
  CT_SMTP_HOST, CT_SMTP_PORT (587 por defecto), CT_SMTP_USER,
  CT_SMTP_PASSWORD, CT_SMTP_FROM (ej. "LiveRun <no-responder@dominio>").
Puerto 465 → SSL directo; cualquier otro → STARTTLS si el servidor lo ofrece.

Sin CT_SMTP_HOST no se manda nada: se loguea el mail (modo desarrollo). En
producción además se avisa al arrancar (ver main._startup), pero el portal
arranca igual: sin mails se pierde la verificación y el reset, no el resto.

Los envíos se llaman desde BackgroundTasks: un fallo se loguea y nunca rompe
el request que lo disparó.
"""
import logging
import os
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import make_msgid, parseaddr
from html import escape

log = logging.getLogger("cloud.mailer")

TIMEOUT_S = 10


def _config() -> dict:
    """Se lee en cada envío (no al importar) para que los tests puedan tocar el entorno."""
    return {
        "host": os.environ.get("CT_SMTP_HOST", "").strip(),
        "port": int(os.environ.get("CT_SMTP_PORT", "").strip() or 587),
        "user": os.environ.get("CT_SMTP_USER", "").strip(),
        "password": os.environ.get("CT_SMTP_PASSWORD", ""),
        "from": os.environ.get("CT_SMTP_FROM", "").strip(),
    }


def configurado() -> bool:
    return bool(_config()["host"])


def _en_produccion() -> bool:
    # Misma detección que main._EN_PRODUCCION: Render setea RENDER.
    return bool(os.environ.get("RENDER"))


def enviar(para: str, asunto: str, texto: str, html: str, link: str = "") -> bool:
    """Manda un mail (texto plano + HTML). Devuelve True si salió.

    `link` es solo para el log del modo desarrollo. En producción no se
    loguea: un link de reset en los logs es una llave de la cuenta.
    """
    cfg = _config()
    if not cfg["host"]:
        if _en_produccion():
            log.warning("SMTP no configurado: no se mandó el mail '%s'.", asunto)
        else:
            log.warning("SMTP no configurado (desarrollo). Mail a %s: '%s' — %s", para, asunto, link)
        return False
    msg = EmailMessage()
    msg["Subject"] = asunto
    msg["From"] = cfg["from"] or cfg["user"]
    msg["To"] = para
    remitente = parseaddr(msg["From"])[1]
    msg["Message-ID"] = make_msgid(domain=remitente.rsplit("@", 1)[-1] if "@" in remitente else None)
    msg.set_content(texto)
    msg.add_alternative(html, subtype="html")
    try:
        ctx = ssl.create_default_context()
        if cfg["port"] == 465:
            smtp = smtplib.SMTP_SSL(cfg["host"], cfg["port"], timeout=TIMEOUT_S, context=ctx)
        else:
            smtp = smtplib.SMTP(cfg["host"], cfg["port"], timeout=TIMEOUT_S)
        with smtp:
            if cfg["port"] != 465:
                smtp.ehlo()
                if smtp.has_extn("starttls"):
                    smtp.starttls(context=ctx)
                    smtp.ehlo()
                elif cfg["user"]:
                    # Sin TLS no mandamos la contraseña del remitente en claro.
                    raise smtplib.SMTPException("el servidor no ofrece STARTTLS")
            if cfg["user"]:
                smtp.login(cfg["user"], cfg["password"])
            smtp.send_message(msg)
        return True
    except Exception as e:
        log.error("No se pudo mandar el mail '%s': %s", asunto, e)
        return False


# ── Contenido ─────────────────────────────────────────────────────────────────

def _html(saludo: str, cuerpo: str, boton: str, link: str, pie: str) -> str:
    """HTML mínimo y con estilos en línea (los clientes de mail ignoran <style>).
    Todo lo variable llega escapado."""
    return (
        '<div style="font-family:Arial,sans-serif;font-size:15px;color:#28323A;max-width:480px">'
        f"<p>{escape(saludo)}</p><p>{escape(cuerpo)}</p>"
        f'<p><a href="{escape(link)}" style="display:inline-block;background:#00BF85;color:#fff;'
        f'padding:11px 18px;border-radius:999px;text-decoration:none;font-weight:bold">{escape(boton)}</a></p>'
        f'<p style="font-size:13px;color:#6B7780">Si el botón no anda, copiá este link:<br>{escape(link)}</p>'
        f'<p style="font-size:13px;color:#6B7780">{escape(pie)}</p></div>'
    )


def _saludo(nombre: str | None) -> str:
    primero = (nombre or "").strip().split(" ")[0]
    return f"Hola, {primero}:" if primero else "Hola:"


def mail_verificacion(nombre: str | None, link: str) -> tuple[str, str, str]:
    asunto = "Verificá tu email en LiveRun"
    cuerpo = "Confirmá que este email es tuyo para vincular tus resultados automáticamente."
    pie = "El link vence en 48 horas. Si no creaste una cuenta en LiveRun, ignorá este mail."
    texto = f"{_saludo(nombre)}\n\n{cuerpo}\n\n{link}\n\n{pie}\n"
    return asunto, texto, _html(_saludo(nombre), cuerpo, "Verificar mi email", link, pie)


def mail_reset(nombre: str | None, link: str) -> tuple[str, str, str]:
    asunto = "Cambiá tu contraseña de LiveRun"
    cuerpo = "Pediste cambiar la contraseña de tu cuenta. Elegí una nueva desde este link."
    pie = ("El link vence en 1 hora y sirve una sola vez. Si no lo pediste vos, "
           "ignorá este mail: tu contraseña sigue igual.")
    texto = f"{_saludo(nombre)}\n\n{cuerpo}\n\n{link}\n\n{pie}\n"
    return asunto, texto, _html(_saludo(nombre), cuerpo, "Elegir contraseña nueva", link, pie)
