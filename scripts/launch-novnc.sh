#!/usr/bin/env bash
set -euo pipefail

umask 077

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
default_runtime_dir="$project_root/.local/runtime/browser"
runtime_dir="${WEIQI_NOVNC_RUNTIME_DIR:-$default_runtime_dir}"
profile_dir="$runtime_dir/profile"
log_dir="$runtime_dir/logs"
runtime_owner_value="weiqi-browser-runtime-v1"
display_number="${WEIQI_NOVNC_DISPLAY_NUMBER:-101}"
vnc_port="${WEIQI_NOVNC_VNC_PORT:-5931}"
novnc_port="${WEIQI_NOVNC_PORT:-6131}"
cdp_port="${WEIQI_NOVNC_CDP_PORT:-9471}"
app_port="${WEIQI_PORT:-8010}"
app_url="http://127.0.0.1:$app_port/"
novnc_web_root="/usr/share/novnc"
chrome_binary="/opt/google/chrome/chrome"
started_names=()
started_pids=()
started_expectations=()
start_committed="false"

die() {
  echo "launch-novnc: $*" >&2
  exit 1
}

require_commands() {
  local command_name
  for command_name in "$@"; do
    command -v "$command_name" >/dev/null || die "missing prerequisite command: $command_name"
  done
}

validate_configuration() {
  local owner_marker port requested_runtime="$runtime_dir"
  command -v find >/dev/null || die "missing prerequisite command: find"
  command -v realpath >/dev/null || die "missing prerequisite command: realpath"
  [[ "$display_number" =~ ^[0-9]+$ ]] || die "display number must be non-negative"
  for port in "$vnc_port" "$novnc_port" "$cdp_port" "$app_port"; do
    [[ "$port" =~ ^[1-9][0-9]*$ ]] && ((port <= 65535)) ||
      die "ports must be integers from 1 through 65535"
  done
  [[ ! -L "$requested_runtime" ]] ||
    die "WEIQI_NOVNC_RUNTIME_DIR must not be a symbolic link"
  runtime_dir="$(realpath -m -- "$requested_runtime")"
  [[ "$runtime_dir" != "/" && "$runtime_dir" != "$project_root" &&
      "$runtime_dir" != "$(realpath -m -- "${HOME:-/nonexistent}")" &&
      "$(dirname -- "$runtime_dir")" != "/" ]] ||
    die "WEIQI_NOVNC_RUNTIME_DIR must be a dedicated child directory"
  [[ ! -e "$runtime_dir" || -d "$runtime_dir" ]] ||
    die "WEIQI_NOVNC_RUNTIME_DIR must be a directory"
  owner_marker="$runtime_dir/.weiqi-runtime-owner"
  [[ ! -L "$owner_marker" ]] || die "runtime ownership marker must not be a symbolic link"
  if [[ -e "$owner_marker" ]]; then
    [[ -f "$owner_marker" && "$(<"$owner_marker")" == "$runtime_owner_value" ]] ||
      die "WEIQI_NOVNC_RUNTIME_DIR has a foreign ownership marker"
  elif [[ -d "$runtime_dir" && "$runtime_dir" != "$default_runtime_dir" ]] &&
    [[ -n "$(find "$runtime_dir" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
    die "existing WEIQI_NOVNC_RUNTIME_DIR is not owned by Weiqi"
  fi
  profile_dir="$runtime_dir/profile"
  log_dir="$runtime_dir/logs"
  local private_output
  for private_output in \
    "$runtime_dir/xvfb.pid" "$runtime_dir/x11vnc.pid" \
    "$runtime_dir/websockify.pid" "$runtime_dir/chrome.pid" \
    "$log_dir/xvfb.log" "$log_dir/x11vnc.log" \
    "$log_dir/websockify.log" "$log_dir/chrome.log"; do
    validate_private_file_target "$private_output"
  done
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
    die "WEIQI_NOVNC_RUNTIME_DIR ownership could not be established"
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

pid_matches() {
  local pid="$1"
  local expected="$2"
  pid_is_running "$pid" || return 1
  ps -p "$pid" -o args= 2>/dev/null | grep -Fq -- "$expected"
}

pid_is_owned() {
  local pid_file="$1"
  local expected="$2"
  local pid
  [[ -f "$pid_file" ]] || return 1
  pid="$(<"$pid_file")"
  pid_matches "$pid" "$expected"
}

port_is_listening() {
  local port="$1"
  [[ -n "$(ss -H -ltn "sport = :$port" 2>/dev/null || true)" ]]
}

app_is_ready() {
  local body
  body="$(curl -fsS --connect-timeout 1 --max-time 3 \
    "http://127.0.0.1:$app_port/healthz" 2>/dev/null)" || return 1
  grep -Eq '"service"[[:space:]]*:[[:space:]]*"weiqi"' <<<"$body"
}

chrome_window_fits() {
  local window_id window_ids geometry
  window_ids="$(DISPLAY=":$display_number" xdotool search --onlyvisible \
    --class google-chrome 2>/dev/null)" || return 1
  window_id="${window_ids%%$'\n'*}"
  [[ "$window_id" =~ ^[0-9]+$ ]] || return 1
  geometry="$(DISPLAY=":$display_number" xdotool getwindowgeometry --shell \
    "$window_id" 2>/dev/null)" || return 1
  grep -qx 'X=0' <<<"$geometry" &&
    grep -qx 'Y=0' <<<"$geometry" &&
    grep -qx 'WIDTH=1440' <<<"$geometry" &&
    grep -qx 'HEIGHT=1000' <<<"$geometry"
}

display_process_is_running() {
  ps -eo comm=,args= 2>/dev/null | awk -v display=":$display_number" '
    $1 == "Xvfb" {
      for (field = 2; field <= NF; field++) {
        if ($field == display) { found = 1; exit }
      }
    }
    END { exit(found ? 0 : 1) }
  '
}

cleanup_stale_display_artifacts() {
  local lock_path="/tmp/.X${display_number}-lock"
  local socket_path="/tmp/.X11-unix/X${display_number}"
  local lock_pid=""
  [[ -e "$lock_path" || -S "$socket_path" ]] || return 0
  [[ ! -e "$lock_path" || -r "$lock_path" ]] || return 1
  if [[ -r "$lock_path" ]]; then
    lock_pid="$(tr -d '[:space:]' <"$lock_path")"
    [[ "$lock_pid" =~ ^[1-9][0-9]*$ ]] || return 1
    pid_is_running "$lock_pid" && return 1
  fi
  display_process_is_running && return 1
  rm -f -- "$lock_path" "$socket_path"
}

wait_for_socket() {
  local pid="$1"
  local log_file="$2"
  local attempt
  for ((attempt = 1; attempt <= 100; attempt++)); do
    pid_is_running "$pid" || { tail -n 60 "$log_file" >&2 || true; return 1; }
    [[ -S "/tmp/.X11-unix/X$display_number" ]] && return 0
    sleep 0.2
  done
  tail -n 60 "$log_file" >&2 || true
  return 1
}

wait_for_http() {
  local url="$1"
  local pid="$2"
  local log_file="$3"
  local attempt
  for ((attempt = 1; attempt <= 100; attempt++)); do
    pid_is_running "$pid" || { tail -n 60 "$log_file" >&2 || true; return 1; }
    curl --fail --silent --show-error --connect-timeout 1 --max-time 2 \
      "$url" >/dev/null 2>&1 && return 0
    sleep 0.2
  done
  tail -n 60 "$log_file" >&2 || true
  return 1
}

wait_for_listener() {
  local port="$1"
  local pid="$2"
  local log_file="$3"
  local attempt
  for ((attempt = 1; attempt <= 100; attempt++)); do
    pid_is_running "$pid" || { tail -n 60 "$log_file" >&2 || true; return 1; }
    port_is_listening "$port" && return 0
    sleep 0.2
  done
  tail -n 60 "$log_file" >&2 || true
  return 1
}

register_child() {
  local name="$1"
  local pid="$2"
  local expected="$3"
  started_names+=("$name")
  started_pids+=("$pid")
  started_expectations+=("$expected")
  local child_pid_file="$runtime_dir/$name.pid"
  prepare_private_file_target "$child_pid_file"
  printf '%s\n' "$pid" >"$child_pid_file"
  chmod 600 -- "$child_pid_file"
}

cleanup_started_children() {
  local index pid expected pid_file recorded
  for ((index = ${#started_pids[@]} - 1; index >= 0; index--)); do
    pid="${started_pids[$index]}"
    expected="${started_expectations[$index]}"
    pid_file="$runtime_dir/${started_names[$index]}.pid"
    if pid_matches "$pid" "$expected"; then
      kill -TERM "$pid" 2>/dev/null || true
      for ((_attempt = 1; _attempt <= 30; _attempt++)); do
        pid_is_running "$pid" || break
        sleep 0.1
      done
      pid_matches "$pid" "$expected" && kill -KILL "$pid" 2>/dev/null || true
    fi
    if [[ -f "$pid_file" ]]; then
      recorded="$(<"$pid_file")"
      [[ "$recorded" != "$pid" ]] || rm -f -- "$pid_file"
    fi
  done
}

startup_exit() {
  local status_code="$1"
  trap - EXIT INT TERM HUP
  if [[ "$start_committed" != "true" ]]; then
    cleanup_started_children
  fi
  exit "$status_code"
}

status() {
  local cdp_ready="false"
  local novnc_ready="false"
  local app_ready="false"
  local xvfb_owned="false"
  local x11vnc_owned="false"
  local websockify_owned="false"
  local chrome_owned="false"
  local window_fit="false"
  pid_is_owned "$runtime_dir/xvfb.pid" "Xvfb :$display_number" && xvfb_owned="true"
  pid_is_owned "$runtime_dir/x11vnc.pid" "-rfbport $vnc_port" && x11vnc_owned="true"
  pid_is_owned "$runtime_dir/websockify.pid" "127.0.0.1:$novnc_port" &&
    websockify_owned="true"
  pid_is_owned "$runtime_dir/chrome.pid" "--user-data-dir=$profile_dir" && chrome_owned="true"
  if [[ "$chrome_owned" == "true" ]] && curl -fsS --connect-timeout 1 --max-time 2 \
    "http://127.0.0.1:$cdp_port/json/version" >/dev/null 2>&1; then
    cdp_ready="true"
    chrome_window_fits && window_fit="true"
  fi
  if [[ "$xvfb_owned" == "true" && "$x11vnc_owned" == "true" &&
        "$websockify_owned" == "true" ]] && curl -fsS --connect-timeout 1 --max-time 2 \
    "http://127.0.0.1:$novnc_port/vnc.html" >/dev/null 2>&1; then
    novnc_ready="true"
  fi
  app_is_ready && app_ready="true"
  printf '{"display":":%s","vnc":"127.0.0.1:%s","novnc":"http://127.0.0.1:%s/vnc.html?host=127.0.0.1&port=%s&autoconnect=1&resize=scale","cdp":"http://127.0.0.1:%s","app":"%s","appReady":%s,"xvfbOwned":%s,"x11vncOwned":%s,"websockifyOwned":%s,"chromeOwned":%s,"windowFit":%s,"cdpReady":%s,"novncReady":%s}\n' \
    "$display_number" "$vnc_port" "$novnc_port" "$novnc_port" "$cdp_port" \
    "$app_url" "$app_ready" "$xvfb_owned" "$x11vnc_owned" "$websockify_owned" \
    "$chrome_owned" "$window_fit" "$cdp_ready" "$novnc_ready"
}

start() {
  require_commands awk curl grep ps rm ss tr websockify Xvfb x11vnc xdotool
  [[ -r "$novnc_web_root/vnc.html" ]] || die "missing noVNC client"
  [[ -f "$chrome_binary" && ! -L "$chrome_binary" && -x "$chrome_binary" ]] ||
    die "missing trusted Chrome binary: $chrome_binary"
  app_is_ready ||
    die "the Weiqi app must be running at $app_url before noVNC starts"
  prepare_private_directory "$runtime_dir"
  prepare_private_directory "$profile_dir"
  prepare_private_directory "$log_dir"
  prepare_private_directory "$runtime_dir/evidence"
  local private_output
  for private_output in \
    "$runtime_dir/xvfb.pid" "$runtime_dir/x11vnc.pid" \
    "$runtime_dir/websockify.pid" "$runtime_dir/chrome.pid" \
    "$log_dir/xvfb.log" "$log_dir/x11vnc.log" \
    "$log_dir/websockify.log" "$log_dir/chrome.log"; do
    prepare_private_file_target "$private_output"
  done

  if [[ -e "/tmp/.X${display_number}-lock" || -S "/tmp/.X11-unix/X${display_number}" ]]; then
    if ! pid_is_owned "$runtime_dir/xvfb.pid" "Xvfb :$display_number"; then
      cleanup_stale_display_artifacts || die "display :$display_number is occupied"
    fi
  fi
  local port
  for port in "$vnc_port" "$novnc_port" "$cdp_port"; do
    port_is_listening "$port" && die "port $port is occupied"
  done

  trap 'startup_exit $?' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM HUP

  nohup Xvfb ":$display_number" -screen 0 1440x1000x24 -nolisten tcp -ac \
    >"$log_dir/xvfb.log" 2>&1 &
  register_child xvfb "$!" "Xvfb :$display_number"
  wait_for_socket "${started_pids[-1]}" "$log_dir/xvfb.log" || die "Xvfb did not become ready"

  nohup x11vnc -display ":$display_number" -localhost -nopw -forever -shared \
    -rfbport "$vnc_port" >"$log_dir/x11vnc.log" 2>&1 &
  register_child x11vnc "$!" "-rfbport $vnc_port"
  wait_for_listener "$vnc_port" "${started_pids[-1]}" "$log_dir/x11vnc.log" ||
    die "x11vnc did not become ready"

  nohup websockify --web="$novnc_web_root" \
    "127.0.0.1:$novnc_port" "127.0.0.1:$vnc_port" \
    >"$log_dir/websockify.log" 2>&1 &
  register_child websockify "$!" "127.0.0.1:$novnc_port"
  wait_for_http "http://127.0.0.1:$novnc_port/vnc.html" "${started_pids[-1]}" \
    "$log_dir/websockify.log" || die "noVNC did not become ready"

  DISPLAY=":$display_number" CHROME_VERSION_EXTRA=stable \
    GNOME_DISABLE_CRASH_DIALOG=SET_BY_WEIQI nohup "$chrome_binary" \
    --user-data-dir="$profile_dir" \
    --remote-debugging-address=127.0.0.1 \
    --remote-debugging-port="$cdp_port" \
    --window-position=0,0 --window-size=1440,1000 \
    --no-first-run --no-default-browser-check --disable-dev-shm-usage --disable-gpu \
    --disable-breakpad --disable-crashpad-for-testing \
    --enable-features=NetworkServiceInProcess2 \
    --host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost" \
    --proxy-server="http://127.0.0.1:9" --proxy-bypass-list="localhost;127.0.0.1" \
    --disable-quic \
    --disable-background-networking --disable-background-mode \
    --disable-client-side-phishing-detection --disable-component-update \
    --disable-component-extensions-with-background-pages --disable-default-apps \
    --disable-domain-reliability --disable-extensions --disable-speech-api --disable-sync \
    --metrics-recording-only --no-pings \
    --disable-features=AutofillServerCommunication,CertificateTransparencyComponentUpdater,MediaRouter,NotificationTriggers,Notifications,OptimizationGuideModelDownloading,OptimizationHints,PushMessaging,PushMessagingProfileService,PushMessagingSubscriptionChange,SegmentationPlatform,Translate \
    "$app_url" >"$log_dir/chrome.log" 2>&1 &
  register_child chrome "$!" "--user-data-dir=$profile_dir"
  wait_for_http "http://127.0.0.1:$cdp_port/json/version" "${started_pids[-1]}" \
    "$log_dir/chrome.log" || die "Chrome CDP did not become ready"

  local fit_attempt
  for ((fit_attempt = 1; fit_attempt <= 20; fit_attempt++)); do
    DISPLAY=":$display_number" timeout 2 xdotool search --sync --onlyvisible \
      --class google-chrome windowmove --sync 0 0 windowsize --sync 1440 1000 \
      >/dev/null 2>&1 || true
    chrome_window_fits && break
    sleep 0.2
  done
  chrome_window_fits || die "Chrome did not fit the dedicated 1440x1000 desktop"

  start_committed="true"
  trap - EXIT INT TERM HUP
  status
}

stop() {
  require_commands grep ps rm
  local name pid_file expected pid
  for name in chrome websockify x11vnc xvfb; do
    pid_file="$runtime_dir/$name.pid"
    case "$name" in
      chrome) expected="--user-data-dir=$profile_dir" ;;
      websockify) expected="127.0.0.1:$novnc_port" ;;
      x11vnc) expected="-rfbport $vnc_port" ;;
      xvfb) expected="Xvfb :$display_number" ;;
    esac
    if pid_is_owned "$pid_file" "$expected"; then
      pid="$(<"$pid_file")"
      kill -TERM "$pid" 2>/dev/null || true
      for ((_attempt = 1; _attempt <= 40; _attempt++)); do
        pid_is_running "$pid" || break
        sleep 0.1
      done
      pid_matches "$pid" "$expected" && kill -KILL "$pid" 2>/dev/null || true
    elif [[ -f "$pid_file" ]]; then
      echo "Ignoring stale or foreign PID file: $pid_file" >&2
    fi
    rm -f -- "$pid_file"
  done
  cleanup_stale_display_artifacts || true
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
    require_commands curl grep ps xdotool
    status
    ;;
  stop) with_lifecycle_lock stop ;;
  *) echo "Usage: $0 {start|status|stop}" >&2; exit 2 ;;
esac
