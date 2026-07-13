#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
LABEL="$(launchd_label)"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$PLIST_DIR/$LABEL.plist"
NODE_BIN="$(command -v node)"
UID_VALUE="$(id -u)"

mkdir -p "$PLIST_DIR" "$ROOT_DIR/.lark-codex"

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$ROOT_DIR/src/bridge.mjs</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$ROOT_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>$HOME</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$ROOT_DIR/.lark-codex/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>$ROOT_DIR/.lark-codex/launchd.err.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$UID_VALUE/$LABEL" 2>/dev/null || true
sleep 1
if ! BOOTSTRAP_OUTPUT="$(launchctl bootstrap "gui/$UID_VALUE" "$PLIST_PATH" 2>&1)"; then
  echo "bootstrap did not settle yet; retrying..." >&2
  sleep 2
  if ! launchctl bootstrap "gui/$UID_VALUE" "$PLIST_PATH"; then
    echo "$BOOTSTRAP_OUTPUT" >&2
    exit 1
  fi
fi
launchctl kickstart "gui/$UID_VALUE/$LABEL"

echo "installed $LABEL"
echo "plist: $PLIST_PATH"
echo "status: launchctl print gui/$UID_VALUE/$LABEL"
echo "logs: $ROOT_DIR/.lark-codex/launchd.out.log $ROOT_DIR/.lark-codex/launchd.err.log"
