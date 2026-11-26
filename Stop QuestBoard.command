#!/bin/bash
# Double-click to stop only QuestBoard classroom demo processes.
# Never wipes databases, deletes uploads, or kills unrelated services.
set -euo pipefail
cd "$(dirname "$0")"
echo "=== Stop QuestBoard ==="
bash scripts/stop-demo.sh
echo
echo "Press Return to close…"
read -r _
