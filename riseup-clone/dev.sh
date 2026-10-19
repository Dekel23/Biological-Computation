#!/usr/bin/env bash
# Start the FastAPI backend (port 8000) and the Vite PWA dev server (port 5173) together.
# Ctrl+C stops both.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

if [ ! -x "$ROOT/backend/.venv/bin/uvicorn" ]; then
  echo "▶ Creating Python virtualenv and installing backend dependencies…"
  python3 -m venv "$ROOT/backend/.venv"
  "$ROOT/backend/.venv/bin/pip" install -q -r "$ROOT/backend/requirements.txt"
fi
if [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo "▶ Installing frontend dependencies…"
  (cd "$ROOT/frontend" && npm install --no-audit --no-fund)
fi

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

(cd "$ROOT/backend" && exec .venv/bin/uvicorn main:app --reload --host 0.0.0.0 --port 8000) &
(cd "$ROOT/frontend" && exec npm run dev) &

echo "▶ API:  http://localhost:8000/docs"
echo "▶ App:  http://localhost:5173"
wait
