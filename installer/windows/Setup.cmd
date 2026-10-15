@echo off
rem Lecture Studio Setup (Windows): double-click. Installs everything and puts "Lecture Studio" on the Desktop.
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0install.ps1"
