@echo off
title SonicForge Studio - Offline Audio & Video Workstation
echo ===========================================================
echo       Launching SonicForge Studio (Offline Workstation)
echo ===========================================================
echo Checking Node.js environment...

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not found on your system PATH.
    echo Please install Node.js from https://nodejs.org or run inside your terminal.
    pause
    exit /b 1
)

if not exist "dist\index.html" (
    echo Building production bundle for first-time launch...
    call npm run build
)

echo Starting offline local server on localhost:5173...
echo No internet connection is used or required.
node server.js

pause
