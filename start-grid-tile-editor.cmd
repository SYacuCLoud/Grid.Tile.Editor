@echo off
title Grid Tile Editor
cd /d "C:\_DX\Grid.Tile.Editor"
set PORT=3100
echo ===================================================
echo   Starting Grid Tile Editor (http://localhost:3100)
echo ===================================================
start /b cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3100"
npm start
