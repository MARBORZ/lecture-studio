@echo off
rem Lecture Studio Uninstall (Windows): double-click. Deletes the app, its settings and the Desktop shortcut; lessons stay unless chosen.
rem Runs from %TEMP%: a folder that is some process's current directory cannot be deleted on Windows.
set "HERE=%~dp0"
cd /d "%TEMP%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%HERE%installer\windows\uninstall.ps1"
