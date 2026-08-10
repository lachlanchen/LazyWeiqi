#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
project_root="$(cd "$script_dir/../.." && pwd -P)"
setup_script="$project_root/scripts/setup-katago.sh"
verify_script="$project_root/scripts/verify-katago.sh"
config_file="$project_root/config/katago-analysis-9x9.cfg"
process_adapter="$project_root/apps/api/weiqi/adapters/katago/process.py"

fail() {
  printf '[test-katago-scripts] FAIL: %s\n' "$*" >&2
  exit 1
}

assert_contains() {
  local text="$1"
  local expected="$2"
  [[ "$text" == *"$expected"* ]] || fail "Expected output to contain: $expected"
}

bash -n "$setup_script"
bash -n "$verify_script"
bash "$verify_script" --static-only >/dev/null

plan="$(bash "$setup_script" --print-plan)"
assert_contains "$plan" "KataGo version:    v1.17.2"
assert_contains "$plan" "6a1fc5de9fc253723ac475a0683bf0b9d9b7bd19"
assert_contains "$plan" "kata9x9-b18c384nbt-20231025.bin.gz"
assert_contains "$plan" "97878277"
assert_contains "$plan" "586322e0f1715b3718361cfadea481f6"
assert_contains "$plan" "a1298ce1adc1dad7bd868ca962b2384cc8388ed373a00e6bae1114fa6f9e2d61"
assert_contains "$plan" "b18c384nbt-humanv0.bin.gz"
assert_contains "$plan" "99066230"
assert_contains "$plan" "dc7ce241411b05ef2a5416d6406313a4"
assert_contains "$plan" "637746e44f0efe00ad1245a50aa9bbf0716efe364c43965ead97bd6835d84ab5"
grep -F -- '--max-filesize "$expected_size"' "$setup_script" >/dev/null ||
  fail "model download is missing its exact byte ceiling"
assert_contains "$plan" "111de74b051827c1cd1f3732485106735b2d237137ebf3ba1c73429c27de2369"
assert_contains "$plan" "katago-install-attestation.json"

if bash "$setup_script" --skip-build --skip-models >/dev/null 2>&1; then
  fail "setup accepted an invocation that skipped every action"
fi

fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/weiqi-katago-tests.XXXXXX")"
cleanup() {
  if [[ -n "${fixture_root:-}" && -d "$fixture_root" && "$fixture_root" == "${TMPDIR:-/tmp}"/weiqi-katago-tests.* ]]; then
    rm -rf -- "$fixture_root"
  fi
}
trap cleanup EXIT

# Exercise the exact verification and atomic-promotion helpers with a tiny local
# fixture. Sourcing the setup script does not invoke its main function.
(
  source "$setup_script"
  fixture_part="$fixture_root/model.bin.part"
  fixture_destination="$fixture_root/model.bin"
  printf 'small pinned fixture\n' >"$fixture_part"
  fixture_size="$(stat -c '%s' "$fixture_part")"
  fixture_md5="$(md5sum "$fixture_part" | awk '{print $1}')"
  fixture_sha256="$(sha256sum "$fixture_part" | awk '{print $1}')"

  artifact_is_valid "$fixture_part" "$fixture_size" "$fixture_md5" "$fixture_sha256"
  promote_verified_artifact "$fixture_part" "$fixture_destination" \
    "$fixture_size" "$fixture_md5" "$fixture_sha256"
  [[ ! -e "$fixture_part" ]] || fail "verified part file was not atomically promoted"
  artifact_is_valid "$fixture_destination" "$fixture_size" "$fixture_md5" "$fixture_sha256"

  if (verify_artifact "$fixture_destination" "$((fixture_size + 1))" \
    "$fixture_md5" "$fixture_sha256") >/dev/null 2>&1; then
    fail "verification accepted an incorrect byte size"
  fi
  if (verify_artifact "$fixture_destination" "$fixture_size" "$fixture_md5" \
    "$(printf '0%.0s' {1..64})") >/dev/null 2>&1; then
    fail "verification accepted an incorrect SHA-256"
  fi
  ln -s "$fixture_destination" "$fixture_root/model-link.bin"
  if artifact_is_valid "$fixture_root/model-link.bin" "$fixture_size" \
    "$fixture_md5" "$fixture_sha256"; then
    fail "verification accepted a symbolic-link artifact"
  fi
)

# A copied fixture root validates the supported root override and proves that a
# single unsafe tuning drift is rejected without touching installed artifacts.
mkdir -p \
  "$fixture_root/project/config" \
  "$fixture_root/project/scripts" \
  "$fixture_root/project/apps/api/weiqi/adapters/katago"
cp -- "$config_file" "$fixture_root/project/config/katago-analysis-9x9.cfg"
cp -- "$setup_script" "$fixture_root/project/scripts/setup-katago.sh"
cp -- "$verify_script" "$fixture_root/project/scripts/verify-katago.sh"
cp -- "$process_adapter" "$fixture_root/project/apps/api/weiqi/adapters/katago/process.py"
WEIQI_PROJECT_ROOT="$fixture_root/project" bash "$fixture_root/project/scripts/verify-katago.sh" --static-only >/dev/null

sed -i 's/^nnMaxBatchSize = 16$/nnMaxBatchSize = 64/' "$fixture_root/project/config/katago-analysis-9x9.cfg"
if WEIQI_PROJECT_ROOT="$fixture_root/project" bash "$fixture_root/project/scripts/verify-katago.sh" --static-only >/dev/null 2>&1; then
  fail "static verification accepted an unbounded batch-size drift"
fi

# Existing nested parent symlinks must never redirect setup or installed
# verification outside the selected project root.
symlink_project="$fixture_root/symlink-project"
symlink_outside="$fixture_root/symlink-outside"
mkdir -p \
  "$symlink_project/config" \
  "$symlink_project/scripts" \
  "$symlink_project/apps/api/weiqi/adapters/katago" \
  "$symlink_project/.local" \
  "$symlink_outside"
cp -- "$config_file" "$symlink_project/config/katago-analysis-9x9.cfg"
cp -- "$setup_script" "$symlink_project/scripts/setup-katago.sh"
cp -- "$verify_script" "$symlink_project/scripts/verify-katago.sh"
cp -- "$process_adapter" "$symlink_project/apps/api/weiqi/adapters/katago/process.py"
ln -s -- "$symlink_outside" "$symlink_project/.local/models"
if WEIQI_PROJECT_ROOT="$symlink_project" bash "$symlink_project/scripts/setup-katago.sh" --attest-existing \
  >/dev/null 2>&1; then
  fail "setup accepted a symbolic-link model parent"
fi
if WEIQI_PROJECT_ROOT="$symlink_project" bash "$symlink_project/scripts/verify-katago.sh" \
  >/dev/null 2>&1; then
  fail "installed verification accepted a symbolic-link model parent"
fi
[[ -z "$(find "$symlink_outside" -mindepth 1 -print -quit)" ]] ||
  fail "nested symbolic-link rejection wrote outside the project"

# A project-local lifecycle lock prevents concurrent clone/build/download writes.
lock_project="$fixture_root/lock-project"
mkdir -p -- "$lock_project"
lock_ready="$fixture_root/lock-ready"
lock_release="$fixture_root/lock-release"
WEIQI_PROJECT_ROOT="$lock_project" bash -c '
  source "$1"
  acquire_setup_lock
  : >"$2"
  while [[ ! -e "$3" ]]; do sleep 0.05; done
' _ "$setup_script" "$lock_ready" "$lock_release" &
lock_holder_pid="$!"
for _attempt in {1..100}; do
  [[ -e "$lock_ready" ]] && break
  kill -0 "$lock_holder_pid" 2>/dev/null || fail "setup-lock holder exited early"
  sleep 0.05
done
[[ -e "$lock_ready" ]] || fail "setup-lock holder did not become ready"
lock_error="$fixture_root/lock-error"
if WEIQI_PROJECT_ROOT="$lock_project" bash "$setup_script" --attest-existing \
  >"$lock_error" 2>&1; then
  fail "concurrent setup unexpectedly acquired the project lock"
fi
grep -Fq "Another KataGo setup is already running" "$lock_error" ||
  fail "concurrent setup did not fail specifically on the lifecycle lock"
: >"$lock_release"
wait "$lock_holder_pid"

printf '[test-katago-scripts] PASS\n'
