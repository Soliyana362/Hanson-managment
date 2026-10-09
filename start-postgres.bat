@echo off
rem Starts the Glorious HR PostgreSQL server against the project data folder
rem (launches postgres.exe directly with a clean PATH to avoid 0xC0000142).
set PATH=C:\Windows\System32;C:\Windows;C:\Program Files\PostgreSQL\18\bin
set SYSTEMROOT=C:\Windows
set COMSPEC=C:\Windows\System32\cmd.exe

if exist "%~dp0postgres-data\postmaster.pid" (
  echo PostgreSQL is already running.
  exit /b 0
)

"C:\Program Files\PostgreSQL\18\bin\postgres.exe" -D "%~dp0postgres-data"