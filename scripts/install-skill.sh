#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
SOURCE="$ROOT_DIR/skills/codex-lark"
CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
TARGET="$CODEX_HOME_DIR/skills/codex-lark"
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
echo "installed Codex skill: $TARGET -> $SOURCE"
