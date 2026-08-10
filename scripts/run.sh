#!/usr/bin/env bash
set -euo pipefail

umask 077

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
default_runtime_dir="$project_root/.local/runtime/app"
runtime_dir="${WEIQI_RUNTIME_DIR:-$default_runtime_dir}"
log_dir="$runtime_dir/logs"
pid_file="$runtime_dir/api.pid"
runtime_owner_value="weiqi-app-runtime-v1"
host="${WEIQI_HOST:-127.0.0.1}"
port="${WEIQI_PORT:-8010}"
health_url="http://127.0.0.1:$port/healthz"
expected_args="uvicorn weiqi.main:app"

die() {
  echo "run: $*" >&2
  exit 1
}

require_commands() {
  local command_name
  for command_name in "$@"; do
    command -v "$command_name" >/dev/null || die "missing prerequisite command: $command_name"
  done
}

validate_configuration() {
  local requested_runtime="$runtime_dir"
  local owner_marker
  command -v find >/dev/null || die "missing prerequisite command: find"
  command -v realpath >/dev/null || die "missing prerequisite command: realpath"
  [[ "$host" == "127.0.0.1" ]] || die "WEIQI_HOST must remain 127.0.0.1"
  [[ "$port" =~ ^[1-9][0-9]*$ ]] && ((port <= 65535)) ||
    die "WEIQI_PORT must be an integer from 1 through 65535"
  [[ ! -L "$requested_runtime" ]] || die "WEIQI_RUNTIME_DIR must not be a symbolic link"
  runtime_dir="$(realpath -m -- "$requested_runtime")"
  [[ "$runtime_dir" != "/" && "$runtime_dir" != "$project_root" &&
      "$runtime_dir" != "$(realpath -m -- "${HOME:-/nonexistent}")" &&
      "$(dirname -- "$runtime_dir")" != "/" ]] ||
    die "WEIQI_RUNTIME_DIR must be a dedicated child directory"
  [[ ! -e "$runtime_dir" || -d "$runtime_dir" ]] ||
    die "WEIQI_RUNTIME_DIR must be a directory"
  owner_marker="$runtime_dir/.weiqi-runtime-owner"
  [[ ! -L "$owner_marker" ]] || die "runtime ownership marker must not be a symbolic link"
  if [[ -e "$owner_marker" ]]; then
    [[ -f "$owner_marker" && "$(<"$owner_marker")" == "$runtime_owner_value" ]] ||
      die "WEIQI_RUNTIME_DIR has a foreign ownership marker"
  elif [[ -d "$runtime_dir" && "$runtime_dir" != "$default_runtime_dir" ]] &&
    [[ -n "$(find "$runtime_dir" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
    die "existing WEIQI_RUNTIME_DIR is not owned by Weiqi"
  fi
  log_dir="$runtime_dir/logs"
  pid_file="$runtime_dir/api.pid"
  validate_private_file_target "$pid_file"
  validate_private_file_target "$log_dir/api.log"
}

validate_web_dist_target() {
  local web_root="$project_root/apps/web"
  local dist_path="$web_root/dist"
  local resolved_web_root resolved_dist
  [[ -d "$web_root" && ! -L "$web_root" ]] ||
    die "apps/web must be a real project directory"
  [[ ! -L "$dist_path" ]] || die "apps/web/dist must not be a symbolic link"
  [[ ! -e "$dist_path" || -d "$dist_path" ]] ||
    die "apps/web/dist must be a directory when it exists"
  resolved_web_root="$(realpath -e -- "$web_root")"
  resolved_dist="$(realpath -m -- "$dist_path")"
  [[ "$resolved_web_root" == "$project_root/apps/web" &&
      "$resolved_dist" == "$resolved_web_root/dist" ]] ||
    die "apps/web/dist must resolve to the project build directory"
}

prepare_private_directory() {
  local path="$1"
  [[ ! -L "$path" ]] || die "private runtime path must not be a symbolic link: $path"
  [[ ! -e "$path" || -d "$path" ]] ||
    die "private runtime path is not a directory: $path"
  mkdir -p -- "$path"
  chmod 700 -- "$path"
}

prepare_private_file_target() {
  local path="$1"
  [[ ! -L "$path" ]] || die "private runtime file must not be a symbolic link: $path"
  [[ ! -e "$path" || -f "$path" ]] ||
    die "private runtime file is not a regular file: $path"
  [[ ! -e "$path" ]] || chmod 600 -- "$path"
}

validate_private_file_target() {
  local path="$1"
  [[ ! -L "$path" ]] || die "private runtime file must not be a symbolic link: $path"
  [[ ! -e "$path" || -f "$path" ]] ||
    die "private runtime file is not a regular file: $path"
}

claim_runtime_directory() {
  local owner_marker="$runtime_dir/.weiqi-runtime-owner"
  local marker_part="$runtime_dir/.weiqi-runtime-owner.part.$$"
  prepare_private_directory "$runtime_dir"
  if [[ ! -e "$owner_marker" ]]; then
    [[ ! -L "$marker_part" ]] || die "runtime ownership marker staging path is unsafe"
    printf '%s\n' "$runtime_owner_value" >"$marker_part"
    chmod 600 -- "$marker_part"
    mv -- "$marker_part" "$owner_marker"
  fi
  [[ -f "$owner_marker" && ! -L "$owner_marker" &&
      "$(<"$owner_marker")" == "$runtime_owner_value" ]] ||
    die "WEIQI_RUNTIME_DIR ownership could not be established"
  chmod 600 -- "$owner_marker"
}

pid_is_running() {
  local pid="$1"
  local state
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  state="$(ps -p "$pid" -o stat= 2>/dev/null)" || return 1
  state="${state//[[:space:]]/}"
  [[ -n "$state" && "$state" != Z* ]]
}

pid_is_owned() {
  local pid
  [[ -f "$pid_file" ]] || return 1
  pid="$(<"$pid_file")"
  pid_is_running "$pid" || return 1
  ps -p "$pid" -o args= 2>/dev/null | grep -Fq -- "$expected_args" || return 1
  ps -p "$pid" -o args= 2>/dev/null | grep -Fq -- "--port $port"
}

port_is_listening() {
  [[ -n "$(ss -H -ltn "sport = :$port" 2>/dev/null || true)" ]]
}

health_is_ready() {
  curl --fail --silent --show-error --connect-timeout 1 --max-time 3 \
    "$health_url" >/dev/null 2>&1
}

status() {
  local running="false"
  local healthy="false"
  pid_is_owned && running="true"
  health_is_ready && healthy="true"
  printf '{"url":"http://127.0.0.1:%s/","pidOwned":%s,"healthy":%s,"log":"%s"}\n' \
    "$port" "$running" "$healthy" "$log_dir/api.log"
}

start() {
  validate_web_dist_target
  require_commands curl grep npm ps ss uv
  if pid_is_owned; then
    health_is_ready || die "owned API process exists but health check is failing"
    status
    return 0
  fi
  if port_is_listening; then
    die "port $port is occupied by a process this repository does not own"
  fi

  prepare_private_directory "$runtime_dir"
  prepare_private_directory "$log_dir"
  prepare_private_file_target "$pid_file"
  prepare_private_file_target "$log_dir/api.log"
  cd "$project_root"
  npm run build

  nohup uv run --locked --project apps/api uvicorn weiqi.main:app \
    --app-dir apps/api --host "$host" --port "$port" \
    >"$log_dir/api.log" 2>&1 &
  local api_pid="$!"
  printf '%s\n' "$api_pid" >"$pid_file"
  chmod 600 -- "$pid_file"

  local attempt
  for ((attempt = 1; attempt <= 120; attempt++)); do
    if ! pid_is_running "$api_pid"; then
      tail -n 80 "$log_dir/api.log" >&2 || true
      rm -f -- "$pid_file"
      die "API exited before becoming healthy"
    fi
    if health_is_ready; then
      status
      return 0
    fi
    sleep 0.25
  done

  tail -n 80 "$log_dir/api.log" >&2 || true
  stop
  die "API health check timed out"
}

stop() {
  require_commands grep ps rm
  if ! pid_is_owned; then
    [[ ! -f "$pid_file" ]] || echo "Ignoring stale or foreign PID file: $pid_file" >&2
    rm -f -- "$pid_file"
    return 0
  fi
  local api_pid
  api_pid="$(<"$pid_file")"
  kill -TERM "$api_pid" 2>/dev/null || true
  local attempt
  for ((attempt = 1; attempt <= 50; attempt++)); do
    pid_is_running "$api_pid" || break
    sleep 0.1
  done
  if pid_is_running "$api_pid" && pid_is_owned; then
    kill -KILL "$api_pid" 2>/dev/null || true
  fi
  rm -f -- "$pid_file"
}

with_lifecycle_lock() {
  local action_name="$1"
  local lock_file="$runtime_dir/.lifecycle.lock"
  require_commands flock
  claim_runtime_directory
  [[ ! -L "$lock_file" ]] || die "lifecycle lock must not be a symbolic link"
  exec 9>"$lock_file"
  chmod 600 -- "$lock_file"
  flock -x 9
  # Run the action in a subshell so even `die`/`exit` returns here. Explicitly
  # unlocking the shared open-file description prevents long-lived children
  # from retaining this lifecycle lock after start returns.
  set +e
  ("$action_name")
  local status_code="$?"
  set -e
  flock -u 9
  return "$status_code"
}

action="${1:-start}"
validate_configuration
case "$action" in
  start) with_lifecycle_lock start ;;
  status)
    require_commands curl grep ps
    status
    ;;
  stop) with_lifecycle_lock stop ;;
  *) echo "Usage: $0 {start|status|stop}" >&2; exit 2 ;;
esac
