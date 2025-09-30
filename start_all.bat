@echo off
REM 1) Start FastAPI (port 8000)
start "" cmd /c "cd /d D:\Freelance\RegShield\Regshield\Backend && .venv\Scripts\python.exe server_app.py"

REM 2) Start Flask proxy/auth (port 5001)
start "" cmd /c "cd /d D:\Freelance\RegShield\Regshield\Backend && .venv\Scripts\python.exe app.py"

REM 3) Open browser to the UI (served by Flask as per Option A)
start "" "http://127.0.0.1:5001/login.html"
