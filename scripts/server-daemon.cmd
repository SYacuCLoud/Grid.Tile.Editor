@echo off
title Grid Tile Editor Server
cd /d "C:\_DX\Grid.Tile.Editor"
set PORT=3100
if not exist "logs" mkdir "logs"
:loop
echo [%date% %time%] starting vinext start >> "logs\server.log"
call npm start >> "logs\server.log" 2>&1
echo [%date% %time%] exited, restarting in 5s >> "logs\server.log"
timeout /t 5 /nobreak >nul
goto loop
