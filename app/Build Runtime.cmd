@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Build-Runtime.ps1"
if errorlevel 1 (
  echo.
  echo The build did not finish; the app was not opened.
  pause
  exit /b 1
)
echo.
echo Press any key to open the app, or close this window to skip.
pause >nul
start "" "%~dp0runtime\Temporal Live.exe"
