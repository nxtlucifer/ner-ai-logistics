@echo off
REM Double-click me. Works from anywhere: %~dp0 is this file's own folder, so
REM the launcher does not care what the current directory is.
title NER Fleet Intelligence - demo
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Demo.ps1" %*
echo.
pause
