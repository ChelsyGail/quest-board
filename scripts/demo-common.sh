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
API_LOG="$RUN_DIR/api.log"
TUNNEL_LOG="$RUN_DIR/tunnel.log"
CAFFEINATE_LOG="$RUN_DIR/caffeinate.log"
ENV_FILE="${DEMO_ENV_FILE:-$ROOT/scripts/demo.env}"
DEVCONTAINER_ENV="${DEVCONTAINER_ENV:-$ROOT/.devcontainer/.env}"
SCHEMA_DIR="$ROOT/apps/backend/src/database/schema"

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

wait_http_ok() {
  local url="$1" seconds="${2:-20}"
  local i
  for ((i = 0; i < seconds; i++)); do
    if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
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
demo_daemonize() {
  local log_file="$1"
  shift
  local pid
  if command -v setsid >/dev/null 2>&1; then
    setsid "$@" </dev/null >>"$log_file" 2>&1 &
    pid=$!
  else
    nohup "$@" </dev/null >>"$log_file" 2>&1 &
    pid=$!
    disown "$pid" 2>/dev/null || true
  fi
  sleep 0.2
  if ! kill -0 "$pid" 2>/dev/null; then
    return 1
  fi
  printf '%s' "$pid"
}
