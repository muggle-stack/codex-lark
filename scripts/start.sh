#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

mkdir -p .lark-codex

if [[ -f .lark-codex/bridge.pid ]]; then
  OLD_PID="$(cat .lark-codex/bridge.pid)"
  if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "already running pid=$OLD_PID"
    exit 0
  fi
fi

nohup node src/bridge.mjs >> .lark-codex/bridge.log 2>&1 < /dev/null &
PID="$!"
echo "$PID" > .lark-codex/bridge.pid
echo "started pid=$PID"

sleep 2
if ! kill -0 "$PID" 2>/dev/null; then
  echo "bridge exited during startup; last log lines:" >&2
  tail -80 .lark-codex/bridge.log >&2 || true
  exit 1
fi

tail -40 .lark-codex/bridge.log
