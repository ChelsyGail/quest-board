#!/usr/bin/env bash
# Shared helpers for classroom demo start/check/stop. Sourced only — do not execute.
# shellcheck shell=bash

demo_root() {
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  printf '%s' "$here"
}

ROOT="$(demo_root)"
RUN_DIR="${DEMO_RUN_DIR:-$ROOT/var/demo-run}"
PID_FILE="$RUN_DIR/demo.pids"
URL_FILE="$RUN_DIR/api-public-url.txt"
PREV_URL_FILE="$RUN_DIR/api-public-url.prev.txt"
LOCK_FILE="$RUN_DIR/start.lock"
API_LOG="$RUN_DIR/api.log"
TUNNEL_LOG="$RUN_DIR/tunnel.log"
CAFFEINATE_LOG="$RUN_DIR/caffeinate.log"
ENV_FILE="${DEMO_ENV_FILE:-$ROOT/scripts/demo.env}"
DEVCONTAINER_ENV="${DEVCONTAINER_ENV:-$ROOT/.devcontainer/.env}"
SCHEMA_DIR="$ROOT/apps/backend/src/database/schema"
COMPOSE_FILE="$ROOT/.devcontainer/docker-compose.yml"

demo_mkdir() {
  mkdir -p "$RUN_DIR" "$ROOT/apps/backend/var"
}

demo_load_env() {
  if [[ -f "$DEVCONTAINER_ENV" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$DEVCONTAINER_ENV"
    set +a
  fi
  if [[ -f "$ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
  fi

  export MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
  export MYSQL_PORT="${MYSQL_PORT:-3306}"
  export MYSQL_DATABASE="${MYSQL_DATABASE:-questboard_presentation}"
  export DEMO_MYSQL_CONTAINER="${DEMO_MYSQL_CONTAINER:-test-app-mysql-container}"
  export DEMO_API_HOST="${DEMO_API_HOST:-127.0.0.1}"
  export DEMO_API_PORT="${DEMO_API_PORT:-8010}"
  export DEMO_TUNNEL_PROVIDER="${DEMO_TUNNEL_PROVIDER:-cloudflared}"
  export VITE_DISCUSSIONS_API="${VITE_DISCUSSIONS_API:-false}"
  export VITE_DISCUSSIONS_DEMO="${VITE_DISCUSSIONS_DEMO:-false}"
  # Classroom demo aliases (admin/mod). Backend + Sites FE must agree.
  export QUESTBOARD_CLASSROOM_DEMO="${QUESTBOARD_CLASSROOM_DEMO:-1}"
  export VITE_CLASSROOM_DEMO="${VITE_CLASSROOM_DEMO:-true}"
  export SITES_ORIGIN="${SITES_ORIGIN:-}"
  export DEMO_DOCKER_WAIT_SECONDS="${DEMO_DOCKER_WAIT_SECONDS:-90}"
  export DEMO_RECOVER_ATTEMPTS="${DEMO_RECOVER_ATTEMPTS:-2}"

  if [[ -z "${PROOF_MEDIA_DIR:-}" ]]; then
    export PROOF_MEDIA_DIR="$ROOT/apps/backend/var/proof-media-presentation"
  fi
  mkdir -p "$PROOF_MEDIA_DIR"

  export JWT_SECRET_KEY="${JWT_SECRET_KEY:-${JWT_SECRET:-}}"
  if [[ -z "${JWT_SECRET_KEY:-}" ]]; then
    echo "ERROR: JWT_SECRET_KEY (or JWT_SECRET) is not set. Add it to .devcontainer/.env or scripts/demo.env." >&2
    return 1
  fi
  if [[ -z "${MYSQL_USER:-}" || -z "${MYSQL_PASSWORD:-}" ]]; then
    echo "ERROR: MYSQL_USER / MYSQL_PASSWORD missing. Copy from .devcontainer/.env into scripts/demo.env if needed." >&2
    return 1
  fi
}

_demo_python_has_uvicorn() {
  local py="$1"
  [[ -x "$py" ]] || return 1
  "$py" -c 'import uvicorn' >/dev/null 2>&1
}

# Prefer the Poetry env for THIS checkout (apps/backend). Verify uvicorn imports before accepting a path
# so a broken/sandbox Poetry path cannot silently win over a working project env.
demo_poetry_python() {
  if [[ -n "${DEMO_POETRY_PYTHON:-}" ]] && _demo_python_has_uvicorn "${DEMO_POETRY_PYTHON}"; then
    printf '%s' "$DEMO_POETRY_PYTHON"
    return 0
  fi
  if command -v poetry >/dev/null 2>&1; then
    local env_path
    env_path="$(cd "$ROOT/apps/backend" && poetry env info -p 2>/dev/null || true)"
    if [[ -n "$env_path" ]] && _demo_python_has_uvicorn "$env_path/bin/python"; then
      printf '%s' "$env_path/bin/python"
      return 0
    fi
  fi
  local candidate
  shopt -s nullglob
  for candidate in \
    "$HOME/Library/Caches/pypoetry/virtualenvs"/backend-api-*/bin/python \
    "$HOME/.cache/pypoetry/virtualenvs"/backend-api-*/bin/python; do
    if _demo_python_has_uvicorn "$candidate"; then
      shopt -u nullglob
      printf '%s' "$candidate"
      return 0
    fi
  done
  shopt -u nullglob
  return 1
}

demo_tunnel_bin() {
  if [[ -n "${DEMO_TUNNEL_BIN:-}" && -x "${DEMO_TUNNEL_BIN}" ]]; then
    printf '%s' "$DEMO_TUNNEL_BIN"
    return 0
  fi
  if [[ -x "$ROOT/.tools/cloudflared" ]]; then
    printf '%s' "$ROOT/.tools/cloudflared"
    return 0
  fi
  if command -v cloudflared >/dev/null 2>&1; then
    command -v cloudflared
    return 0
  fi
  return 1
}

demo_pid_alive() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

demo_process_args() {
  local pid="$1"
  ps -p "$pid" -o args= 2>/dev/null || true
}

# Returns 0 if the PID looks like the expected demo role.
demo_pid_matches_role() {
  local key="$1" pid="$2"
  local args
  args="$(demo_process_args "$pid")"
  [[ -n "$args" ]] || return 1
  case "$key" in
    api)
      [[ "$args" == *uvicorn* ]] && [[ "$args" == *main:app* || "$args" == *"main:app"* ]] && return 0
      [[ "$args" == *uvicorn* ]] && [[ "$args" == *"--port ${DEMO_API_PORT}"* || "$args" == *"--port=${DEMO_API_PORT}"* ]] && return 0
      return 1
      ;;
    tunnel)
      [[ "$args" == *cloudflared* || "$args" == *ngrok* ]] && return 0
      return 1
      ;;
    caffeinate)
      [[ "$args" == *caffeinate* ]] && return 0
      return 1
      ;;
    *)
      return 1
      ;;
  esac
}

demo_write_pids() {
  local key="$1" pid="$2"
  demo_mkdir
  touch "$PID_FILE"
  if grep -q "^${key}=" "$PID_FILE" 2>/dev/null; then
    local tmp
    tmp="$(mktemp)"
    awk -F= -v k="$key" -v p="$pid" 'BEGIN{OFS="="} $1==k{$2=p} {print}' "$PID_FILE" >"$tmp"
    mv "$tmp" "$PID_FILE"
  else
    printf '%s=%s\n' "$key" "$pid" >>"$PID_FILE"
  fi
}

demo_read_pid() {
  local key="$1"
  [[ -f "$PID_FILE" ]] || return 1
  awk -F= -v k="$key" '$1==k{print $2; found=1} END{exit !found}' "$PID_FILE"
}

demo_clear_pid() {
  local key="$1"
  [[ -f "$PID_FILE" ]] || return 0
  local tmp
  tmp="$(mktemp)"
  awk -F= -v k="$key" '$1!=k{print}' "$PID_FILE" >"$tmp"
  mv "$tmp" "$PID_FILE"
}

demo_kill_tracked() {
  local key="$1"
  local pid
  pid="$(demo_read_pid "$key" 2>/dev/null || true)"
  if [[ -z "$pid" ]]; then
    echo "No tracked PID for $key."
    return 0
  fi
  if ! demo_pid_alive "$pid"; then
    echo "Tracked $key pid $pid is already gone — clearing."
    demo_clear_pid "$key"
    return 0
  fi
  if ! demo_pid_matches_role "$key" "$pid"; then
    echo "REFUSING to stop pid $pid for $key — process identity does not match this demo role:" >&2
    echo "  $(demo_process_args "$pid")" >&2
    echo "  Clear $PID_FILE manually if the entry is stale. Unrelated services were not killed." >&2
    return 1
  fi
  kill "$pid" 2>/dev/null || true
  sleep 0.5
  if demo_pid_alive "$pid"; then
    kill -9 "$pid" 2>/dev/null || true
  fi
  echo "Stopped $key (pid $pid)."
  demo_clear_pid "$key"
}

port_listening() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

port_owner_pid() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -n1
}

mysql_ping() {
  MYSQL_PWD="${MYSQL_PASSWORD}" mysqladmin ping \
    -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" --silent >/dev/null 2>&1
}

mysql_query() {
  MYSQL_PWD="${MYSQL_PASSWORD}" mysql \
    -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" \
    "$MYSQL_DATABASE" -N -e "$1"
}

# Fail if required migration files or core tables are missing. Never creates/drops DB.
demo_require_schema() {
  local missing=()
  local file base
  if [[ ! -d "$SCHEMA_DIR" ]]; then
    echo "ERROR: schema directory missing: $SCHEMA_DIR" >&2
    return 1
  fi
  shopt -s nullglob
  local files=("$SCHEMA_DIR"/*.sql)
  shopt -u nullglob
  if [[ ${#files[@]} -eq 0 ]]; then
    echo "ERROR: no migration SQL files under $SCHEMA_DIR" >&2
    return 1
  fi
  for file in "${files[@]}"; do
    base="$(basename "$file")"
    if [[ "$(mysql_query "SELECT COUNT(*) FROM schema_migrations WHERE filename='${base}'" 2>/dev/null || echo 0)" -lt 1 ]]; then
      missing+=("$base")
    fi
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "ERROR: database '$MYSQL_DATABASE' is missing required migrations (apply manually; refusing to create/wipe):" >&2
    printf '  - %s\n' "${missing[@]}" >&2
    return 1
  fi
  local table
  for table in users catalogue_items participations submissions discussion_threads discussion_replies schema_migrations; do
    if ! mysql_query "SELECT 1 FROM \`${table}\` LIMIT 1" >/dev/null 2>&1; then
      # empty table is fine; missing table is not
      if ! mysql_query "SHOW TABLES LIKE '${table}'" | grep -qx "$table"; then
        echo "ERROR: required table '${table}' is missing from '$MYSQL_DATABASE'." >&2
        return 1
      fi
    fi
  done
  echo "Schema OK — ${#files[@]} migrations recorded; core tables present (no create/wipe performed)."
}

# Inspect Docker publish bindings for MySQL. Warn/fail if published beyond loopback.
demo_mysql_binding_check() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "WARN: docker not available — cannot verify MySQL port binding; ensure MySQL listens on localhost only."
    return 0
  fi
  if ! docker ps --format '{{.Names}}' | grep -qx "$DEMO_MYSQL_CONTAINER"; then
    echo "WARN: container '$DEMO_MYSQL_CONTAINER' not running — MySQL may be non-Docker; confirm it is not public."
    return 0
  fi
  local ports
  ports="$(docker port "$DEMO_MYSQL_CONTAINER" 2>/dev/null || true)"
  if [[ -z "$ports" ]]; then
    echo "OK: container '$DEMO_MYSQL_CONTAINER' has no published ports (or none reported)."
    return 0
  fi
  echo "Docker MySQL publish map:"
  echo "$ports" | sed 's/^/  /'
  # Also inspect host listeners for the configured MySQL port.
  local listeners
  listeners="$(lsof -nP -iTCP:"$MYSQL_PORT" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$listeners" ]]; then
    echo "Host listeners on TCP $MYSQL_PORT:"
    echo "$listeners" | sed 's/^/  /'
  fi

  local non_loopback=0
  if echo "$ports" | grep -E '0\.0\.0\.0:|\[::\]:' >/dev/null; then
    non_loopback=1
  fi
  if echo "$listeners" | grep -E '\*:([0-9]+)|0\.0\.0\.0:|\[::\]:' >/dev/null; then
    non_loopback=1
  fi

  if [[ "$non_loopback" -eq 1 ]]; then
    if [[ "${DEMO_ALLOW_NON_LOOPBACK_MYSQL:-}" == "1" ]]; then
      echo "WARN: MySQL is published beyond loopback, but DEMO_ALLOW_NON_LOOPBACK_MYSQL=1 — continuing."
      echo "      Prefer rebinding Docker to 127.0.0.1:${MYSQL_PORT} for class."
      return 0
    fi
    echo "ERROR: MySQL appears published on all interfaces (0.0.0.0 / :: / *)." >&2
    echo "       Rebind the container to 127.0.0.1:${MYSQL_PORT} before classroom use." >&2
    echo "       This script never tunnels MySQL; a public Docker publish is still unsafe on a shared network." >&2
    echo "       Emergency override only: DEMO_ALLOW_NON_LOOPBACK_MYSQL=1 in scripts/demo.env (gitignored)." >&2
    return 1
  fi
  if echo "$ports" | grep -E '127\.0\.0\.1:[0-9]+' >/dev/null; then
    echo "OK: MySQL Docker publish is loopback-only."
    return 0
  fi
  echo "WARN: could not classify MySQL bindings as loopback-only — review the map above."
  return 0
}

api_health_url() {
  printf 'http://%s:%s/health' "$DEMO_API_HOST" "$DEMO_API_PORT"
}

# Some ISP/router resolvers fail on *.trycloudflare.com while 1.1.1.1 works.
# Prefer normal curl; on failure retry with dig @1.1.1.1 + curl --resolve.
demo_curl_ok() {
  local url="$1"
  local host rest ip port
  if curl -fsS --max-time 3 "$url" >/dev/null 2>&1; then
    return 0
  fi
  [[ "$url" == https://* || "$url" == http://* ]] || return 1
  rest="${url#http://}"
  rest="${rest#https://}"
  host="${rest%%/*}"
  host="${host%%:*}"
  [[ -n "$host" ]] || return 1
  ip="$(dig +short "$host" @1.1.1.1 A 2>/dev/null | awk 'NR==1 && $1 ~ /^[0-9.]+$/ {print; exit}')"
  [[ -n "$ip" ]] || return 1
  if [[ "$url" == https://* ]]; then
    port=443
  else
    port=80
  fi
  curl -fsS --max-time 5 --resolve "${host}:${port}:${ip}" "$url" >/dev/null 2>&1
}

wait_http_ok() {
  local url="$1" seconds="${2:-20}"
  local i
  for ((i = 0; i < seconds; i++)); do
    if demo_curl_ok "$url"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

demo_valid_public_api_origin() {
  local url="$1"
  [[ "$url" == https://* ]] || return 1
  [[ "$url" != */ ]] || return 1
  [[ "$url" != *"/health"* ]] || return 1
  return 0
}

# Start a long-lived process that survives the parent shell exiting.
# macOS has no setsid(1); use Python start_new_session so classroom API/tunnel
# are not killed when the launcher shell exits or the agent job ends.
demo_daemonize() {
  local log_file="$1"
  shift
  local pid
  if command -v setsid >/dev/null 2>&1; then
    setsid "$@" </dev/null >>"$log_file" 2>&1 &
    pid=$!
  elif command -v python3 >/dev/null 2>&1; then
    pid="$(
      DEMO_DAEMON_LOG="$log_file" python3 - "$@" <<'PY'
import os, sys, subprocess
log = open(os.environ["DEMO_DAEMON_LOG"], "a", buffering=1)
proc = subprocess.Popen(
    sys.argv[1:],
    stdin=subprocess.DEVNULL,
    stdout=log,
    stderr=log,
    start_new_session=True,
    close_fds=True,
)
print(proc.pid)
PY
    )" || return 1
  else
    nohup "$@" </dev/null >>"$log_file" 2>&1 &
    pid=$!
    disown "$pid" 2>/dev/null || true
  fi
  sleep 0.2
  if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
    return 1
  fi
  printf '%s' "$pid"
}

# --- Startup lock (prevent simultaneous Start runs) ---
demo_acquire_lock() {
  demo_mkdir
  local waited=0
  while ! mkdir "$LOCK_FILE" 2>/dev/null; do
    local holder=""
    [[ -f "$LOCK_FILE/pid" ]] && holder="$(cat "$LOCK_FILE/pid" 2>/dev/null || true)"
    if [[ -n "$holder" ]] && ! kill -0 "$holder" 2>/dev/null; then
      echo "Clearing stale start lock (pid $holder gone)."
      rm -rf "$LOCK_FILE"
      continue
    fi
    if [[ "$waited" -ge 45 ]]; then
      echo "ERROR: another Start QuestBoard run is in progress (lock $LOCK_FILE${holder:+, pid $holder})." >&2
      echo "       Wait, or remove the lock only if you are sure no start is running." >&2
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  printf '%s\n' "$$" >"$LOCK_FILE/pid"
  # shellcheck disable=SC2064
  trap 'rm -rf "$LOCK_FILE"' EXIT
}

demo_release_lock() {
  rm -rf "$LOCK_FILE" 2>/dev/null || true
  trap - EXIT
}

# --- Docker Desktop readiness (macOS) ---
demo_docker_ready() {
  command -v docker >/dev/null 2>&1 || return 1
  docker info >/dev/null 2>&1
}

demo_ensure_docker() {
  local seconds="${DEMO_DOCKER_WAIT_SECONDS:-90}"
  if demo_docker_ready; then
    echo "Docker is ready."
    return 0
  fi
  if [[ "$(uname -s)" == "Darwin" ]] && [[ -d /Applications/Docker.app ]]; then
    echo "Docker is not ready — opening Docker Desktop…"
    open -a Docker >/dev/null 2>&1 || true
  else
    echo "ERROR: Docker is not available. Install/start Docker, then retry." >&2
    return 1
  fi
  local i
  for ((i = 0; i < seconds; i++)); do
    if demo_docker_ready; then
      echo "Docker ready after ${i}s."
      return 0
    fi
    sleep 1
  done
  echo "ERROR: Docker Desktop did not become ready within ${seconds}s." >&2
  echo "       Open Docker Desktop manually, wait until it says Running, then Start again." >&2
  return 1
}

demo_ensure_mysql_container() {
  if mysql_ping; then
    return 0
  fi
  demo_ensure_docker || return 1
  if docker ps -a --format '{{.Names}}' | grep -qx "$DEMO_MYSQL_CONTAINER"; then
    echo "Starting existing MySQL container '$DEMO_MYSQL_CONTAINER' (same volume; no wipe)…"
    docker start "$DEMO_MYSQL_CONTAINER" >/dev/null
  elif [[ -f "$COMPOSE_FILE" ]]; then
    echo "MySQL container missing — creating from Compose (named volume preserved if present)…"
    (cd "$(dirname "$COMPOSE_FILE")" && docker compose up -d --no-deps mysql-db-service) || return 1
  else
    echo "ERROR: MySQL container '$DEMO_MYSQL_CONTAINER' not found and no Compose file." >&2
    return 1
  fi
  local i
  for ((i = 0; i < 45; i++)); do
    mysql_ping && return 0
    sleep 1
  done
  echo "ERROR: MySQL did not accept connections at ${MYSQL_HOST}:${MYSQL_PORT}." >&2
  return 1
}

demo_local_api_healthy() {
  curl -fsS --max-time 3 "$(api_health_url)" >/dev/null 2>&1
}

# Probe public URL; print body to FD3-ish via globals / files. Detect tunnel-not-found pages.
# Returns 0 if /health looks OK.
demo_public_health_probe() {
  local url="$1"
  local out_file="${2:-$RUN_DIR/public-health.body}"
  local code_file="${3:-$RUN_DIR/public-health.code}"
  local host rest ip port code
  : >"$out_file"
  rest="${url#https://}"
  rest="${rest#http://}"
  host="${rest%%/*}"
  host="${host%%:*}"
  ip="$(dig +short "$host" @1.1.1.1 A 2>/dev/null | awk 'NR==1 && $1 ~ /^[0-9.]+$/ {print; exit}')"
  if [[ "$url" == https://* ]]; then port=443; else port=80; fi
  if [[ -n "$ip" ]]; then
    code="$(curl -sS -o "$out_file" -w '%{http_code}' --max-time 12 \
      --resolve "${host}:${port}:${ip}" "${url}/health" 2>/dev/null || echo 000)"
  else
    code="$(curl -sS -o "$out_file" -w '%{http_code}' --max-time 12 \
      "${url}/health" 2>/dev/null || echo 000)"
  fi
  printf '%s' "$code" >"$code_file"
  if grep -Eiq 'Unauthorized|Tunnel not found|error code: 1033|Error 1033' "$out_file" 2>/dev/null; then
    return 2
  fi
  if [[ "$code" == "200" ]] && grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"|status.:.ok' "$out_file" 2>/dev/null; then
    return 0
  fi
  if [[ "$code" == "200" ]] && grep -qi 'ok' "$out_file" 2>/dev/null; then
    return 0
  fi
  return 1
}

demo_tunnel_log_looks_dead() {
  [[ -f "$TUNNEL_LOG" ]] || return 1
  grep -Eiq 'Unauthorized: Tunnel not found|tunnel not found|failed to sufficiently connect|context canceled|connection refused' "$TUNNEL_LOG"
}

# Fetch the API origin baked into the published Sites bundle (best-effort).
demo_sites_baked_api_origin() {
  local origin="${SITES_ORIGIN:-}"
  [[ -n "$origin" ]] || return 1
  origin="${origin%/}"
  local html js_path js_url
  html="$(curl -fsS --max-time 15 "$origin/" 2>/dev/null || true)"
  [[ -n "$html" ]] || return 1
  js_path="$(printf '%s' "$html" | grep -Eo '/assets/index-[^\"'\'']+\.js' | head -n1 || true)"
  [[ -n "$js_path" ]] || return 1
  js_url="$origin$js_path"
  curl -fsS --max-time 30 "$js_url" 2>/dev/null \
    | grep -Eo 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com|https://[a-zA-Z0-9.-]+' \
    | grep -E 'trycloudflare\.com|ngrok|DEMO_API|questboard|api\.' \
    | head -n1 || true
}

demo_is_stable_tunnel_configured() {
  [[ -n "${DEMO_CLOUDFLARED_CONFIG:-}" && -n "${DEMO_TUNNEL_HOSTNAME:-}" ]] && return 0
  [[ "${DEMO_TUNNEL_PROVIDER:-}" == "ngrok" && -n "${DEMO_NGROK_DOMAIN:-}" ]] && return 0
  return 1
}
