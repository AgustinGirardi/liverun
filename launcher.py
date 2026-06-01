"""
ChronoTrack Launcher
Abre la aplicación como ventana de escritorio (pywebview + Edge WebView2).
Muestra pantalla de carga inmediatamente mientras el servidor arranca en segundo plano.
"""
import sys
import os
import time
import threading
from pathlib import Path

PORT  = 8001
TITLE = "ChronoTrack"

LOADING_HTML = """<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 100%; height: 100%;
    background: #0d0f10;
    font-family: Arial, Helvetica, sans-serif;
    color: #e8eaeb;
    display: flex; align-items: center; justify-content: center;
  }
  .wrap { text-align: center; }
  .logo { font-size: 32px; font-weight: 900; letter-spacing: -1px; color: #00e5a0; margin-bottom: 6px; }
  .logo span { color: #4b5563; font-weight: 300; }
  .sub { font-size: 11px; letter-spacing: 3px; text-transform: uppercase; color: #374151; margin-bottom: 36px; }
  .bar-wrap { width: 200px; height: 3px; background: #1c1f21; border-radius: 99px; margin: 0 auto; overflow: hidden; }
  .bar {
    height: 100%; width: 40%; background: #00e5a0;
    border-radius: 99px;
    animation: slide 1.2s ease-in-out infinite;
  }
  @keyframes slide {
    0%   { transform: translateX(-100%); }
    100% { transform: translateX(600%); }
  }
  .msg { margin-top: 20px; font-size: 12px; color: #374151; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="logo">Chrono<span>Track</span></div>
    <div class="sub">Race Timing System</div>
    <div class="bar-wrap"><div class="bar"></div></div>
    <div class="msg">Iniciando...</div>
  </div>
</body>
</html>"""

ERROR_HTML = """<!DOCTYPE html>
<html>
<head><meta charset="UTF-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#0d0f10; font-family:Arial,sans-serif; color:#e8eaeb;
         display:flex; align-items:center; justify-content:center; height:100vh; }
  .wrap { text-align:center; max-width:400px; }
  h2 { color:#ff4d4d; margin-bottom:12px; }
  p  { color:#525a60; font-size:13px; line-height:1.6; }
  .tip { margin-top:16px; background:#1c1f21; border-radius:6px; padding:10px 14px;
         font-size:12px; color:#8a9299; text-align:left; }
</style>
</head>
<body>
  <div class="wrap">
    <h2>No se pudo iniciar el servidor</h2>
    <p>El servidor interno tardó demasiado en responder.</p>
    <div class="tip">Revisá el archivo <strong>chronotrack.log</strong> para más detalles.</div>
  </div>
</body>
</html>"""


def _setup_logging(base: Path):
    log_path = base / "chronotrack.log"
    try:
        if log_path.exists() and log_path.stat().st_size > 1_000_000:
            log_path.rename(base / "chronotrack.log.old")
        sys.stderr = open(str(log_path), "a", encoding="utf-8", buffering=1)
    except Exception:
        pass


def run_server():
    import uvicorn
    from backend.main import app
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")


def wait_for_server(timeout: float = 30.0) -> bool:
    import urllib.request
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/health", timeout=1)
            return True
        except Exception:
            time.sleep(0.2)
    return False


def main():
    # ── Directorio base ────────────────────────────────────────────────────
    if getattr(sys, "frozen", False):
        BASE = Path(sys.executable).parent
        _setup_logging(BASE)
    else:
        BASE = Path(__file__).parent

    os.chdir(BASE)
    sys.path.insert(0, str(BASE))

    if getattr(sys, "frozen", False):
        import multiprocessing
        multiprocessing.freeze_support()

    # ── Servidor en segundo plano ──────────────────────────────────────────
    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()

    # ── Ventana de escritorio ──────────────────────────────────────────────
    import webview

    window = webview.create_window(
        title=TITLE,
        html=LOADING_HTML,          # pantalla de carga inmediata
        width=1400,
        height=860,
        min_size=(1024, 640),
        background_color="#0d0f10",
    )

    def on_shown():
        """Se ejecuta cuando la ventana ya está visible — espera el servidor y navega."""
        if wait_for_server(timeout=30):
            window.load_url(f"http://127.0.0.1:{PORT}")
        else:
            window.load_html(ERROR_HTML)

    # on_shown corre en un thread separado para no bloquear la UI
    webview.start(on_shown, debug=False)


if __name__ == "__main__":
    main()
