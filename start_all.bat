@echo off
setlocal enableextensions

set "BACKEND_DIR=C:\Users\hp\Downloads\Regshield\Backend"
set "PY=%BACKEND_DIR%\.venv\Scripts\python.exe"
set "MLFLOW=%BACKEND_DIR%\.venv\Scripts\mlflow.exe"
set "MLFLOW_TRACKING_URI=http://127.0.0.1:5000"
set "SEARCH_URL=http://127.0.0.1:8000"

start "MLflow" cmd /k "cd /d %BACKEND_DIR% && %MLFLOW% ui --host 127.0.0.1 --port 5000"

echo Waiting MLflow...
:wait_mlflow
curl -fs http://127.0.0.1:5000 >nul 2>&1
if errorlevel 1 (
    timeout /t 1 >nul
    goto wait_mlflow
)

start "FastAPI" cmd /k "cd /d %BACKEND_DIR% && %PY% server_app.py"

echo Waiting FastAPI...
:wait_fastapi
curl -fs http://127.0.0.1:8000/health >nul 2>&1
if errorlevel 1 (
    timeout /t 1 >nul
    goto wait_fastapi
)

start "Flask" cmd /k "cd /d %BACKEND_DIR% && %PY% app.py"

echo Waiting Flask...
:wait_flask
curl -fs http://127.0.0.1:5001/health >nul 2>&1
if errorlevel 1 (
    timeout /t 1 >nul
    goto wait_flask
)

start "" "http://127.0.0.1:5001/login.html"
start "" "http://127.0.0.1:5000"

echo All set
endlocal