@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where py >nul 2>nul
if not errorlevel 1 (
    py -3 -m venv "%~dp0.venv"
) else (
    where python >nul 2>nul
    if errorlevel 1 (
        echo Python 3 was not found.
        pause
        exit /b 1
    )
    python -m venv "%~dp0.venv"
)

if errorlevel 1 (
    echo Failed to create the virtual environment.
    pause
    exit /b 1
)

echo Virtual environment ready: %~dp0.venv
pause
