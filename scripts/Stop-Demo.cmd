@echo off
title NER Fleet Intelligence - stop demo
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Stop-Demo.ps1" %*
echo.
pause
