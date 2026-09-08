#!/bin/bash
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v python3 >/dev/null 2>&1; then
  echo "Please install Python 3.10 or newer, then open this file again."
  read -r -p "Press Enter to close..."
  exit 1
fi
echo "Bookdose Customer Service"
echo "Open http://localhost:8787 in your browser."
echo "Keep this window open while using Bookdose. Press Ctrl+C to stop."
python3 app.py --port 8787
read -r -p "Press Enter to close..."
