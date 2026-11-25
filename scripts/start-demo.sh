#!/usr/bin/env bash
# Start the classroom demonstration backend: MySQL (local) + FastAPI + HTTPS tunnel.
# Does NOT start the React DEV server (Sites hosts the production frontend).
# Does NOT reset, reseed, or delete MySQL data or proof uploads.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=demo-common.sh
source "$SCRIPT_DIR/demo-common.sh"

demo_mkdir
demo_load_env

echo "=== QuestBoard classroom demo — start ==="
echo "Repo:     $ROOT"
echo "Database: $MYSQL_DATABASE @ ${MYSQL_HOST}:${MYSQL_PORT}"
echo "API bind: http://${DEMO_API_HOST}:${DEMO_API_PORT}/  (loopback only)"
echo "Media:    $PROOF_MEDIA_DIR"
echo

# --- Tool checks ---
missing=()
command -v curl >/dev/null 2>&1 || missing+=("curl")
command -v lsof >/dev/null 2>&1 || missing+=("lsof")
command -v mysql >/dev/null 2>&1 || missing+=("mysql client")
command -v mysqladmin >/dev/null 2>&1 || missing+=("mysqladmin")
if ! demo_poetry_python >/dev/null 2>&1; then
  missing+=("Poetry backend Python (run: cd apps/backend && poetry install)")
fi
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "ERROR: missing required tools:" >&2
  printf '  - %s\n' "${missing[@]}" >&2
  exit 1
fi
POETRY_PY="$(demo_poetry_python)"

if [[ "$(uname -s)" == "Darwin" ]] && ! command -v caffeinate >/dev/null 2>&1; then
  echo "WARNING: caffeinate not found; laptop may sleep during the demo." >&2
fi

# --- MySQL (do not expose publicly; start existing container only if needed) ---
if ! mysql_ping; then
  if command -v docker >/dev/null 2>&1 && docker ps -a --format '{{.Names}}' | grep -qx "$DEMO_MYSQL_CONTAINER"; then
    echo "Starting MySQL container '$DEMO_MYSQL_CONTAINER' (localhost only)…"
    docker start "$DEMO_MYSQL_CONTAINER" >/dev/null
    for _ in $(seq 1 30); do
      mysql_ping && break
      sleep 1
    done
  fi
fi
if ! mysql_ping; then
  echo "ERROR: MySQL is not reachable at ${MYSQL_HOST}:${MYSQL_PORT}." >&2
  echo "       Start your local Docker MySQL (or set DEMO_MYSQL_CONTAINER), then re-run." >&2
  echo "       This script never publishes MySQL beyond its existing localhost binding." >&2
  exit 1
fi

if ! mysql_query "SELECT 1" >/dev/null 2>&1; then
  echo "ERROR: cannot use database '$MYSQL_DATABASE'." >&2
  echo "       Create/select the presentation DB first. Refusing to create or wipe data." >&2
  exit 1
fi

demo_mysql_binding_check || exit 1
demo_require_schema || exit 1
echo "MySQL OK — $MYSQL_DATABASE. Data and uploads are preserved (no seed/wipe on start)."

# --- FastAPI ---
existing_api_pid="$(demo_read_pid api 2>/dev/null || true)"
if demo_pid_alive "$existing_api_pid"; then
  if wait_http_ok "$(api_health_url)" 3; then
    echo "API already running from a previous demo start (pid $existing_api_pid)."
  else
    echo "ERROR: tracked API pid $existing_api_pid is alive but /health failed." >&2
    echo "       Run: bash scripts/stop-demo.sh   then start again." >&2
    exit 1
  fi
else
  if port_listening "$DEMO_API_PORT"; then
    owner="$(port_owner_pid "$DEMO_API_PORT" || true)"
    if curl -fsS --max-time 2 "$(api_health_url)" >/dev/null 2>&1; then
      echo "ERROR: port ${DEMO_API_PORT} already serves /health but is not tracked by these scripts (pid ${owner:-unknown})." >&2
      echo "       Stop that process yourself, or set DEMO_API_PORT to a free port in scripts/demo.env." >&2
      echo "       Refusing to steal an unrelated listener." >&2
      exit 1
    fi
    echo "ERROR: port ${DEMO_API_PORT} is occupied (pid ${owner:-unknown}) and is not a healthy QuestBoard API." >&2
    echo "       Free the port or change DEMO_API_PORT. Not killing unrelated services." >&2
    exit 1
  fi

  if [[ "${QUESTBOARD_CLASSROOM_DEMO}" == "1" || "${QUESTBOARD_CLASSROOM_DEMO}" == "true" ]]; then
    if [[ -n "${CLASSROOM_DEMO_ADMIN_PASSWORD:-}" && -n "${CLASSROOM_DEMO_MOD_PASSWORD:-}" ]]; then
      echo "Ensuring classroom demo accounts on ${MYSQL_DATABASE}…"
      (
        cd "$ROOT/apps/backend/src"
        MYSQL_HOST="$MYSQL_HOST" MYSQL_PORT="$MYSQL_PORT" \
          MYSQL_DATABASE="$MYSQL_DATABASE" MYSQL_USER="$MYSQL_USER" \
          MYSQL_PASSWORD="$MYSQL_PASSWORD" \
          CLASSROOM_DEMO_ADMIN_PASSWORD="$CLASSROOM_DEMO_ADMIN_PASSWORD" \
          CLASSROOM_DEMO_MOD_PASSWORD="$CLASSROOM_DEMO_MOD_PASSWORD" \
          "$POETRY_PY" -m jobs.ensure_classroom_demo_accounts \
            --i-understand-this-targets-presentation-only
      ) || {
        echo "ERROR: failed to ensure classroom demo accounts." >&2
        exit 1
      }
    else
      echo "WARNING: QUESTBOARD_CLASSROOM_DEMO is on but CLASSROOM_DEMO_*_PASSWORD is unset."
      echo "         Set them in scripts/demo.env (see ACCOUNTS.local.md). Aliases will 401 until then."
    fi
  fi

  echo "Starting FastAPI on ${DEMO_API_HOST}:${DEMO_API_PORT}…"
  : >"$API_LOG"
  # Bind loopback only — phones reach the API solely through the HTTPS tunnel.
  api_pid="$(
    cd "$ROOT/apps/backend/src"
    demo_daemonize "$API_LOG" \
      env \
        MYSQL_HOST="$MYSQL_HOST" \
        MYSQL_PORT="$MYSQL_PORT" \
        MYSQL_DATABASE="$MYSQL_DATABASE" \
        MYSQL_USER="$MYSQL_USER" \
        MYSQL_PASSWORD="$MYSQL_PASSWORD" \
        JWT_SECRET_KEY="$JWT_SECRET_KEY" \
        PROOF_MEDIA_DIR="$PROOF_MEDIA_DIR" \
        QUESTBOARD_CLASSROOM_DEMO="${QUESTBOARD_CLASSROOM_DEMO:-0}" \
        "$POETRY_PY" -m uvicorn main:app \
          --host "$DEMO_API_HOST" \
          --port "$DEMO_API_PORT"
  )" || {
    echo "ERROR: failed to daemonize API. See $API_LOG" >&2
    exit 1
  }
  demo_write_pids api "$api_pid"
  if ! wait_http_ok "$(api_health_url)" 25; then
    echo "ERROR: API did not become healthy. See $API_LOG" >&2
    demo_kill_tracked api
    exit 1
  fi
  echo "API OK — pid $api_pid — $(api_health_url)"
fi

# --- Keep laptop awake (macOS) ---
if [[ "$(uname -s)" == "Darwin" ]] && command -v caffeinate >/dev/null 2>&1; then
  caff_pid="$(demo_read_pid caffeinate 2>/dev/null || true)"
  if ! demo_pid_alive "$caff_pid"; then
    # -i idle sleep, -m disk sleep, -s system sleep on AC; no display assertion.
    : >"$CAFFEINATE_LOG"
    caff_pid="$(demo_daemonize "$CAFFEINATE_LOG" caffeinate -ims)" || {
      echo "WARNING: could not start caffeinate." >&2
      caff_pid=""
    }
    if [[ -n "$caff_pid" ]]; then
      demo_write_pids caffeinate "$caff_pid"
      echo "caffeinate started (pid $caff_pid) — laptop should stay awake."
    fi
  else
    echo "caffeinate already tracked (pid $caff_pid)."
  fi
fi

# --- HTTPS tunnel (API only) ---
public_url=""
stable=0

start_named_cloudflared() {
  local bin="$1"
  if [[ ! -f "${DEMO_CLOUDFLARED_CONFIG:-}" ]]; then
    return 1
  fi
  if [[ -z "${DEMO_TUNNEL_HOSTNAME:-}" ]]; then
    echo "ERROR: DEMO_CLOUDFLARED_CONFIG is set but DEMO_TUNNEL_HOSTNAME is empty." >&2
    echo "       Set the stable hostname that the config routes to this API." >&2
    return 1
  fi
  local existing
  existing="$(demo_read_pid tunnel 2>/dev/null || true)"
  if demo_pid_alive "$existing"; then
    public_url="https://${DEMO_TUNNEL_HOSTNAME}"
    stable=1
    return 0
  fi
  echo "Starting named Cloudflare tunnel (stable hostname)…"
  : >"$TUNNEL_LOG"
  local tpid
  tpid="$(demo_daemonize "$TUNNEL_LOG" "$bin" tunnel --config "$DEMO_CLOUDFLARED_CONFIG" run)" || return 1
  demo_write_pids tunnel "$tpid"
  public_url="https://${DEMO_TUNNEL_HOSTNAME}"
  stable=1
  sleep 2
  return 0
}

start_quick_cloudflared() {
  local bin="$1"
  local existing
  existing="$(demo_read_pid tunnel 2>/dev/null || true)"
  if demo_pid_alive "$existing" && [[ -f "$URL_FILE" ]]; then
    public_url="$(tr -d '[:space:]' <"$URL_FILE")"
    echo "Tunnel already running (pid $existing) → $public_url"
    return 0
  fi
  echo "Starting Cloudflare quick tunnel (hostname changes every start)…"
  : >"$TUNNEL_LOG"
  local tpid
  tpid="$(demo_daemonize "$TUNNEL_LOG" "$bin" tunnel --url "http://${DEMO_API_HOST}:${DEMO_API_PORT}" --no-autoupdate)" || {
    echo "ERROR: failed to daemonize cloudflared. See $TUNNEL_LOG" >&2
    return 1
  }
  demo_write_pids tunnel "$tpid"
  local i url=""
  for ((i = 0; i < 40; i++)); do
    url="$(grep -Eo 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' "$TUNNEL_LOG" | tail -n1 || true)"
    if [[ -n "$url" ]]; then
      break
    fi
    if ! demo_pid_alive "$tpid"; then
      echo "ERROR: cloudflared exited early. See $TUNNEL_LOG" >&2
      return 1
    fi
    sleep 0.5
  done
  if [[ -z "$url" ]]; then
    echo "ERROR: could not read quick-tunnel URL from $TUNNEL_LOG" >&2
    echo "       Install/authenticate cloudflared, or configure a named tunnel." >&2
    demo_kill_tracked tunnel
    return 1
  fi
  public_url="$url"
  stable=0
}

start_ngrok() {
  if ! command -v ngrok >/dev/null 2>&1; then
    echo "ERROR: DEMO_TUNNEL_PROVIDER=ngrok but ngrok is not on PATH." >&2
    return 1
  fi
  local existing
  existing="$(demo_read_pid tunnel 2>/dev/null || true)"
  if demo_pid_alive "$existing" && [[ -f "$URL_FILE" ]]; then
    public_url="$(tr -d '[:space:]' <"$URL_FILE")"
    return 0
  fi
  local args=(http "${DEMO_API_HOST}:${DEMO_API_PORT}" --log=stdout)
  if [[ -n "${DEMO_NGROK_DOMAIN:-}" ]]; then
    args+=(--domain="$DEMO_NGROK_DOMAIN")
    stable=1
  fi
  echo "Starting ngrok tunnel…"
  : >"$TUNNEL_LOG"
  local tpid
  tpid="$(demo_daemonize "$TUNNEL_LOG" ngrok "${args[@]}")" || return 1
  demo_write_pids tunnel "$tpid"
  local i url=""
  local want_port="$DEMO_API_PORT"
  for ((i = 0; i < 40; i++)); do
    if curl -fsS --max-time 2 http://127.0.0.1:4040/api/tunnels >/tmp/qb-ngrok-tunnels.json 2>/dev/null; then
      url="$(DEMO_API_PORT="$want_port" python3 - <<'PY'
import json, os
port = os.environ["DEMO_API_PORT"]
tunnels = json.load(open("/tmp/qb-ngrok-tunnels.json")).get("tunnels") or []
def addr_of(t):
    cfg = t.get("config") or {}
    return str(cfg.get("addr") or "")
# Prefer the HTTPS tunnel whose local addr targets our demo API port.
for t in tunnels:
    pub = t.get("public_url") or ""
    if not pub.startswith("https://"):
        continue
    addr = addr_of(t)
    if addr.endswith(":" + port) or addr.endswith("://" + "127.0.0.1:" + port) or addr.endswith("://localhost:" + port) or addr == port:
        print(pub)
        break
else:
    # Fall back only if a single https tunnel exists.
    https = [t.get("public_url") for t in tunnels if (t.get("public_url") or "").startswith("https://")]
    print(https[0] if len(https) == 1 else "")
PY
)"
      if [[ -n "$url" ]]; then
        break
      fi
    fi
    sleep 0.5
  done
  if [[ -z "$url" ]]; then
    echo "ERROR: ngrok did not publish an HTTPS URL targeting port ${DEMO_API_PORT}." >&2
    echo "       Check $TUNNEL_LOG, NGROK_AUTHTOKEN, and that no other ngrok tunnels shadow this port." >&2
    demo_kill_tracked tunnel
    return 1
  fi
  public_url="$url"
  if [[ -n "${DEMO_NGROK_DOMAIN:-}" ]]; then
    stable=1
  else
    stable=0
  fi
}

case "$DEMO_TUNNEL_PROVIDER" in
  cloudflared)
    if ! TUNNEL_BIN="$(demo_tunnel_bin)"; then
      echo "ERROR: cloudflared not found." >&2
      echo "       Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/" >&2
      echo "       Or place a binary at .tools/cloudflared (gitignored)." >&2
      echo "       API is running locally but phones cannot reach it without a tunnel." >&2
      exit 1
    fi
    if [[ -n "${DEMO_CLOUDFLARED_CONFIG:-}" ]]; then
      start_named_cloudflared "$TUNNEL_BIN"
    else
      start_quick_cloudflared "$TUNNEL_BIN"
    fi
    ;;
  ngrok)
    start_ngrok
    ;;
  *)
    echo "ERROR: unknown DEMO_TUNNEL_PROVIDER='$DEMO_TUNNEL_PROVIDER' (use cloudflared or ngrok)." >&2
    exit 1
    ;;
esac

if ! demo_valid_public_api_origin "$public_url"; then
  echo "ERROR: public API origin is invalid: '$public_url'" >&2
  echo "       Expected https://host with no trailing path (no /health)." >&2
  demo_kill_tracked tunnel || true
  exit 1
fi

echo "Verifying public HTTPS /health before declaring startup successful…"
if ! wait_http_ok "${public_url}/health" 45; then
  echo "ERROR: ${public_url}/health did not succeed. Tunnel is up but API is not reachable publicly." >&2
  echo "       See $TUNNEL_LOG and $API_LOG. Refusing to mark startup successful." >&2
  exit 1
fi

# Persist URL + change detection only after public health succeeds
if [[ -f "$URL_FILE" ]]; then
  cp "$URL_FILE" "$PREV_URL_FILE"
fi
printf '%s\n' "$public_url" >"$URL_FILE"

prev=""
if [[ -f "$PREV_URL_FILE" ]]; then
  prev="$(tr -d '[:space:]' <"$PREV_URL_FILE")"
fi

echo
echo "=== Demo backend is up ==="
echo "Local API:   $(api_health_url)"
echo "Public API:  $public_url"
echo "Public /health: OK"
echo "MySQL:       ${MYSQL_HOST}:${MYSQL_PORT} / $MYSQL_DATABASE  (not tunneled)"
echo "Uploads:     $PROOF_MEDIA_DIR"
echo "PID file:    $PID_FILE"
echo "Logs:        $RUN_DIR/"
echo
echo "Sites frontend must call this public API origin (no path suffix):"
echo "  VITE_API_BASE_URL=$public_url"
echo

if [[ "$stable" -eq 1 ]]; then
  echo "Tunnel hostname is configured as STABLE ($public_url)."
else
  echo "WARNING: quick tunnel URL is NOT stable."
  if [[ -n "$prev" && "$prev" != "$public_url" ]]; then
    echo "WARNING: API URL CHANGED since last start."
    echo "  previous: $prev"
    echo "  current:  $public_url"
    echo "ACTION REQUIRED: rebuild and re-publish the Sites frontend with the new VITE_API_BASE_URL."
    echo "                 Old Sites builds will keep calling $prev."
    echo "QR CODE: leave the QR unchanged if it already points at the ChatGPT Sites frontend URL"
    echo "         and that Sites URL did not change — only the baked-in API origin needs rebuilding."
  elif [[ -z "$prev" ]]; then
    echo "ACTION: after first successful tunnel, build/publish Sites with VITE_API_BASE_URL=$public_url"
    echo "        then create a QR for the Sites frontend URL (not this tunnel URL)."
  else
    echo "Public API URL matches the previous start ($public_url)."
  fi
  echo "Tip: configure DEMO_CLOUDFLARED_CONFIG + DEMO_TUNNEL_HOSTNAME for a stable hostname."
fi

echo
echo "Did NOT start the React DEV server (Sites hosts the production UI)."
echo "Next: bash scripts/check-demo.sh"
echo "Stop: bash scripts/stop-demo.sh"
