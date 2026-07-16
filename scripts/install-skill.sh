#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

# Resolve the engine (env wins, then .env, default codex) to pick which skill to install.
ENGINE="${LARK_CODEX_ENGINE:-}"
if [[ -z "$ENGINE" && -f "$ROOT_DIR/.env" ]]; then
  ENGINE="$(grep -E '^LARK_CODEX_ENGINE=' "$ROOT_DIR/.env" | tail -n1 | cut -d= -f2- | tr -d '[:space:]')"
fi
ENGINE="${ENGINE:-codex}"

if [[ "$ENGINE" == "claude" ]]; then
  SOURCE="$ROOT_DIR/skills/claude-lark"
  CLAUDE_HOME_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
  TARGET="$CLAUDE_HOME_DIR/skills/claude-lark"
else
  SOURCE="$ROOT_DIR/skills/codex-lark"
  CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
  TARGET="$CODEX_HOME_DIR/skills/codex-lark"
fi
FORCE=0

if [[ "${1:-}" == "--force" ]]; then
  FORCE=1
elif [[ -n "${1:-}" ]]; then
  echo "usage: $0 [--force]" >&2
  exit 2
fi

mkdir -p "$(dirname "$TARGET")"
if [[ -e "$TARGET" || -L "$TARGET" ]]; then
  if [[ -L "$TARGET" && "$(readlink "$TARGET")" == "$SOURCE" ]]; then
    echo "skill already installed: $TARGET"
    exit 0
  fi
  if [[ "$FORCE" != "1" ]]; then
    echo "refusing to replace existing skill: $TARGET" >&2
    echo "rerun with --force only after reviewing that directory" >&2
    exit 1
  fi
  rm -rf "$TARGET"
fi

ln -s "$SOURCE" "$TARGET"
echo "installed $ENGINE skill: $TARGET -> $SOURCE"
