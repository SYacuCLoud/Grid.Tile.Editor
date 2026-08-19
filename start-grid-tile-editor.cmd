@echo off
title Grid Tile Editor
cd /d "C:\_DX\Grid.Tile.Editor"
echo ===================================================
echo   Starting Grid Tile Editor (http://localhost:3000)
echo ===================================================
start /b cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3000"
npm start
