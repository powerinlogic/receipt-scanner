@echo off
cd /d "%~dp0"

echo Checking Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found. Install Python 3.11+ from python.org
    pause
    exit /b 1
)

if not exist ".venv" (
    echo Creating virtual environment...
    python -m venv .venv
)

echo Activating virtual environment...
call .venv\Scripts\activate.bat

echo Installing dependencies...
pip install -r requirements.txt --quiet

if not exist ".env" (
    copy .env.example .env
    echo.
    echo  *** Please edit .env and add your ANTHROPIC_API_KEY, then re-run this script. ***
    echo.
    pause
    exit /b 1
)

findstr /C:"your_api_key_here" .env >nul
if not errorlevel 1 (
    echo.
    echo  *** Please edit .env and replace "your_api_key_here" with your actual API key. ***
    echo.
    notepad .env
    pause
    exit /b 1
)

echo.
echo Starting Receipt Scanner at http://127.0.0.1:5000
echo Press Ctrl+C to stop.
echo.
start "" http://127.0.0.1:5000
python app.py

pause
