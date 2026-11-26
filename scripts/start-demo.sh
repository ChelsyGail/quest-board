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
demo_acquire_lock || exit 1

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
command -v dig >/dev/null 2>&1 || missing+=("dig")
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

# --- Stable tunnel availability (honest report; never call trycloudflare "stable") ---
if demo_is_stable_tunnel_configured; then
  echo "Stable tunnel config detected (named Cloudflare hostname or ngrok reserved domain)."
else
  echo "NOTE: No stable tunnel is configured on this Mac."
  echo "      DEMO_CLOUDFLARED_CONFIG / DEMO_TUNNEL_HOSTNAME are empty; ngrok reserved domain not set."
  echo "      Quick tunnels (*.trycloudflare.com) change every start and are NOT stable."
  echo "      One-time setup for a fixed API hostname (free Cloudflare named tunnel OR ngrok reserved"
  echo "      domain you already own) — see DEMO_START.md. Nothing was purchased from this script."
  echo
fi

# --- Docker + MySQL (existing volume only; never down -v / wipe) ---
demo_ensure_mysql_container || exit 1
if ! mysql_query "SELECT 1" >/dev/null 2>&1; then
  echo "ERROR: cannot use database '$MYSQL_DATABASE'." >&2
  echo "       Create/select the presentation DB first. Refusing to create or wipe data." >&2
  exit 1
fi
demo_mysql_binding_check || exit 1
demo_require_schema || exit 1
echo "MySQL OK — $MYSQL_DATABASE. Data and uploads are preserved (no seed/wipe on start)."

# --- Ensure classroom accounts (idempotent; presentation only) ---
ensure_classroom_accounts() {
  if [[ "${QUESTBOARD_CLASSROOM_DEMO}" != "1" && "${QUESTBOARD_CLASSROOM_DEMO}" != "true" ]]; then
    return 0
  fi
  if [[ -z "${CLASSROOM_DEMO_ADMIN_PASSWORD:-}" || -z "${CLASSROOM_DEMO_MOD_PASSWORD:-}" ]]; then
    echo "WARNING: QUESTBOARD_CLASSROOM_DEMO is on but CLASSROOM_DEMO_*_PASSWORD is unset."
    echo "         Set them in scripts/demo.env (see ACCOUNTS.local.md). Aliases will 401 until then."
    return 0
  fi
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
  )
}

# --- FastAPI: reuse if healthy; recover tracked failures only ---
start_api_process() {
  ensure_classroom_accounts || return 1
  echo "Starting FastAPI on ${DEMO_API_HOST}:${DEMO_API_PORT}…"
  : >"$API_LOG"
  local api_pid
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
    return 1
  }
  demo_write_pids api "$api_pid"
  if ! wait_http_ok "$(api_health_url)" 25; then
    echo "ERROR: API did not become healthy. See $API_LOG" >&2
    demo_kill_tracked api || true
    return 1
  fi
  echo "API OK — pid $api_pid — $(api_health_url)"
}

ensure_api() {
  local attempt
  for ((attempt = 0; attempt <= DEMO_RECOVER_ATTEMPTS; attempt++)); do
    local existing_api_pid
    existing_api_pid="$(demo_read_pid api 2>/dev/null || true)"
    if demo_pid_alive "$existing_api_pid" && demo_pid_matches_role api "$existing_api_pid"; then
      if demo_local_api_healthy; then
        echo "API already healthy (pid $existing_api_pid)."
        return 0
      fi
      echo "Tracked API pid $existing_api_pid is alive but /health failed — recovering API only…"
      demo_kill_tracked api || true
    elif [[ -n "$existing_api_pid" ]]; then
      echo "Clearing stale/mismatched API pid $existing_api_pid."
      demo_clear_pid api
    fi

    if port_listening "$DEMO_API_PORT"; then
      local owner
      owner="$(port_owner_pid "$DEMO_API_PORT" || true)"
      if demo_local_api_healthy; then
        if [[ -n "$owner" ]] && demo_pid_matches_role api "$owner"; then
          demo_write_pids api "$owner"
          echo "Adopted healthy API already listening on ${DEMO_API_PORT} (pid $owner)."
          return 0
        fi
        echo "ERROR: port ${DEMO_API_PORT} serves /health but is not a tracked QuestBoard API (pid ${owner:-unknown})." >&2
        echo "       Stop that process yourself, or change DEMO_API_PORT. Refusing to steal it." >&2
        return 1
      fi
      echo "ERROR: port ${DEMO_API_PORT} is occupied (pid ${owner:-unknown}) and is not healthy." >&2
      echo "       Free the port or change DEMO_API_PORT. Not killing unrelated services." >&2
      return 1
    fi

    if start_api_process; then
      return 0
    fi
    echo "API start attempt $((attempt + 1)) failed."
    sleep 1
  done
  echo "ERROR: could not start a healthy API after $((DEMO_RECOVER_ATTEMPTS + 1)) attempts." >&2
  return 1
}

ensure_api || exit 1

# --- Keep laptop awake (macOS) ---
if [[ "$(uname -s)" == "Darwin" ]] && command -v caffeinate >/dev/null 2>&1; then
  caff_pid="$(demo_read_pid caffeinate 2>/dev/null || true)"
  if ! demo_pid_alive "$caff_pid" || ! demo_pid_matches_role caffeinate "$caff_pid"; then
    [[ -n "$caff_pid" ]] && demo_clear_pid caffeinate
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
    return 1
  fi
  echo "Starting named Cloudflare tunnel → https://${DEMO_TUNNEL_HOSTNAME}"
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
  echo "Starting Cloudflare quick tunnel (hostname changes every start — NOT stable)…"
  : >"$TUNNEL_LOG"
  local tpid
  tpid="$(demo_daemonize "$TUNNEL_LOG" "$bin" tunnel --url "http://${DEMO_API_HOST}:${DEMO_API_PORT}" --no-autoupdate)" || {
    echo "ERROR: failed to daemonize cloudflared. See $TUNNEL_LOG" >&2
    return 1
  }
  demo_write_pids tunnel "$tpid"
  local i url=""
  for ((i = 0; i < 40; i++)); do
    if demo_tunnel_log_looks_dead; then
      echo "ERROR: cloudflared log reports a dead/unauthorized tunnel. See $TUNNEL_LOG" >&2
      demo_kill_tracked tunnel || true
      return 1
    fi
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
    demo_kill_tracked tunnel || true
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
  local i url="" want_port="$DEMO_API_PORT"
  for ((i = 0; i < 40; i++)); do
    if curl -fsS --max-time 2 http://127.0.0.1:4040/api/tunnels >/tmp/qb-ngrok-tunnels.json 2>/dev/null; then
      url="$(DEMO_API_PORT="$want_port" python3 - <<'PY'
import json, os
port = os.environ["DEMO_API_PORT"]
tunnels = json.load(open("/tmp/qb-ngrok-tunnels.json")).get("tunnels") or []
def addr_of(t):
    cfg = t.get("config") or {}
    return str(cfg.get("addr") or "")
for t in tunnels:
    pub = t.get("public_url") or ""
    if not pub.startswith("https://"):
        continue
    addr = addr_of(t)
    if addr.endswith(":" + port) or addr.endswith("://127.0.0.1:" + port) or addr.endswith("://localhost:" + port) or addr == port:
        print(pub)
        break
else:
    https = [t.get("public_url") for t in tunnels if (t.get("public_url") or "").startswith("https://")]
    print(https[0] if len(https) == 1 else "")
PY
)"
      [[ -n "$url" ]] && break
    fi
    sleep 0.5
  done
  if [[ -z "$url" ]]; then
    echo "ERROR: ngrok did not publish an HTTPS URL targeting port ${DEMO_API_PORT}." >&2
    demo_kill_tracked tunnel || true
    return 1
  fi
  public_url="$url"
  [[ -n "${DEMO_NGROK_DOMAIN:-}" ]] && stable=1 || stable=0
}

launch_tunnel() {
  case "$DEMO_TUNNEL_PROVIDER" in
    cloudflared)
      if ! TUNNEL_BIN="$(demo_tunnel_bin)"; then
        echo "ERROR: cloudflared not found (.tools/cloudflared or PATH)." >&2
        return 1
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
      echo "ERROR: unknown DEMO_TUNNEL_PROVIDER='$DEMO_TUNNEL_PROVIDER'." >&2
      return 1
      ;;
  esac
}

ensure_tunnel() {
  local attempt rc
  for ((attempt = 0; attempt <= DEMO_RECOVER_ATTEMPTS; attempt++)); do
    local existing
    existing="$(demo_read_pid tunnel 2>/dev/null || true)"
    if demo_pid_alive "$existing" && demo_pid_matches_role tunnel "$existing"; then
      if [[ -n "${DEMO_TUNNEL_HOSTNAME:-}" && -n "${DEMO_CLOUDFLARED_CONFIG:-}" ]]; then
        public_url="https://${DEMO_TUNNEL_HOSTNAME}"
        stable=1
      elif [[ -f "$URL_FILE" ]]; then
        public_url="$(tr -d '[:space:]' <"$URL_FILE")"
        stable=0
      else
        public_url=""
      fi
      if [[ -n "$public_url" ]] && demo_valid_public_api_origin "$public_url"; then
        rc=0
        demo_public_health_probe "$public_url" || rc=$?
        if [[ "$rc" -eq 0 ]]; then
          echo "Tunnel already healthy (pid $existing) → $public_url"
          return 0
        fi
        if [[ "$rc" -eq 2 ]]; then
          echo "Detected Unauthorized / Tunnel not found on $public_url — restarting tunnel only…"
        else
          echo "Public /health failed for reused tunnel $public_url — restarting tunnel only…"
        fi
        demo_kill_tracked tunnel || true
      else
        echo "Tracked tunnel pid $existing has no usable public URL — restarting tunnel only…"
        demo_kill_tracked tunnel || true
      fi
    elif [[ -n "$existing" ]]; then
      echo "Clearing stale/mismatched tunnel pid $existing."
      demo_clear_pid tunnel
    fi

    if ! launch_tunnel; then
      echo "Tunnel start attempt $((attempt + 1)) failed."
      sleep 1
      continue
    fi
    if ! demo_valid_public_api_origin "$public_url"; then
      echo "ERROR: invalid public API origin: '$public_url'" >&2
      demo_kill_tracked tunnel || true
      continue
    fi
    echo "Verifying public HTTPS /health for $public_url …"
    rc=0
    local i
    for ((i = 0; i < 45; i++)); do
      rc=0
      demo_public_health_probe "$public_url" || rc=$?
      if [[ "$rc" -eq 0 ]]; then
        echo "Public /health: OK"
        return 0
      fi
      if [[ "$rc" -eq 2 ]]; then
        echo "ERROR: public endpoint reports Unauthorized / Tunnel not found." >&2
        demo_kill_tracked tunnel || true
        break
      fi
      if demo_tunnel_log_looks_dead; then
        echo "ERROR: tunnel log indicates failure. See $TUNNEL_LOG" >&2
        demo_kill_tracked tunnel || true
        break
      fi
      sleep 1
    done
    echo "Tunnel health attempt $((attempt + 1)) failed."
    demo_kill_tracked tunnel || true
    sleep 1
  done
  echo "ERROR: could not establish a healthy public API tunnel." >&2
  echo "       Local API may still be up at $(api_health_url)." >&2
  return 1
}

ensure_tunnel || exit 1

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

visitor_ready=0
if [[ "$stable" -eq 1 ]]; then
  echo "Tunnel hostname is configured as STABLE ($public_url)."
  visitor_ready=1
else
  echo "WARNING: quick tunnel URL is NOT stable (*.trycloudflare.com changes)."
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
  else
    echo "Public API URL matches the previous start ($public_url)."
  fi
  echo "Tip: configure a Cloudflare named tunnel or ngrok reserved domain for a fixed hostname."
fi

# Compare published Sites bundle to current tunnel (best-effort)
if [[ -n "${SITES_ORIGIN:-}" ]]; then
  baked="$(demo_sites_baked_api_origin || true)"
  if [[ -n "$baked" ]]; then
    echo "Published Sites ($SITES_ORIGIN) appears to call: $baked"
    if [[ "$baked" == "$public_url" ]]; then
      visitor_ready=1
      echo "Sites baked API origin matches this start — visitors can use the Sites URL."
    else
      visitor_ready=0
      echo "WARNING: Sites still points at a different API host."
      echo "         Do NOT tell students the public site works until you rebuild+re-upload dist."
    fi
  else
    echo "Could not read baked API origin from Sites (offline or HTML changed) — assuming mismatch until verified."
    if [[ "$stable" -ne 1 ]]; then
      visitor_ready=0
    fi
  fi
fi

echo
echo "Did NOT start the React DEV server (Sites hosts the production UI)."
echo "Check: bash scripts/check-demo.sh"
echo "Stop:  bash scripts/stop-demo.sh   or double-click Stop QuestBoard.command"

# Export for the .command wrapper
printf '%s\n' "$public_url" >"$RUN_DIR/last-start-public-url.txt"
printf '%s\n' "$visitor_ready" >"$RUN_DIR/visitor-ready.txt"
if [[ -n "${SITES_ORIGIN:-}" ]]; then
  printf '%s\n' "$SITES_ORIGIN" >"$RUN_DIR/sites-origin.txt"
fi

if [[ "$visitor_ready" -eq 1 ]]; then
  echo
  echo "SUCCESS: laptop stack + visitor path look ready."
  exit 0
fi
echo
echo "SUCCESS (laptop): local API + tunnel health OK."
echo "VISITORS: not ready until Sites is rebuilt for $public_url (or a stable tunnel is configured)."
exit 0
