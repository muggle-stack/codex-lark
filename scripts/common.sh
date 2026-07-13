#!/usr/bin/env bash

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

dotenv_value() {
  local key="$1"
  local file="${2:-$ROOT_DIR/.env}"
  [[ -f "$file" ]] || return 0
  local value
  value="$(sed -n "s/^${key}=//p" "$file" | head -n 1)"
  value="${value#\"}"
  value="${value%\"}"
  value="${value#\'}"
  value="${value%\'}"
  printf '%s' "$value"
}

launchd_label() {
  local configured
  configured="$(dotenv_value LARK_CODEX_LAUNCHD_LABEL)"
  printf '%s' "${LARK_CODEX_LAUNCHD_LABEL:-${configured:-io.codex-lark.bridge}}"
}
