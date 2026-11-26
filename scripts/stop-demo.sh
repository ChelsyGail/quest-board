#!/usr/bin/env bash
# Stop only processes started by scripts/start-demo.sh / Start QuestBoard.command.
# Leaves MySQL, unrelated uvicorn/Vite, and Docker containers running.
# Never wipes databases, deletes uploads, or kills unrelated processes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=demo-common.sh
source "$SCRIPT_DIR/demo-common.sh"

demo_mkdir
# Env optional on stop — still try so messages are useful.
demo_load_env 2>/dev/null || true

echo "=== QuestBoard classroom demo — stop ==="

# Drop a leftover start lock if a crashed Start left one behind and its pid is gone.
if [[ -d "$LOCK_FILE" ]]; then
  holder="$(cat "$LOCK_FILE/pid" 2>/dev/null || true)"
  if [[ -z "$holder" ]] || ! kill -0 "$holder" 2>/dev/null; then
    echo "Removing stale start lock."
    rm -rf "$LOCK_FILE"
  else
    echo "WARNING: a Start run still holds the lock (pid $holder). Not forcing it."
  fi
fi

if [[ ! -f "$PID_FILE" ]]; then
  echo "No PID file at $PID_FILE — nothing tracked to stop."
  echo "MySQL and any unrelated services were left alone."
  exit 0
fi

echo "Tracked PIDs before stop:"
sed 's/^/  /' "$PID_FILE" || true

# Identity-checked stops only (demo_kill_tracked refuses mismatched processes).
demo_kill_tracked tunnel
demo_kill_tracked api
demo_kill_tracked caffeinate

# Do not delete URL history files — useful to detect changes on next start.
# Do not stop Docker MySQL.
# Do not delete PROOF_MEDIA_DIR or database rows.
rm -f "$RUN_DIR/visitor-ready.txt" "$RUN_DIR/last-start-public-url.txt" 2>/dev/null || true

if [[ -f "$PID_FILE" && ! -s "$PID_FILE" ]]; then
  rm -f "$PID_FILE"
fi

echo
echo "Stopped demo-managed API/tunnel/caffeinate only."
echo "Preserved: MySQL data, ${MYSQL_DATABASE:-questboard_presentation}, proof uploads under apps/backend/var/."
echo "Unrelated listeners on other ports were not touched."
