@echo off
cd /d "%~dp0"
echo Bookdose Customer Service
where py >nul 2>nul || (echo Please install Python 3.10 or newer, then open this file again. & pause & exit /b 1)
where npm >nul 2>nul || (echo Please install Node.js 20 or newer from https://nodejs.org, then open this file again. & pause & exit /b 1)
if not exist "frontend\node_modules" (
  echo Installing the web app ^(first run only^)...
  pushd frontend & call npm install & popd
)
if not exist "frontend\.next\BUILD_ID" (
  echo Building the web app ^(first run, or after deleting frontend\.next^)...
  pushd frontend & call npm run build & popd
)
rem The API runs in this window too, so Ctrl+C stops both.
start "" /b py -3 app.py --port 8787
echo Open http://localhost:3000 in your browser.
echo Keep this window open while using Bookdose. Press Ctrl+C to stop.
cd frontend
call npm start
pause
