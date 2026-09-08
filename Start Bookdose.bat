@echo off
cd /d "%~dp0"
echo Bookdose Customer Service
echo Open http://localhost:8787 in your browser.
echo Keep this window open while using Bookdose. Press Ctrl+C to stop.
py -3 app.py --port 8787
pause
