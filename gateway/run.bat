@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "VENV=%~dp0.venv"
set "PYTHON=%VENV%\Scripts\python.exe"

where python >nul 2>nul
if errorlevel 1 (
    echo Python was not found. Install Python and enable PATH support.
    pause
    exit /b 1
)

if not exist "%PYTHON%" (
    echo Creating Python virtual environment in:
    echo %VENV%
    python -m venv "%VENV%"
    if errorlevel 1 (
        echo Failed to create virtual environment.
        pause
        exit /b 1
    )
)

if not exist "%PYTHON%" (
    echo Virtual environment Python was not created correctly.
    pause
    exit /b 1
)

echo Starting Nexus URL Gateway using the virtual environment...
"%PYTHON%" gateway.py
if errorlevel 1 pause
