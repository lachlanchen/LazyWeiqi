#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
project_root="$(cd "$script_dir/../.." && pwd -P)"
run_script="$project_root/scripts/run.sh"
novnc_script="$project_root/scripts/launch-novnc.sh"

fail() {
  printf '[test-runtime-safety] FAIL: %s\n' "$*" >&2
  exit 1
}

expect_rejected() {
  local assignment="$1"
  local script="$2"
  if env "$assignment" bash "$script" status >/dev/null 2>&1; then
    fail "$script accepted unsafe override $assignment"
  fi
}

bash -n "$run_script" "$novnc_script"
expect_rejected "WEIQI_RUNTIME_DIR=/" "$run_script"
expect_rejected "WEIQI_RUNTIME_DIR=/weiqi-runtime" "$run_script"
expect_rejected "WEIQI_RUNTIME_DIR=$(dirname "$project_root")" "$run_script"
expect_rejected "WEIQI_NOVNC_RUNTIME_DIR=/" "$novnc_script"
expect_rejected "WEIQI_NOVNC_RUNTIME_DIR=/weiqi-browser" "$novnc_script"
expect_rejected "WEIQI_NOVNC_RUNTIME_DIR=$(dirname "$project_root")" "$novnc_script"

fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/weiqi-runtime-safety.XXXXXX")"
cleanup() {
  if [[ -n "${fixture_root:-}" && -d "$fixture_root" &&
        "$fixture_root" == "${TMPDIR:-/tmp}"/weiqi-runtime-safety.* ]]; then
    rm -rf -- "$fixture_root"
  fi
}
trap cleanup EXIT

mkdir -p -- "$fixture_root/real-runtime"
ln -s -- "$fixture_root/real-runtime" "$fixture_root/runtime-link"
expect_rejected "WEIQI_RUNTIME_DIR=$fixture_root/runtime-link" "$run_script"
expect_rejected "WEIQI_NOVNC_RUNTIME_DIR=$fixture_root/runtime-link" "$novnc_script"

for runtime_kind in app browser; do
  owned_runtime="$fixture_root/$runtime_kind-runtime"
  mkdir -p -- "$owned_runtime/logs"
  if [[ "$runtime_kind" == "app" ]]; then
    printf 'weiqi-app-runtime-v1\n' >"$owned_runtime/.weiqi-runtime-owner"
    ln -s -- "$fixture_root/real-runtime" "$owned_runtime/api.pid"
    expect_rejected "WEIQI_RUNTIME_DIR=$owned_runtime" "$run_script"
  else
    printf 'weiqi-browser-runtime-v1\n' >"$owned_runtime/.weiqi-runtime-owner"
    ln -s -- "$fixture_root/real-runtime" "$owned_runtime/chrome.pid"
    expect_rejected "WEIQI_NOVNC_RUNTIME_DIR=$owned_runtime" "$novnc_script"
  fi
done

# A copied launcher must reject a Vite output symlink before npm can empty or
# write through it. The outside sentinel proves the status preflight is read-only.
web_fixture="$fixture_root/web-project"
outside_dist="$fixture_root/outside-dist"
mkdir -p -- "$web_fixture/scripts" "$web_fixture/apps/web" "$outside_dist"
cp -- "$run_script" "$web_fixture/scripts/run.sh"
printf 'keep me\n' >"$outside_dist/sentinel.txt"
ln -s -- "$outside_dist" "$web_fixture/apps/web/dist"
if WEIQI_RUNTIME_DIR="$fixture_root/web-runtime" bash "$web_fixture/scripts/run.sh" start \
  >/dev/null 2>&1; then
  fail "app launcher accepted a symbolic-link Vite output directory"
fi
[[ "$(<"$outside_dist/sentinel.txt")" == "keep me" ]] ||
  fail "Vite output preflight modified the outside sentinel"
WEIQI_RUNTIME_DIR="$fixture_root/web-runtime" bash "$web_fixture/scripts/run.sh" stop \
  >/dev/null 2>&1 || fail "unsafe Vite output prevented the owned app stop path"

grep -Fq 'flock -u 9' "$run_script" || fail "app lifecycle lock is not explicitly released"
grep -Fq 'flock -u 9' "$novnc_script" || fail "browser lifecycle lock is not explicitly released"

printf '[test-runtime-safety] PASS\n'
