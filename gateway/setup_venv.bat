@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
    echo Python was not found. Install Python and enable PATH support.
    pause
    exit /b 1
)

python -m venv "%~dp0.venv"
if errorlevel 1 (
    echo Failed to create the virtual environment.
    pause
    exit /b 1
)

echo Virtual environment ready: %~dp0.venv
pause
