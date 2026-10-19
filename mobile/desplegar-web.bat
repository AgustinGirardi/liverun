@echo off
REM ============================================================
REM  Publica la app como web en Vercel, lista para el celular.
REM  Doble clic. La primera vez abre el navegador para que entres
REM  a Vercel (podes usar tu cuenta de GitHub).
REM ============================================================
cd /d "%~dp0"
setlocal enabledelayedexpansion

echo.
echo  [1/4] Verificando sesion de Vercel...
call npx --yes vercel@latest whoami >nul 2>&1
if errorlevel 1 (
  echo        No hay sesion. Se abre el navegador para que entres.
  call npx --yes vercel@latest login
  if errorlevel 1 goto :error
)

echo  [2/4] Primer despliegue para averiguar el dominio...
call npx --yes vercel@latest deploy dist --prod --yes --archive=tgz > "%TEMP%\lr_deploy.txt" 2>&1
type "%TEMP%\lr_deploy.txt" | findstr /i "https://"
for /f "tokens=*" %%u in ('findstr /r /c:"^https://" "%TEMP%\lr_deploy.txt"') do set "URL=%%u"
if "!URL!"=="" (
  echo        No se pudo leer el dominio. Revisa la salida de arriba.
  goto :error
)
echo        Dominio: !URL!

echo  [3/4] Reconstruyendo con la API apuntada a ese dominio...
REM Sin esto las llamadas irian al backend directo y el CORS las rechaza.
REM Apuntandolas al propio dominio, el rewrite de vercel.json las reenvia
REM y el navegador las ve como same-origin.
echo EXPO_PUBLIC_API_URL=!URL!> .env.local
call node_modules\.bin\expo export --platform web --clear
if errorlevel 1 goto :error

echo  [4/4] Despliegue final...
call npx --yes vercel@latest deploy dist --prod --yes --archive=tgz
if errorlevel 1 goto :error

echo.
echo  ============================================================
echo   LISTO. Abri !URL! en Chrome del celular.
echo   Menu de Chrome ^> "Agregar a la pantalla de inicio".
echo  ============================================================
echo.
pause
exit /b 0

:error
echo.
echo   Fallo. Mira el mensaje de arriba.
echo.
pause
exit /b 1
