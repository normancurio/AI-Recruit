#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$ROOT_DIR/.logs/dev"
PID_DIR="$ROOT_DIR/.pids/dev"
SESSION_PREFIX="ai-recruit"

mkdir -p "$LOG_DIR" "$PID_DIR"

load_node() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1090
    . "$NVM_DIR/nvm.sh"
  fi
}

kill_pid_file() {
  local name="$1"
  local pid_file="$PID_DIR/$name.pid"
  if [ ! -f "$pid_file" ]; then
    return
  fi
  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  rm -f "$pid_file"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "Stopping $name pid=$pid"
    kill "$pid" 2>/dev/null || true
  fi
}

kill_screen_session() {
  local name="$1"
  local session="$SESSION_PREFIX-$name"
  if command -v screen >/dev/null 2>&1 && screen -ls 2>/dev/null | grep -q "[.]$session[[:space:]]"; then
    echo "Stopping screen session $session"
    screen -S "$session" -X quit 2>/dev/null || true
  fi
}

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -z "$pids" ]; then
    return
  fi
  echo "Stopping port $port: $pids"
  kill $pids 2>/dev/null || true
}

wait_ports_down() {
  local ports=("$@")
  local i
  for i in {1..20}; do
    local any=""
    local port
    for port in "${ports[@]}"; do
      if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
        any="1"
      fi
    done
    [ -z "$any" ] && return 0
    sleep 0.3
  done
  for port in "${ports[@]}"; do
    local pids
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [ -n "$pids" ]; then
      echo "Force stopping port $port: $pids"
      kill -9 $pids 2>/dev/null || true
    fi
  done
}

start_service() {
  local name="$1"
  local cwd="$2"
  shift 2
  local log_file="$LOG_DIR/$name.log"
  local session="$SESSION_PREFIX-$name"
  echo "Starting $name, log: $log_file"
  : >"$log_file"
  if command -v screen >/dev/null 2>&1; then
    LOG_FILE="$log_file" screen -dmS "$session" bash -lc '
      cd "$0"
      export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
      if [ -s "$NVM_DIR/nvm.sh" ]; then
        . "$NVM_DIR/nvm.sh"
      fi
      exec "$@" >>"$LOG_FILE" 2>&1
    ' "$cwd" "$@"
    echo "screen:$session" >"$PID_DIR/$name.pid"
    return
  fi
  nohup bash -lc '
    cd "$0"
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    if [ -s "$NVM_DIR/nvm.sh" ]; then
      . "$NVM_DIR/nvm.sh"
    fi
    exec "$@"
  ' "$cwd" "$@" >"$log_file" 2>&1 &
  echo "$!" >"$PID_DIR/$name.pid"
}

wait_http() {
  local name="$1"
  local url="$2"
  local i
  for i in {1..60}; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "OK $name $url"
      return 0
    fi
    sleep 1
  done
  echo "WARN $name did not respond at $url"
  return 1
}

ensure_h5_index() {
  local index_file="$ROOT_DIR/miniapp-candidate/dist/index.html"
  mkdir -p "$(dirname "$index_file")"
  cat >"$index_file" <<'HTML'
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
    />
    <title>申朴智能招聘</title>
  </head>
  <body>
    <div id="app"></div>
    <script src="/remoteEntry.js"></script>
    <script src="/runtime.js"></script>
    <script src="/app.js"></script>
  </body>
</html>
HTML
}

wait_h5() {
  local url="http://127.0.0.1:10086/"
  local i
  for i in {1..80}; do
    local html
    html="$(curl -fsS "$url" 2>/dev/null || true)"
    if printf '%s' "$html" | grep -q '<title>listing directory /</title>'; then
      ensure_h5_index
    elif printf '%s' "$html" | grep -q '申朴智能招聘'; then
      echo "OK Candidate H5 $url"
      return 0
    fi
    sleep 1
  done
  echo "WARN Candidate H5 did not respond with app html at $url"
  return 1
}

echo "Restarting AI-Recruit dev services..."

kill_screen_session api
kill_screen_session admin
kill_screen_session h5
kill_pid_file api
kill_pid_file admin
kill_pid_file h5
kill_port 3011
kill_port 3010
kill_port 10086
kill_port 24679
wait_ports_down 3011 3010 10086 24679

start_service api "$ROOT_DIR" npm run dev:api
start_service admin "$ROOT_DIR" env ADMIN_UI_PORT=3010 ADMIN_API_UPSTREAM=http://127.0.0.1:3011 npm run dev
start_service h5 "$ROOT_DIR/miniapp-candidate" npm run dev:h5
ensure_h5_index

echo
echo "Waiting for services..."
wait_http "API" "http://127.0.0.1:3011/api/health" || true
wait_http "Admin" "http://127.0.0.1:3010/" || true
wait_h5 || true

echo
echo "Done."
echo "Admin:        http://127.0.0.1:3010"
echo "API health:   http://127.0.0.1:3011/api/health"
echo "Candidate H5: http://127.0.0.1:10086/"
echo "Logs:         $LOG_DIR"
