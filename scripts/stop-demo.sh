#!/usr/bin/env bash
# Stop only processes started by scripts/start-demo.sh.
# Leaves MySQL, unrelated uvicorn/Vite, and Docker containers running.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=demo-common.sh
source "$SCRIPT_DIR/demo-common.sh"

demo_mkdir
# Env optional on stop — still try so messages are useful.
demo_load_env 2>/dev/null || true

echo "=== QuestBoard classroom demo — stop ==="

if [[ ! -f "$PID_FILE" ]]; then
  echo "No PID file at $PID_FILE — nothing tracked to stop."
  echo "MySQL and any unrelated services were left alone."
  exit 0
fi

echo "Tracked PIDs before stop:"
sed 's/^/  /' "$PID_FILE" || true

demo_kill_tracked tunnel
demo_kill_tracked api
demo_kill_tracked caffeinate

# Do not delete URL history files — useful to detect changes on next start.
# Do not stop Docker MySQL.
# Do not delete PROOF_MEDIA_DIR or database rows.

if [[ -f "$PID_FILE" && ! -s "$PID_FILE" ]]; then
  rm -f "$PID_FILE"
fi

echo
echo "Stopped demo-managed API/tunnel/caffeinate only."
echo "Preserved: MySQL data, $MYSQL_DATABASE, proof uploads under apps/backend/var/."
echo "Unrelated listeners on other ports were not touched."
