@echo off
rem Grid Tile Editor - make sure the 3100 service is up, then open it in the browser.
call "%~dp0scripts\service.cmd" start
if errorlevel 1 (
  echo.
  echo The service did not start. Run scripts\service.cmd status or check logs\server.log
  pause
  exit /b 1
)
start "" http://localhost:3100
