@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 22 or later is required. & pause & exit /b 1)
if not exist node_modules call npm install
start "" http://localhost:3000
call npm run dev
