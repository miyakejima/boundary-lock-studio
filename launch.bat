@echo off
setlocal
title Boundary Lock Studio

rem Always serve files from the folder containing this launcher.
cd /d "%~dp0"

set "PORT=4173"
for /f %%P in ('powershell.exe -NoProfile -Command "$l=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$l.Start();$p=$l.LocalEndpoint.Port;$l.Stop();$p"') do set "PORT=%%P"
set "URL=http://127.0.0.1:%PORT%/?v=4.5.0"

echo.
echo   Boundary Lock Studio
echo   Local - Deterministic - No AI
echo   --------------------------------
echo.

where python.exe >nul 2>&1
if not errorlevel 1 (
    python.exe --version >nul 2>&1
    if not errorlevel 1 goto run_python
)

where py.exe >nul 2>&1
if not errorlevel 1 goto run_py

where node.exe >nul 2>&1
if not errorlevel 1 goto run_node

echo ERROR: Python or Node.js could not be found.
echo.
echo Install Python from https://www.python.org/downloads/
echo or Node.js from https://nodejs.org/
echo.
pause
exit /b 1

:open_browser
if not defined BOUNDARY_LOCK_NO_BROWSER start "" "%URL%"
exit /b 0

:run_python
echo Starting on %URL% using Python...
echo Keep this window open while using the tool.
echo Press Ctrl+C here when you are finished.
echo.
call :open_browser
python.exe -m http.server %PORT% --bind 127.0.0.1
goto server_stopped

:run_py
echo Starting on %URL% using Python launcher...
echo Keep this window open while using the tool.
echo Press Ctrl+C here when you are finished.
echo.
call :open_browser
py.exe -m http.server %PORT% --bind 127.0.0.1
goto server_stopped

:run_node
echo Starting on %URL% using Node.js...
echo Keep this window open while using the tool.
echo Press Ctrl+C here when you are finished.
echo.
call :open_browser
node.exe server.js
goto server_stopped

:server_stopped
echo.
echo The Boundary Lock Studio server stopped.
echo If an error appeared above, leave this window open and review it.
echo.
pause
exit /b %errorlevel%
