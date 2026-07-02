@echo off
setlocal EnableDelayedExpansion
title LiveRun - Build
cd /d "%~dp0"

echo.
echo ============================================================
echo  LiveRun - Build completo
echo ============================================================
echo.

:: --- Leer y auto-incrementar version (patch: 2.0 -^> 2.1 -^> ...) ---
for /f "delims=" %%v in ('python -c "v=open('version.txt').read().strip();p=v.split('.');p[-1]=str(int(p[-1])+1);nv='.'.join(p);open('version.txt','w').write(nv);print(nv)"') do set VERSION=%%v

if "%VERSION%"=="" (
    echo ERROR: No se pudo leer version.txt
    pause & exit /b 1
)
echo  Version: v%VERSION%
echo.

:: --- 1. Frontend ---
echo [1/3] Compilando frontend...
cd /d "%~dp0frontend"
call npm run build
if errorlevel 1 (
    echo ERROR: Fallo el build del frontend
    pause & exit /b 1
)
cd /d "%~dp0"
echo     OK - frontend compilado
echo.

:: --- 2. PyInstaller ---
echo [2/3] Empaquetando con PyInstaller...
python -m PyInstaller LiveRun.spec --clean --noconfirm
if errorlevel 1 (
    echo ERROR: Fallo PyInstaller
    pause & exit /b 1
)
echo     OK - dist\LiveRun generado
echo.

:: --- 3. Inno Setup ---
echo [3/3] Creando instalador v%VERSION%...
set ISCC="%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe"
if not exist %ISCC% set ISCC="C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
if not exist %ISCC% set ISCC="C:\Program Files\Inno Setup 6\ISCC.exe"

if not exist %ISCC% (
    echo ERROR: No se encontro Inno Setup. Instalar desde:
    echo        https://jrsoftware.org/isdl.php
    pause & exit /b 1
)

if not exist installer mkdir installer
%ISCC% /DAppVersion=%VERSION% LiveRun_Setup.iss
if errorlevel 1 (
    echo ERROR: Fallo Inno Setup
    pause & exit /b 1
)

echo.
echo ============================================================
echo  Listo!  installer\LiveRun_Setup_v%VERSION%.exe
echo ============================================================
echo.
start "" "installer"
pause
