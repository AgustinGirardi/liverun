# -*- mode: python ; coding: utf-8 -*-
#
# ChronoTrack PyInstaller spec
# Genera un directorio ChronoTrack/ listo para distribuir (más rápido que --onefile).
# Para empaquetar: pyinstaller ChronoTrack.spec
#

from pathlib import Path
import webview, os

BASE = Path('.').resolve()
FRONTEND_DIST = BASE / 'frontend' / 'dist'

# Hooks propios de pywebview para PyInstaller
WEBVIEW_HOOKS = os.path.join(os.path.dirname(webview.__file__), '__pyinstaller')

a = Analysis(
    ['launcher.py'],
    pathex=[str(BASE)],
    binaries=[],
    datas=[
        (str(FRONTEND_DIST), 'frontend/dist'),
        (str(BASE / 'backend'), 'backend'),
    ],
    hiddenimports=[
        # uvicorn internals
        'uvicorn',
        'uvicorn.main',
        'uvicorn.config',
        'uvicorn.server',
        'uvicorn.lifespan.on',
        'uvicorn.lifespan.off',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.http.h11_impl',
        'uvicorn.protocols.http.httptools_impl',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.protocols.websockets.websockets_impl',
        'uvicorn.protocols.websockets.wsproto_impl',
        'uvicorn.logging',
        'uvicorn.loops.auto',
        'uvicorn.loops.asyncio',
        # FastAPI / starlette
        'fastapi',
        'fastapi.middleware.cors',
        'fastapi.staticfiles',
        'fastapi.responses',
        'starlette.middleware.cors',
        'starlette.staticfiles',
        'starlette.responses',
        'starlette.websockets',
        'starlette.routing',
        # SQLAlchemy
        'sqlalchemy',
        'sqlalchemy.dialects.sqlite',
        'sqlalchemy.ext.asyncio',
        'sqlalchemy.orm',
        # aiosqlite
        'aiosqlite',
        # pydantic
        'pydantic',
        'pydantic_core',
        # openpyxl
        'openpyxl',
        'openpyxl.workbook',
        'openpyxl.reader.excel',
        # multipart (para file upload)
        'multipart',
        'python_multipart',
        # h11 / httptools / websockets
        'h11',
        'anyio',
        'anyio._backends._asyncio',
        'click',
        # pywebview + Edge WebView2 (Windows)
        'webview',
        'webview.platforms.winforms',
        'webview.event',
        'webview.window',
        'webview.screen',
        'webview.http',
        'webview.js',
        'clr',
        'pythonnet',
        'proxy_tools',
        'bottle',
        # login con cuenta del portal (account.py usa webbrowser de forma diferida)
        'webbrowser',
    ],
    hookspath=[WEBVIEW_HOOKS],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'matplotlib', 'numpy', 'PIL', 'pytest'],
    noarchive=False,
    optimize=1,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,       # onedir mode (más rápido que onefile)
    name='ChronoTrack',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    console=False,               # Sin terminal visible; errores van a chronotrack.log
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='icon.ico' if Path('icon.ico').exists() else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='ChronoTrack',
)
