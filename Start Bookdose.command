#!/bin/bash
cd -- "$(dirname -- "$0")" || exit 1
need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "$2"
    read -r -p "Press Enter to close..."
    exit 1
  fi
}
need python3 "Please install Python 3.10 or newer, then open this file again."
need npm "Please install Node.js 20 or newer (https://nodejs.org), then open this file again."
if [ ! -d frontend/node_modules ]; then
  echo "Installing the web app (first run only)..."
  (cd frontend && npm install) || exit 1
fi
if [ ! -f frontend/.next/BUILD_ID ]; then
  echo "Building the web app (first run, or after deleting frontend/.next)..."
  (cd frontend && npm run build) || exit 1
fi
echo "Bookdose Customer Service"
echo "Open http://localhost:3000 in your browser."
echo "Keep this window open while using Bookdose. Press Ctrl+C to stop."
python3 app.py --port 8787 &
API=$!
trap 'kill "$API" 2>/dev/null' EXIT
(cd frontend && npm start)
read -r -p "Press Enter to close..."
