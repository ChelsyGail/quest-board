#!/usr/bin/env bash
# Health-check the classroom demo stack started by scripts/start-demo.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=demo-common.sh
source "$SCRIPT_DIR/demo-common.sh"

demo_mkdir
demo_load_env

fail=0
pass() { echo "OK   $1"; }
warn() { echo "WARN $1"; }
bad()  { echo "FAIL $1"; fail=1; }

echo "=== QuestBoard classroom demo — check ==="

# Tools
command -v curl >/dev/null 2>&1 && pass "curl available" || bad "curl missing"
if mysql_ping; then
  pass "MySQL reachable at ${MYSQL_HOST}:${MYSQL_PORT}"
else
  bad "MySQL not reachable at ${MYSQL_HOST}:${MYSQL_PORT}"
fi

if mysql_query "SELECT DATABASE()" >/dev/null 2>&1; then
  users="$(mysql_query "SELECT COUNT(*) FROM users" 2>/dev/null || echo '?')"
  items="$(mysql_query "SELECT COUNT(*) FROM catalogue_items" 2>/dev/null || echo '?')"
  pass "Database $MYSQL_DATABASE usable (users=$users, items=$items)"
else
  bad "Cannot query $MYSQL_DATABASE"
fi

# Real MySQL binding check (Docker publish + host listeners) — not a tunnel body scrape
if demo_mysql_binding_check; then
  pass "MySQL binding check (loopback / explicit override)"
else
  bad "MySQL binding check failed — rebind to 127.0.0.1 or set DEMO_ALLOW_NON_LOOPBACK_MYSQL=1 knowingly"
fi

if demo_require_schema; then
  pass "Required migrations and core tables present"
else
  bad "Schema incomplete — apply missing migrations manually (no auto wipe/create)"
fi

# API local
api_pid="$(demo_read_pid api 2>/dev/null || true)"
if demo_pid_alive "$api_pid"; then
  pass "Tracked API process alive (pid $api_pid)"
elif [[ -n "$api_pid" ]]; then
  bad "Tracked API pid $api_pid is stale — run scripts/stop-demo.sh then start-demo.sh"
else
  warn "No tracked API pid (API may have been started outside these scripts)"
fi

if curl -fsS --max-time 5 "$(api_health_url)" >/dev/null 2>&1; then
  pass "Local API health $(api_health_url)"
else
  bad "Local API health failed at $(api_health_url)"
fi

# Tunnel
tunnel_pid="$(demo_read_pid tunnel 2>/dev/null || true)"
if demo_pid_alive "$tunnel_pid"; then
  pass "Tracked tunnel process alive (pid $tunnel_pid)"
else
  bad "No tracked tunnel process — phones cannot reach the API"
fi

if [[ ! -f "$URL_FILE" ]]; then
  bad "Missing $URL_FILE — run scripts/start-demo.sh"
else
  public_url="$(tr -d '[:space:]' <"$URL_FILE")"
  echo "     Public API: $public_url"
  if demo_valid_public_api_origin "$public_url"; then
    pass "Public API origin shape (https://host, no path)"
  else
    bad "Public API origin invalid: $public_url"
  fi
  if curl -fsS --max-time 15 "${public_url}/health" >/dev/null 2>&1; then
    pass "Public HTTPS /health via tunnel"
  else
    bad "Public HTTPS /health failed for ${public_url}/health"
    echo "     Check $TUNNEL_LOG and laptop firewall/network."
  fi
  # Login probe without printing tokens
  login_code="$(curl -sS -o /tmp/qb-demo-login.json -w '%{http_code}' --max-time 15 \
    -H 'Content-Type: application/json' \
    -d '{"email":"__demo_missing__@example.com","password":"x"}' \
    "${public_url}/auth/login" || true)"
  if [[ "$login_code" == "401" || "$login_code" == "422" ]]; then
    pass "Public /auth/login reachable (HTTP $login_code as expected for bad credentials)"
  else
    bad "Public /auth/login unexpected HTTP $login_code"
  fi
fi

# caffeinate
if [[ "$(uname -s)" == "Darwin" ]]; then
  caff_pid="$(demo_read_pid caffeinate 2>/dev/null || true)"
  if demo_pid_alive "$caff_pid"; then
    pass "caffeinate running (pid $caff_pid)"
  else
    warn "caffeinate not tracked — laptop may sleep mid-demo"
  fi
fi

# Frontend reminder
if [[ "${VITE_DISCUSSIONS_API}" == "true" ]]; then
  warn "VITE_DISCUSSIONS_API=true — enable in Sites build only after Grove ACL verification"
else
  pass "Discussions stay disabled for Sites (VITE_DISCUSSIONS_API=false)"
fi

echo
if [[ "$fail" -ne 0 ]]; then
  echo "RESULT: FAILED — fix the items above before class."
  exit 1
fi
echo "RESULT: OK — local API + HTTPS tunnel look healthy."
echo "Phone test: open the Sites URL on mobile data, log in, join a quest, upload proof."
echo "Moderator: use the moderator account from docs/presentation/ACCOUNTS.local.md (gitignored)."
exit 0
