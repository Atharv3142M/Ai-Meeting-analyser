@echo off
REM Local AI Video Recorder - Quick Start Script
REM For Windows 10/11 with Python 3.11

echo ====================================================================
echo   LOCAL AI VIDEO RECORDER - QUICK START
echo   Version 2.0 Production
echo ====================================================================
echo.

REM Check if we're in the right directory
if not exist "server.py" (
    echo ERROR: server.py not found!
    echo Please run this script from the python_backend folder.
    pause
    exit /b 1
)

echo [1/6] Checking Python version...
python --version 2>nul
if errorlevel 1 (
    echo ERROR: Python not found!
    echo Please install Python 3.11 from python.org
    pause
    exit /b 1
)

echo.
echo [2/6] Checking FFmpeg...
ffmpeg -version >nul 2>&1
if errorlevel 1 (
    echo WARNING: FFmpeg not found!
    echo Install with: choco install ffmpeg
    echo Or download from: https://ffmpeg.org/download.html
    echo.
)

echo.
echo [3/6] Checking Ollama...
ollama list >nul 2>&1
if errorlevel 1 (
    echo WARNING: Ollama not found or not running!
    echo Download from: https://ollama.ai
    echo Then run: ollama pull llama3
    echo.
)

echo.
echo [4/6] Checking PyTorch installation...
python -c "import torch; print('PyTorch:', torch.__version__); print('CUDA:', torch.cuda.is_available())" 2>nul
if errorlevel 1 (
    echo PyTorch not installed or needs CUDA support.
    echo.
    echo Installing PyTorch with CUDA 11.8...
    pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu118
    echo.
)

echo.
echo [5/6] Installing Python dependencies...
pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: Failed to install dependencies!
    pause
    exit /b 1
)

echo.
echo [6/6] Initializing database...
if not exist "meetings.db" (
    python -c "import database; database.init_database()"
    echo Database created: meetings.db
) else (
    echo Database already exists: meetings.db
)

echo.
echo ====================================================================
echo   SETUP COMPLETE!
echo ====================================================================
echo.
echo Starting server...
echo.
echo Dashboard: http://127.0.0.1:5000
echo.
echo Press Ctrl+C to stop the server
echo ====================================================================
echo.

REM Start the server
python server.py

pause