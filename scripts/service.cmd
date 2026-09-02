@echo off
setlocal EnableExtensions
rem ============================================================
rem  Grid Tile Editor - always-on service on port 3100
rem
rem    service install    register auto-start at logon (Task Scheduler) and start now
rem    service uninstall  remove auto-start and stop
rem    service start      start the daemon (hidden window)
rem    service stop       stop daemon and server
rem    service restart    restart the server process (daemon keeps running)
rem    service deploy     npm run build -> snapshot dist to .serve\dist -> restart
rem    service snapshot   copy existing dist to .serve\dist -> restart (no build)
rem    service status     show state (default)
rem    service log        tail logs\server.log
rem
rem  The server runs from .serve\dist (a snapshot), so `npm run build` and
rem  `npm test` may rewrite dist\ freely without touching the live service.
rem  Dev / test servers use port 3200 (npm run dev, npm run start:test).
rem ============================================================
set "ROOT=%~dp0.."
for %%I in ("%ROOT%") do set "ROOT=%%~fI"
set "SERVE=%ROOT%\.serve"
set "LOCK=%SERVE%\daemon.lock"
set "STOP=%SERVE%\stop.flag"
set "LOG=%ROOT%\logs\server.log"
set "PORT=3100"
set "TASK=Grid Tile Editor"
set "VBS=%ROOT%\scripts\start-hidden.vbs"
rem Auto-start: Task Scheduler when allowed (needs elevation for ONLOGON), else the user's Startup folder.
set "STARTUP_VBS=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Grid Tile Editor.vbs"
if not exist "%SERVE%" mkdir "%SERVE%"

set "CMD=%~1"
if not defined CMD set "CMD=status"
if /i "%CMD%"=="install"   goto install
if /i "%CMD%"=="uninstall" goto uninstall
if /i "%CMD%"=="start"     goto start
if /i "%CMD%"=="stop"      goto stop
if /i "%CMD%"=="restart"   goto restart
if /i "%CMD%"=="deploy"    goto deploy
if /i "%CMD%"=="snapshot"  goto snapshot
if /i "%CMD%"=="status"    goto status
if /i "%CMD%"=="log"       goto log
echo unknown command: %CMD%
echo usage: service.cmd install ^| uninstall ^| start ^| stop ^| restart ^| deploy ^| snapshot ^| status ^| log
exit /b 2

:install
schtasks /Create /F /TN "%TASK%" /SC ONLOGON /DELAY 0000:20 /TR "wscript.exe //B \"%VBS%\"" >nul 2>&1
if not errorlevel 1 (
  echo [install] auto-start at logon registered - scheduled task "%TASK%"
  goto install_start
)
> "%STARTUP_VBS%" echo ' Grid Tile Editor auto-start - written by scripts\service.cmd install
>> "%STARTUP_VBS%" echo CreateObject("WScript.Shell").Run "wscript.exe //B ""%VBS%""", 0, False
if not exist "%STARTUP_VBS%" (
  echo [install] could not register auto-start - scheduled task denied and Startup folder not writable
  exit /b 1
)
echo [install] auto-start at logon registered - Startup folder item "Grid Tile Editor.vbs"
:install_start
if not exist "%SERVE%\dist\server\index.js" (
  if not exist "%ROOT%\dist\server\index.js" (
    echo [install] no build found - run "npm run build" and then "service.cmd snapshot"
    exit /b 1
  )
  call :copy_snapshot || exit /b 1
)
call :start_daemon
exit /b

:uninstall
schtasks /Delete /F /TN "%TASK%" >nul 2>&1 && echo [uninstall] scheduled task removed
if exist "%STARTUP_VBS%" del "%STARTUP_VBS%" && echo [uninstall] Startup folder item removed
echo [uninstall] auto-start is no longer registered
call :stop_all
exit /b

:start
call :start_daemon
exit /b

:stop
call :stop_all
exit /b

:restart
call :is_daemon_running
if errorlevel 1 (
  echo [restart] daemon is not running - starting it
  call :start_daemon
  exit /b
)
call :kill_listener
echo [restart] daemon relaunches the server in a few seconds
call :wait_up 40
exit /b

:deploy
echo [deploy] npm run build ...
pushd "%ROOT%"
call npm run build
set "RC=%errorlevel%"
popd
if not "%RC%"=="0" (
  echo [deploy] build failed - live service untouched
  exit /b 1
)
goto snapshot

:snapshot
if not exist "%ROOT%\dist\server\index.js" (
  echo [snapshot] dist\server\index.js not found - run "npm run build" first
  exit /b 1
)
call :stop_all
call :copy_snapshot || exit /b 1
call :start_daemon
exit /b

:status
call :find_listener
if defined LPID (echo server    : running on port %PORT% - PID %LPID%) else (echo server    : stopped)
call :is_daemon_running && (echo daemon    : running) || (echo daemon    : stopped)
schtasks /Query /TN "%TASK%" >nul 2>&1 && (echo auto-start: registered - scheduled task "%TASK%") || if exist "%STARTUP_VBS%" (echo auto-start: registered - Startup folder item "Grid Tile Editor.vbs") else (echo auto-start: not registered)
if exist "%SERVE%\dist\server\index.js" (for %%A in ("%SERVE%\dist\server\index.js") do echo snapshot  : .serve\dist  %%~tA) else (echo snapshot  : none - run "service.cmd deploy")
if exist "%ROOT%\dist\server\index.js" for %%A in ("%ROOT%\dist\server\index.js") do echo build     : dist         %%~tA
echo url       : http://localhost:%PORT%
exit /b

:log
if not exist "%LOG%" (
  echo no log yet - %LOG%
  exit /b 0
)
powershell -NoProfile -Command "Get-Content -Tail 30 -LiteralPath '%LOG%'"
exit /b

rem ---------------- helpers ----------------

:start_daemon
call :find_listener
if defined LPID (
  echo [start] already running on port %PORT% - PID %LPID%
  exit /b 0
)
if not exist "%SERVE%\dist\server\index.js" (
  echo [start] no snapshot at .serve\dist - run "service.cmd deploy" or "service.cmd snapshot"
  exit /b 1
)
if exist "%STOP%" del "%STOP%"
call :is_daemon_running
if not errorlevel 1 (
  echo [start] daemon already running - it brings the server up shortly
) else (
  wscript.exe //B "%VBS%"
  echo [start] daemon launched in a hidden window
)
call :wait_up 40
exit /b

:stop_all
type nul > "%STOP%"
call :kill_listener
call :wait_daemon_exit 20
exit /b

:copy_snapshot
robocopy "%ROOT%\dist" "%SERVE%\dist" /MIR /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
  echo [snapshot] robocopy failed
  exit /b 1
)
echo [snapshot] .serve\dist updated from dist
exit /b 0

:kill_listener
call :find_listener
if not defined LPID exit /b 0
taskkill /PID %LPID% /T /F >nul 2>&1
echo [stop] server process killed - PID %LPID%
exit /b 0

:find_listener
set "LPID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do if not defined LPID set "LPID=%%P"
exit /b 0

:is_daemon_running
rem exit 0 = daemon holds daemon.lock, exit 1 = lock is free
2>nul (type nul >> "%LOCK%") && exit /b 1
exit /b 0

:wait_daemon_exit
set /a N=%~1
:wait_daemon_exit_loop
call :is_daemon_running || (
  echo [stop] stopped
  exit /b 0
)
if %N% LEQ 0 (
  echo [stop] daemon still running after %~1s - it exits on its next cycle
  exit /b 1
)
set /a N-=1
ping -n 2 127.0.0.1 >nul
goto wait_daemon_exit_loop

:wait_up
set /a N=%~1
:wait_up_loop
call :find_listener
if defined LPID (
  echo [ok] http://localhost:%PORT%  - PID %LPID%
  exit /b 0
)
if %N% LEQ 0 (
  echo [warn] server did not come up within %~1s - see logs\server.log
  exit /b 1
)
set /a N-=1
ping -n 2 127.0.0.1 >nul
goto wait_up_loop
