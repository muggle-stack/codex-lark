#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .lark-codex/bridge.pid ]]; then
  echo "not running: .lark-codex/bridge.pid missing"
  exit 0
fi

PID="$(cat .lark-codex/bridge.pid)"
if [[ -z "$PID" ]] || ! kill -0 "$PID" 2>/dev/null; then
  echo "not running"
  rm -f .lark-codex/bridge.pid
  exit 0
fi

kill -TERM "$PID"
for _ in {1..20}; do
  if ! kill -0 "$PID" 2>/dev/null; then
    rm -f .lark-codex/bridge.pid
    echo "stopped pid=$PID"
    exit 0
  fi
  sleep 0.2
done

echo "pid=$PID did not exit after SIGTERM" >&2
exit 1
