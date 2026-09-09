@echo off
REM Double-click me AFTER Start-Demo. Opens a Chrome window whose GEOLOCATION is
REM simulated along the approved Assam route - everything else in the app is real.
title NER Fleet Intelligence - simulated Assam journey
cd /d "%~dp0demo"
if not exist "node_modules\playwright" (
  echo.
  echo   The demo tools are not installed yet. This is a ONE-TIME step:
  echo.
  echo       cd "%~dp0demo"
  echo       npm install
  echo.
  pause
  exit /b 1
)
node simulate-journey.js %*
pause
