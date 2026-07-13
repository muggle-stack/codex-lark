#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
LABEL="$(launchd_label)"
UID_VALUE="$(id -u)"

echo "LaunchAgent: $LABEL"
if launchctl print "gui/$UID_VALUE/$LABEL" >/dev/null 2>&1; then
  launchctl print "gui/$UID_VALUE/$LABEL" | sed -n '1,45p'
else
  echo "state: not installed"
fi

echo
echo "Configuration:"
cd "$ROOT_DIR"
npm run check
