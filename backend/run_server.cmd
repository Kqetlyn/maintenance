@echo off
cd /d "%~dp0"
rem Local dev launcher: enable Flask auto-reload so backend code changes take
rem effect without a manual restart (prevents "backend unavailable" after edits).
rem Deployment uses its own entrypoint and is unaffected by this file.
if not defined FLASK_DEBUG set "FLASK_DEBUG=1"
set "PYTHON_EXE="
for /f "delims=" %%F in ('dir /b /s "%LocalAppData%\Python\pythoncore-*\python.exe" 2^>nul') do (
    set "PYTHON_EXE=%%F"
    goto :run
)
set "PYTHON_EXE=python"

:run
"%PYTHON_EXE%" app.py
pause
