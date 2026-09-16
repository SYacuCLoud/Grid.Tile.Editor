@echo off
setlocal EnableExtensions
rem ============================================================
rem  Grid Tile Editor - server daemon (port 3100)
rem
rem  - Serves the snapshot in .serve\dist, so dist\ may be rebuilt freely
rem    (npm run build / npm test never touch the live service).
rem  - Relaunches node 5s after it exits. Exits when .serve\stop.flag exists.
rem  - Holds .serve\daemon.lock while running so two daemons cannot coexist.
rem  - Normally launched hidden via scripts\start-hidden.vbs (service.cmd start).
rem ============================================================
set "ROOT=%~dp0.."
for %%I in ("%ROOT%") do set "ROOT=%%~fI"
set "SERVE=%ROOT%\.serve"
set "LOG=%ROOT%\logs\server.log"
set "LOCK=%SERVE%\daemon.lock"
set "STOP=%SERVE%\stop.flag"
set "PORT=3100"
set "NODE_ENV=production"
set "GRID_TILE_DATA_DIR=%ROOT%\.grid-projects"
if not exist "%ROOT%\logs" mkdir "%ROOT%\logs"
if not exist "%SERVE%" mkdir "%SERVE%"
if exist "%STOP%" del "%STOP%"

rem Handle 9 keeps daemon.lock open while :loop runs; a second daemon fails to open it and exits.
rem (The refusal usually cannot be logged: the running daemon's node redirect holds server.log.)
( 9>"%LOCK%" call :loop ) 2>nul || 2>nul >> "%LOG%" echo [%date% %time%] another daemon holds the lock - exiting
exit /b

:loop
if exist "%STOP%" (
  >> "%LOG%" echo [%date% %time%] stop.flag found - daemon exiting
  exit /b 0
)
call :rotate
if not exist "%SERVE%\dist\server\index.js" (
  >> "%LOG%" echo [%date% %time%] no snapshot in .serve\dist - run scripts\service.cmd deploy - retry in 30s
  ping -n 31 127.0.0.1 >nul
  goto loop
)
rem Event logger: a separate Node process subscribes to the broker and writes .grid-projects\.live\events\*.jsonl.
rem (vinext start runs route code in a Cloudflare-compatible runtime without net, so the web server cannot subscribe itself.)
rem It exits at once if another logger is alive (PID file) and stops by itself when stop.flag appears.
set "GRID_SERVE_DIR=%SERVE%"
set "GRID_LIVE_INSTANCE=main"
start "" /b cmd /c "node ""%ROOT%\node_modules\tsx\dist\cli.mjs"" ""%ROOT%\scripts\live-logger.ts"" >> ""%ROOT%\logs\live-logger.log"" 2>&1"
>> "%LOG%" echo [%date% %time%] starting server on port %PORT% from .serve\dist
pushd "%SERVE%"
node "%ROOT%\node_modules\vinext\dist\cli.js" start -p %PORT% >> "%LOG%" 2>&1
set "RC=%errorlevel%"
popd
>> "%LOG%" echo [%date% %time%] server exited with code %RC% - restarting in 5s
ping -n 6 127.0.0.1 >nul
goto loop

:rotate
if not exist "%LOG%" exit /b 0
for %%A in ("%LOG%") do if %%~zA GTR 5242880 (
  if exist "%LOG%.1" del "%LOG%.1"
  move /y "%LOG%" "%LOG%.1" >nul
)
exit /b 0
