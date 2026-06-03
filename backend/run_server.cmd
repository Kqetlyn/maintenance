@echo off
cd /d "%~dp0"
set "PYTHON_EXE="
for /f "delims=" %%F in ('dir /b /s "%LocalAppData%\Python\pythoncore-*\python.exe" 2^>nul') do (
    set "PYTHON_EXE=%%F"
    goto :run
)
set "PYTHON_EXE=python"

:run
"%PYTHON_EXE%" app.py
pause
