@echo off
REM Opens the backend and frontend in two separate terminal windows.
cd /d "%~dp0"

echo Starting eSSL K90 Pro ADMS backend (port 8081)...
start "ADMS Backend" cmd /k "cd /d %~dp0backend && npm run dev"

timeout /t 3 /nobreak >nul

echo Starting React dashboard (port 5115)...
start "ADMS Dashboard" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo Backend  : http://localhost:8081
echo Dashboard: http://localhost:5115
echo.
pause
