@echo off
rem Starts WorkCraft: double-click this file. No administrator rights needed.
rem It sets WorkCraft up the first time (a few minutes), starts it and opens your browser.
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\launcher\bootstrap.ps1" %*
exit /b %errorlevel%
