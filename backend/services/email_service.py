"""Envío de emails de resultados (provider-agnóstico; implementa Brevo).

La configuración (proveedor, API key, remitente) se guarda en un archivo JSON
junto a la base de datos. La API key vive SOLO en el backend de escritorio:
nunca se envía al navegador (la UI sólo recibe una versión enmascarada).

Para cambiar de proveedor (p. ej. Resend con dominio propio), basta con agregar
otra rama en `send_email`. El resto del sistema no cambia.
"""
import os
import json
import urllib.request
import urllib.error

from backend.core.database import DB_PATH

_CONFIG_PATH = DB_PATH.parent / "chronotrack_email.json"

_DEFAULTS = {
    "provider": "brevo",
    "api_key": "",
    "from_email": "",
    "from_name": "LiveRun",
}


def load_config() -> dict:
    cfg = dict(_DEFAULTS)
    if _CONFIG_PATH.exists():
        try:
            saved = json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))
            if isinstance(saved, dict):
                for k in cfg:
                    if saved.get(k):
                        cfg[k] = saved[k]
        except Exception:
            pass
    # Env vars opcionales (override)
    if os.environ.get("CT_EMAIL_KEY"):
        cfg["api_key"] = os.environ["CT_EMAIL_KEY"]
    if os.environ.get("CT_EMAIL_FROM"):
        cfg["from_email"] = os.environ["CT_EMAIL_FROM"]
    return cfg


def save_config(provider=None, api_key=None, from_email=None, from_name=None) -> dict:
    cur = load_config()
    if provider:   cur["provider"]   = provider.strip()
    if api_key and api_key.strip():       cur["api_key"]    = api_key.strip()
    if from_email is not None and from_email.strip():  cur["from_email"] = from_email.strip()
    if from_name is not None and from_name.strip():    cur["from_name"]  = from_name.strip()
    _CONFIG_PATH.write_text(json.dumps(cur, indent=2), encoding="utf-8")
    return cur


def mask_key(api_key: str) -> str:
    if not api_key:
        return ""
    if len(api_key) <= 4:
        return "•" * len(api_key)
    return "•" * (len(api_key) - 4) + api_key[-4:]


def is_configured(cfg: dict | None = None) -> bool:
    cfg = cfg or load_config()
    return bool(cfg.get("api_key") and cfg.get("from_email"))


def send_email(to_email: str, to_name: str, subject: str, html: str, cfg: dict | None = None):
    """Envía un email. Devuelve (ok: bool, error: str|None). Bloqueante: llamar
    desde un thread (anyio.to_thread) para no bloquear el event loop."""
    cfg = cfg or load_config()
    provider = (cfg.get("provider") or "brevo").lower()
    if not cfg.get("api_key"):
        return False, "Falta la API key del proveedor de email"
    if not cfg.get("from_email"):
        return False, "Falta el email remitente"

    if provider == "brevo":
        return _send_brevo(to_email, to_name, subject, html, cfg)
    return False, f"Proveedor de email no soportado: {provider}"


def _send_brevo(to_email, to_name, subject, html, cfg):
    payload = {
        "sender": {"name": cfg.get("from_name") or "ChronoTrack", "email": cfg["from_email"]},
        "to": [{"email": to_email, "name": to_name or to_email}],
        "subject": subject,
        "htmlContent": html,
    }
    req = urllib.request.Request(
        "https://api.brevo.com/v3/smtp/email",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "api-key": cfg["api_key"],
            "content-type": "application/json",
            "accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return (200 <= resp.status < 300), None
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            msg = json.loads(body).get("message", body)
        except Exception:
            msg = body
        if e.code in (401, 403):
            return False, "API key de email inválida o sin permisos"
        return False, f"Error {e.code}: {msg}"
    except urllib.error.URLError as e:
        return False, f"No se pudo conectar al proveedor de email: {e.reason}"


def build_result_email(*, runner_name, race_name, race_date, location,
                       distance_km, net_time_ns, finish_time_ns, position,
                       category, portal_url=None, race_code=None):
    """Arma el HTML del email de resultado de un corredor."""
    def fmt_ns(ns):
        if not ns:
            return "—"
        ms = ns // 1_000_000
        h, ms = divmod(ms, 3_600_000)
        m, ms = divmod(ms, 60_000)
        s, f = divmod(ms, 1_000)
        return f"{h:02d}:{m:02d}:{s:02d}.{f:03d}"

    time_str = fmt_ns(net_time_ns or finish_time_ns)
    dist = f"{distance_km} km" if distance_km else ""
    meta = " · ".join([x for x in [dist, race_date, location] if x])
    pos = f"#{position}" if position else "—"
    link = ""
    if portal_url:
        url = portal_url.rstrip("/")
        note = (f'En el portal buscá tu nombre o el código <b>{race_code}</b>.'
                if race_code else 'En el portal buscá tu nombre para ver tu detalle y certificado.')
        link = (
            f'<tr><td style="padding-top:18px">'
            f'<a href="{url}" style="background:#00b483;color:#04130d;text-decoration:none;'
            f'padding:12px 22px;border-radius:8px;font-weight:700;display:inline-block">'
            f'Ver mis resultados y certificado →</a>'
            f'<div style="color:#8a9299;font-size:12px;margin-top:8px">{note}</div></td></tr>'
        )

    return f"""\
<!doctype html><html><body style="margin:0;background:#0d0f10;padding:24px;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#15181a;border:1px solid #262b2e;border-radius:14px;overflow:hidden">
  <tr><td style="background:#0f1213;padding:18px 24px;border-bottom:1px solid #262b2e">
    <span style="color:#00e5a0;font-weight:800;font-size:18px;letter-spacing:-.5px">● CHRONO<span style="color:#8a9299;font-weight:500">TRACK</span></span>
  </td></tr>
  <tr><td style="padding:28px 24px;color:#eef1f2">
    <div style="color:#00e5a0;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:700">Resultado oficial</div>
    <h1 style="font-size:22px;margin:8px 0 4px">¡Felicitaciones, {runner_name}!</h1>
    <div style="color:#97a0a6;font-size:14px">Completaste <b style="color:#eef1f2">{race_name}</b></div>
    <div style="color:#5b646a;font-size:13px;margin-top:4px">{meta}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px">
      <tr>
        <td style="background:#1c2023;border:1px solid #262b2e;border-radius:10px;padding:16px;text-align:center;width:50%">
          <div style="color:#00e5a0;font-size:26px;font-weight:800;font-family:monospace">{time_str}</div>
          <div style="color:#5b646a;font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-top:4px">Tiempo</div>
        </td>
        <td style="width:10px"></td>
        <td style="background:#1c2023;border:1px solid #262b2e;border-radius:10px;padding:16px;text-align:center;width:50%">
          <div style="color:#eef1f2;font-size:26px;font-weight:800">{pos}</div>
          <div style="color:#5b646a;font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-top:4px">Posición{(' · ' + category) if category else ''}</div>
        </td>
      </tr>
      {link}
    </table>
  </td></tr>
  <tr><td style="background:#0f1213;padding:16px 24px;border-top:1px solid #262b2e;color:#5b646a;font-size:11px;text-align:center">
    Resultados oficiales de cronometraje · ChronoTrack
  </td></tr>
</table>
</body></html>"""
