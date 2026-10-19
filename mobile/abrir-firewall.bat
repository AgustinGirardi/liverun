@echo off
REM Abre el puerto de Metro (8081) SOLO para la red local 192.168.0.x
REM Clic derecho -> "Ejecutar como administrador".
REM
REM Hace falta porque la red esta clasificada como Publica y Windows rechaza
REM todo lo entrante. Esta regla es lo minimo: un puerto, una subred.
REM Para deshacerlo:  netsh advfirewall firewall delete rule name="Expo Metro 8081"

net session >nul 2>&1
if %errorLevel% neq 0 (
  echo.
  echo   Falta ejecutar como administrador.
  echo   Cerra esta ventana, hace clic derecho en el archivo
  echo   y elegi "Ejecutar como administrador".
  echo.
  pause
  exit /b 1
)

netsh advfirewall firewall delete rule name="Expo Metro 8081" >nul 2>&1
netsh advfirewall firewall add rule name="Expo Metro 8081" dir=in action=allow protocol=TCP localport=8081 remoteip=192.168.0.0/24 profile=any

echo.
echo   Listo. El puerto 8081 quedo abierto para tu red local.
echo.
pause
