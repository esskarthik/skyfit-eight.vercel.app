#!/bin/bash
# SKYFIT ZONE - One-command bash launcher
# Usage: bash start.sh         # start backend + open frontend
#        bash start.sh --install
#        bash start.sh --test

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
PORT="${PORT:-4000}"

echo "🏋️  SKYFIT ZONE — $ROOT"
echo "----------------------------------------"

if [[ "$1" == "--install" ]]; then
  echo "📦 Installing backend deps..."
  npm install --prefix "$BACKEND"
  echo "✅ Install done"
  exit 0
fi

# Install if node_modules missing
if [ ! -d "$BACKEND/node_modules" ]; then
  echo "📦 Installing deps (first run)..."
  npm install --prefix "$BACKEND" --silent
fi

# Kill old instance on port
if command -v lsof >/dev/null 2>&1; then
  PID=$(lsof -ti :$PORT || true)
  [ -n "$PID" ] && { echo "Killing old PID $PID on :$PORT"; kill -9 $PID || true; sleep 1; }
elif command -v netstat >/dev/null 2>&1; then
  echo "(skip kill - use: taskkill //F //IM node.exe on Windows)"
fi

echo "🚀 Starting backend on http://localhost:$PORT ..."
# Start backend in background
nohup node "$BACKEND/server.js" > "$BACKEND/server.log" 2>&1 &
PID=$!
sleep 2

# Health check
echo "🩺 Health check..."
if curl -s http://localhost:$PORT/api/health | grep -q '"ok":true'; then
  echo "✅ API OK → http://localhost:$PORT/api/health"
  curl -s http://localhost:$PORT/api/health
  echo
else
  echo "❌ API not responding — check $BACKEND/server.log"
  tail -20 "$BACKEND/server.log" || true
  exit 1
fi

# Show routes
echo "----------------------------------------"
echo "Frontend : http://localhost:$PORT/"
echo "API      : http://localhost:$PORT/api/plans"
echo "Trainers : http://localhost:$PORT/api/trainers"
echo "Health   : http://localhost:$PORT/api/health"
echo "Log      : tail -f $BACKEND/server.log"
echo "PID      : $PID"
echo "----------------------------------------"

if [[ "$1" == "--test" ]]; then
  echo "🧪 Test checkout with trainer..."
  curl -s -X POST http://localhost:$PORT/api/checkout \
    -H "Content-Type: application/json" \
    -d '{"planId":"transform-12w","member":{"name":"Bash Test","email":"bash@test.in","phone":"9000012345"},"startDate":"2026-08-21","trainerId":"t-naveen","payment":{"method":"card","transactionId":"BASH001"}}' | head -c 500
  echo
fi

# Try open browser
if command -v xdg-open >/dev/null 2>&1; then xdg-open http://localhost:$PORT/ &
elif command -v open >/dev/null 2>&1; then open http://localhost:$PORT/ &
elif command -v cmd.exe >/dev/null 2>&1; then cmd.exe /c start http://localhost:$PORT/ &
fi

echo "✅ Done. Press Ctrl+C to keep running. To stop: kill $PID  or  pkill -f 'node.*server.js'"
wait $PID 2>/dev/null || true
