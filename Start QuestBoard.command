#!/bin/bash
# Double-click to start the QuestBoard classroom laptop stack.
# Opens the public Sites website only when checks say visitors are ready.
set -euo pipefail
cd "$(dirname "$0")"

echo "=== Start QuestBoard ==="
echo "Working directory: $(pwd)"
echo

if bash scripts/start-demo.sh; then
  echo
  if bash scripts/check-demo.sh; then
    visitor_ready="$(tr -d '[:space:]' < var/demo-run/visitor-ready.txt 2>/dev/null || echo 0)"
    sites="$(tr -d '[:space:]' < var/demo-run/sites-origin.txt 2>/dev/null || true)"
    public="$(tr -d '[:space:]' < var/demo-run/api-public-url.txt 2>/dev/null || true)"
    echo
    if [[ "$visitor_ready" == "1" && -n "$sites" ]]; then
      echo "Opening Sites for visitors: $sites"
      open "$sites" >/dev/null 2>&1 || true
    else
      echo "NOT opening Sites in the browser."
      echo "Laptop API is up${public:+ at $public}, but the published frontend is not confirmed"
      echo "to match this API origin. Rebuild/re-upload Sites before students use the QR link."
      if [[ -n "$sites" ]]; then
        echo "Configured SITES_ORIGIN=$sites"
      fi
    fi
  else
    echo
    echo "Start reported success but check-demo failed — see messages above."
  fi
else
  echo
  echo "START FAILED — see messages above. MySQL data and uploads were not wiped."
fi

echo
echo "Press Return to close…"
read -r _
