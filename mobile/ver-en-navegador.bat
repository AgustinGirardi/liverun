@echo off
REM Sirve la app como web en la red local. Abrila desde el navegador del
REM telefono en http://<IP de tu PC>:8081
REM Requiere haber corrido abrir-firewall.bat una vez.
cd /d "%~dp0"
title LiveRun - Web
node_modules\.bin\expo start --web
pause
