#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

OWNER_OPEN_ID=""
WORKDIR="$ROOT_DIR"
INSTALL_LAUNCHD=0
INSTALL_SKILL=1
AUTHORIZE_USER=0

usage() {
  cat <<'EOF'
Usage: scripts/setup.sh [options]

Options:
  --owner-open-id ou_xxx  Owner open_id used for both allowlists
  --workdir PATH          Default Codex workspace
  --install-launchd       Install and start the macOS LaunchAgent
  --authorize-user        Run scoped im/wiki/docs/drive user authorization
  --no-skill              Do not install the bundled Codex skill
  -h, --help              Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --owner-open-id)
      OWNER_OPEN_ID="${2:-}"
      shift 2
      ;;
    --workdir)
      WORKDIR="${2:-}"
      shift 2
      ;;
    --install-launchd)
      INSTALL_LAUNCHD=1
      shift
      ;;
    --authorize-user)
      AUTHORIZE_USER=1
      shift
      ;;
    --no-skill)
      INSTALL_SKILL=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

for command in node codex lark-cli; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "missing required command: $command" >&2
    exit 1
  fi
done

if [[ "$AUTHORIZE_USER" == "1" ]]; then
  lark-cli auth login --domain im,wiki,docs,drive
fi

if [[ ! -f "$ROOT_DIR/.env" ]]; then
  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
  echo "created $ROOT_DIR/.env"
else
  echo "kept existing $ROOT_DIR/.env"
fi

set_env() {
  local key="$1"
  local value="$2"
  local file="$ROOT_DIR/.env"
  local temp
  temp="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN { replaced = 0 }
    index($0, key "=") == 1 { print key "=" value; replaced = 1; next }
    { print }
    END { if (!replaced) print key "=" value }
  ' "$file" > "$temp"
  mv "$temp" "$file"
}

if [[ -z "$OWNER_OPEN_ID" ]]; then
  OWNER_OPEN_ID="$(
    (LARKSUITE_CLI_NO_UPDATE_NOTIFIER=1 LARKSUITE_CLI_NO_SKILLS_NOTIFIER=1 \
      lark-cli auth status --json --verify 2>/dev/null || true) |
      node -e '
        let input = "";
        process.stdin.on("data", chunk => input += chunk);
        process.stdin.on("end", () => {
          try { process.stdout.write(JSON.parse(input)?.identities?.user?.openId || ""); }
          catch { process.stdout.write(""); }
        });
      '
  )"
fi

set_env LARK_CODEX_WORKDIR "$(cd "$WORKDIR" && pwd)"
if [[ -n "$OWNER_OPEN_ID" ]]; then
  if [[ ! "$OWNER_OPEN_ID" =~ ^ou_[A-Za-z0-9]+$ ]]; then
    echo "invalid owner open_id: $OWNER_OPEN_ID" >&2
    exit 2
  fi
  set_env LARK_CODEX_ALLOWED_SENDERS "$OWNER_OPEN_ID"
  set_env LARK_CODEX_OWNER_SENDERS "$OWNER_OPEN_ID"
  echo "configured owner open_id"
else
  echo "owner open_id was not detected; set LARK_CODEX_ALLOWED_SENDERS and LARK_CODEX_OWNER_SENDERS in .env" >&2
fi

if [[ "$INSTALL_SKILL" == "1" ]]; then
  "$ROOT_DIR/scripts/install-skill.sh"
fi

cd "$ROOT_DIR"
if [[ -n "$OWNER_OPEN_ID" ]]; then
  npm run check
else
  echo "skipping live check until owner identity is configured"
fi

if [[ "$INSTALL_LAUNCHD" == "1" ]]; then
  "$ROOT_DIR/scripts/install-launch-agent.sh"
else
  echo "setup complete; run 'npm run launchd:install' when ready"
fi
