#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

export BIND_ADDR="${BIND_ADDR:-127.0.0.1:8080}"
export DATABASE_URL="${DATABASE_URL:-sqlite://$BACKEND_DIR/sloc.db}"
export ANALYSIS_CONCURRENCY="${ANALYSIS_CONCURRENCY:-2}"
export VITE_API_BASE="${VITE_API_BASE:-http://$BIND_ADDR}"

backend_pid=""
frontend_pid=""

cleanup() {
  echo
  echo "Stopping local services..."
  if [[ -n "$frontend_pid" ]] && kill -0 "$frontend_pid" 2>/dev/null; then
    kill "$frontend_pid" 2>/dev/null || true
  fi
  if [[ -n "$backend_pid" ]] && kill -0 "$backend_pid" 2>/dev/null; then
    kill "$backend_pid" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_command cargo
require_command npm

if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  echo "Installing frontend dependencies..."
  (cd "$FRONTEND_DIR" && npm install)
fi

echo "Starting backend on http://$BIND_ADDR"
(cd "$BACKEND_DIR" && cargo run) &
backend_pid="$!"

echo "Starting frontend on http://127.0.0.1:5173"
(cd "$FRONTEND_DIR" && npm run dev -- --port 5173) &
frontend_pid="$!"

echo
echo "Local OctoCount is starting:"
echo "  API: http://$BIND_ADDR"
echo "  Web: http://127.0.0.1:5173"
echo
echo "Press Ctrl+C to stop both services."

wait -n "$backend_pid" "$frontend_pid"
