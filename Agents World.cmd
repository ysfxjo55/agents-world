@echo off
rem Windows: double-click to start Agents World and open it in your browser.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is missing. Install it from https://nodejs.org ^(version 22.5 or newer^).
  pause
  exit /b 1
)
if not exist node_modules call npm ci --no-audit --no-fund
rem already running? just open the page
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:4321/ | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 (
  start "" http://localhost:4321
  exit /b 0
)
start "" /b powershell -NoProfile -Command "Start-Sleep 2; Start-Process http://localhost:4321"
node server\start.js
pause
