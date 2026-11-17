@echo off
rem Updates the public GitHub repository to the version in package.json (checks, commit, push, tag, new pre-release).
rem Dry run by default. Add -Execute to really do it. Other switches: -SkipChecks -Meta -Message "text".
rem Details: scripts\update-github.ps1 (Get-Help) and docs\PUBLISHING.md.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-github.ps1" %*
exit /b %ERRORLEVEL%
