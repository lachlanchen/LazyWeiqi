#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
default_project_root="$(cd "$script_dir/.." && pwd -P)"
project_root="${WEIQI_PROJECT_ROOT:-$default_project_root}"

if [[ "$project_root" != /* || "$project_root" == "/" || ! -d "$project_root" ]]; then
  printf 'Invalid WEIQI_PROJECT_ROOT: %s\n' "$project_root" >&2
  exit 2
fi
project_root="$(cd "$project_root" && pwd -P)"
readonly project_root

readonly KATAGO_REPOSITORY_URL="https://github.com/lightvector/KataGo.git"
readonly KATAGO_VERSION="v1.17.2"
readonly KATAGO_COMMIT="6a1fc5de9fc253723ac475a0683bf0b9d9b7bd19"

readonly MAIN_MODEL_NAME="kata9x9-b18c384nbt-20231025.bin.gz"
readonly MAIN_MODEL_URL="https://media.katagotraining.org/uploaded/networks/models_extra/kata9x9-b18c384nbt-20231025.bin.gz"
readonly MAIN_MODEL_SIZE="97878277"
readonly MAIN_MODEL_MD5="586322e0f1715b3718361cfadea481f6"
readonly MAIN_MODEL_SHA256="a1298ce1adc1dad7bd868ca962b2384cc8388ed373a00e6bae1114fa6f9e2d61"
readonly HUMAN_MODEL_NAME="b18c384nbt-humanv0.bin.gz"
readonly HUMAN_MODEL_URL="https://media.katagotraining.org/uploaded/networks/models_extra/b18c384nbt-humanv0.bin.gz"
readonly HUMAN_MODEL_SIZE="99066230"
readonly HUMAN_MODEL_MD5="dc7ce241411b05ef2a5416d6406313a4"
readonly HUMAN_MODEL_SHA256="637746e44f0efe00ad1245a50aa9bbf0716efe364c43965ead97bd6835d84ab5"
readonly CONFIG_NAME="katago-analysis-9x9.cfg"
readonly CONFIG_SIZE="1451"
readonly CONFIG_SHA256="111de74b051827c1cd1f3732485106735b2d237137ebf3ba1c73429c27de2369"
readonly ATTESTATION_SCHEMA="1"

readonly local_root="$project_root/.local"
readonly source_dir="$local_root/src/KataGo-$KATAGO_VERSION"
readonly install_bin="$local_root/bin/katago"
readonly model_dir="$local_root/models/katago"
readonly manifest_path="$model_dir/installed-models.sha256"
readonly config_path="$project_root/config/$CONFIG_NAME"
readonly attestation_path="$local_root/katago-install-attestation.json"
readonly setup_script="$project_root/scripts/setup-katago.sh"
readonly process_adapter="$project_root/apps/api/weiqi/adapters/katago/process.py"

log() {
  printf '[verify-katago] %s\n' "$*"
}

die() {
  printf '[verify-katago] ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: scripts/verify-katago.sh [--static-only] [--smoke]

With no option, verify the pinned source commit, engine version, exact upstream
model byte sizes and hashes, static 9x9 config, and setup-produced runtime
attestation. The verifier does not load either neural network unless --smoke is
explicitly selected.

Options:
  --static-only  Validate committed pins and configuration without .local files.
  --smoke        Also run an explicit, bounded GPU model-load and 4-visit query.
  -h, --help     Show this help.

Environment for --smoke:
  WEIQI_KATAGO_GPU                   Physical GPU mask (default: 1).
  WEIQI_KATAGO_MIN_FREE_MIB          Required free VRAM (default: 6144).
  WEIQI_KATAGO_SMOKE_TIMEOUT_SECONDS Startup/query timeout (default: 120).

The smoke check never kills or evicts unrelated GPU processes. It exits before
launch if the selected GPU has less than the configured free-memory reserve.
EOF
}

require_command() {
  local command_name="$1"
  command -v "$command_name" >/dev/null 2>&1 || die "Required command not found: $command_name"
}

assert_project_local_layout() {
  require_command realpath
  local path resolved
  local -a directory_paths=(
    "$local_root"
    "$local_root/src"
    "$source_dir"
    "$local_root/bin"
    "$local_root/models"
    "$model_dir"
    "$local_root/runtime"
    "$local_root/runtime/katago"
  )
  local -a artifact_paths=(
    "$source_dir"
    "$install_bin"
    "$model_dir/$MAIN_MODEL_NAME"
    "$model_dir/$HUMAN_MODEL_NAME"
    "$manifest_path"
    "$attestation_path"
  )

  for path in "${directory_paths[@]}"; do
    [[ ! -L "$path" ]] || die "Project-local KataGo directory must not be a symbolic link: $path"
    if [[ -e "$path" && ! -d "$path" ]]; then
      die "Project-local KataGo directory path is not a directory: $path"
    fi
  done
  for path in "${artifact_paths[@]}"; do
    resolved="$(realpath -m -- "$path")"
    case "$resolved" in
      "$project_root"/*) ;;
      *) die "KataGo path resolves outside the project: $path -> $resolved" ;;
    esac
  done
}

assert_file_contains() {
  local path="$1"
  local expected="$2"
  grep -F -- "$expected" "$path" >/dev/null || die "$path does not contain required pin: $expected"
}

config_values() {
  local key="$1"
  awk -v wanted="$key" '
    {
      line = $0
      sub(/#.*/, "", line)
      equals = index(line, "=")
      if (equals == 0) next
      parsed_key = substr(line, 1, equals - 1)
      value = substr(line, equals + 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", parsed_key)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      if (parsed_key == wanted) print value
    }
  ' "$config_path"
}

assert_config_value() {
  local key="$1"
  local expected="$2"
  local -a values=()
  mapfile -t values < <(config_values "$key")
  ((${#values[@]} == 1)) || die "Expected exactly one active $key assignment in $config_path"
  [[ "${values[0]}" == "$expected" ]] || die "Unexpected $key=${values[0]} in $config_path; expected $expected"
}

verify_static_configuration() {
  [[ -f "$config_path" && ! -L "$config_path" ]] || die "Missing regular config file: $config_path"
  [[ -f "$setup_script" && ! -L "$setup_script" ]] || die "Missing regular setup script: $setup_script"
  [[ -f "$process_adapter" && ! -L "$process_adapter" ]] || die "Missing regular KataGo process adapter: $process_adapter"

  require_command stat
  require_command sha256sum
  local config_size config_sha256
  config_size="$(stat -c '%s' -- "$config_path")"
  config_sha256="$(sha256sum -- "$config_path" | awk '{print $1}')"
  [[ "$config_size" == "$CONFIG_SIZE" ]] || die "Config has size $config_size; expected $CONFIG_SIZE"
  [[ "${config_sha256,,}" == "${CONFIG_SHA256,,}" ]] || die "Config SHA-256 is $config_sha256; expected $CONFIG_SHA256"

  assert_config_value logDir ".local/runtime/katago/logs"
  assert_config_value logToStderr "true"
  assert_config_value logAllRequests "false"
  assert_config_value logAllResponses "false"
  assert_config_value reportAnalysisWinratesAs "BLACK"
  assert_config_value analysisPVLen "12"
  assert_config_value maxVisits "500"
  assert_config_value numAnalysisThreads "2"
  assert_config_value numSearchThreadsPerAnalysisThread "8"
  assert_config_value nnMaxBatchSize "16"
  assert_config_value numNNServerThreadsPerModel "1"
  assert_config_value maxBoardXSizeForNNBuffer "9"
  assert_config_value maxBoardYSizeForNNBuffer "9"
  assert_config_value requireMaxBoardSize "true"
  assert_config_value nnCacheSizePowerOfTwo "19"
  assert_config_value nnMutexPoolSizePowerOfTwo "16"
  assert_config_value nnRandomize "true"
  assert_config_value cudaDeviceToUse "0"
  assert_config_value cudaUseFP16 "auto"
  assert_config_value cudaUseNHWC "auto"

  assert_file_contains "$setup_script" "readonly KATAGO_REPOSITORY_URL=\"$KATAGO_REPOSITORY_URL\""
  assert_file_contains "$setup_script" "readonly KATAGO_VERSION=\"$KATAGO_VERSION\""
  assert_file_contains "$setup_script" "readonly KATAGO_COMMIT=\"$KATAGO_COMMIT\""
  assert_file_contains "$setup_script" "readonly MAIN_MODEL_NAME=\"$MAIN_MODEL_NAME\""
  assert_file_contains "$setup_script" "readonly MAIN_MODEL_URL=\"$MAIN_MODEL_URL\""
  assert_file_contains "$setup_script" "readonly MAIN_MODEL_SIZE=\"$MAIN_MODEL_SIZE\""
  assert_file_contains "$setup_script" "readonly MAIN_MODEL_MD5=\"$MAIN_MODEL_MD5\""
  assert_file_contains "$setup_script" "readonly MAIN_MODEL_SHA256=\"$MAIN_MODEL_SHA256\""
  assert_file_contains "$setup_script" "readonly HUMAN_MODEL_NAME=\"$HUMAN_MODEL_NAME\""
  assert_file_contains "$setup_script" "readonly HUMAN_MODEL_URL=\"$HUMAN_MODEL_URL\""
  assert_file_contains "$setup_script" "readonly HUMAN_MODEL_SIZE=\"$HUMAN_MODEL_SIZE\""
  assert_file_contains "$setup_script" "readonly HUMAN_MODEL_MD5=\"$HUMAN_MODEL_MD5\""
  assert_file_contains "$setup_script" "readonly HUMAN_MODEL_SHA256=\"$HUMAN_MODEL_SHA256\""
  assert_file_contains "$setup_script" "readonly CONFIG_SIZE=\"$CONFIG_SIZE\""
  assert_file_contains "$setup_script" "readonly CONFIG_SHA256=\"$CONFIG_SHA256\""
  assert_file_contains "$setup_script" "readonly ATTESTATION_SCHEMA=\"$ATTESTATION_SCHEMA\""
  assert_file_contains "$process_adapter" "KATAGO_ATTESTATION_SCHEMA = $ATTESTATION_SCHEMA"
  assert_file_contains "$process_adapter" "KATAGO_VERSION = \"$KATAGO_VERSION\""
  assert_file_contains "$process_adapter" "KATAGO_SOURCE_COMMIT = \"$KATAGO_COMMIT\""
  assert_file_contains "$process_adapter" "MAIN_MODEL_NAME = \"$MAIN_MODEL_NAME\""
  assert_file_contains "$process_adapter" "MAIN_MODEL_SIZE = 97_878_277"
  assert_file_contains "$process_adapter" "MAIN_MODEL_SHA256 = \"$MAIN_MODEL_SHA256\""
  assert_file_contains "$process_adapter" "HUMAN_MODEL_NAME = \"$HUMAN_MODEL_NAME\""
  assert_file_contains "$process_adapter" "HUMAN_MODEL_SIZE = 99_066_230"
  assert_file_contains "$process_adapter" "HUMAN_MODEL_SHA256 = \"$HUMAN_MODEL_SHA256\""
  assert_file_contains "$process_adapter" "CONFIG_SIZE = 1_451"
  assert_file_contains "$process_adapter" "CONFIG_SHA256 = \"$CONFIG_SHA256\""
  log "Static pins and 9x9 analysis configuration are exact"
}

verify_source_checkout() {
  require_command git
  [[ -d "$source_dir/.git" ]] || die "Missing KataGo source checkout: $source_dir"
  local commit remote
  commit="$(git -C "$source_dir" rev-parse HEAD 2>/dev/null)" || die "Cannot read source commit"
  remote="$(git -C "$source_dir" remote get-url origin 2>/dev/null)" || die "Cannot read source origin"
  [[ "$commit" == "$KATAGO_COMMIT" ]] || die "Source commit is $commit; expected $KATAGO_COMMIT"
  [[ "$remote" == "$KATAGO_REPOSITORY_URL" ]] || die "Source origin is $remote; expected $KATAGO_REPOSITORY_URL"
  [[ -z "$(git -C "$source_dir" status --porcelain --untracked-files=normal)" ]] || die "Source checkout contains local modifications or untracked files"
  log "Source checkout is pinned to $KATAGO_COMMIT"
}

verify_engine_binary() {
  [[ -x "$install_bin" && ! -L "$install_bin" ]] || die "Missing regular executable: $install_bin"
  local version_output
  version_output="$("$install_bin" version 2>&1)" || die "KataGo version command failed"
  [[ "$version_output" == *"$KATAGO_VERSION"* ]] || die "Unexpected KataGo version output: $version_output"
  log "Engine reports $KATAGO_VERSION"
}

verify_model() {
  local path="$1"
  local expected_size="$2"
  local expected_md5="$3"
  local expected_sha256="$4"
  [[ -f "$path" && ! -L "$path" ]] || die "Missing regular model file: $path"
  local actual_size actual_md5 actual_sha256
  actual_size="$(stat -c '%s' -- "$path")"
  actual_md5="$(md5sum -- "$path" | awk '{print $1}')"
  actual_sha256="$(sha256sum -- "$path" | awk '{print $1}')"
  [[ "$actual_size" == "$expected_size" ]] || die "$path has size $actual_size; expected $expected_size"
  [[ "${actual_md5,,}" == "${expected_md5,,}" ]] || die "$path has MD5 $actual_md5; expected $expected_md5"
  [[ "${actual_sha256,,}" == "${expected_sha256,,}" ]] || die "$path has SHA-256 $actual_sha256; expected $expected_sha256"
}

verify_models_and_manifest() {
  require_command stat
  require_command md5sum
  require_command sha256sum
  verify_model "$model_dir/$MAIN_MODEL_NAME" "$MAIN_MODEL_SIZE" "$MAIN_MODEL_MD5" "$MAIN_MODEL_SHA256"
  verify_model "$model_dir/$HUMAN_MODEL_NAME" "$HUMAN_MODEL_SIZE" "$HUMAN_MODEL_MD5" "$HUMAN_MODEL_SHA256"
  [[ -f "$manifest_path" && ! -L "$manifest_path" ]] || die "Missing regular SHA-256 manifest: $manifest_path"

  local manifest_names
  manifest_names="$(awk '{print $2}' "$manifest_path" | LC_ALL=C sort | paste -sd ' ' -)"
  [[ "$manifest_names" == "$HUMAN_MODEL_NAME $MAIN_MODEL_NAME" ]] || die "SHA-256 manifest must contain exactly the two pinned model basenames"
  (
    cd "$model_dir"
    sha256sum --check --strict --status "$(basename "$manifest_path")"
  ) || die "Local SHA-256 manifest verification failed"
  grep -Fxq "$MAIN_MODEL_SHA256  $MAIN_MODEL_NAME" "$manifest_path" || die "Main-model SHA-256 manifest pin is wrong"
  grep -Fxq "$HUMAN_MODEL_SHA256  $HUMAN_MODEL_NAME" "$manifest_path" || die "HumanSL SHA-256 manifest pin is wrong"
  log "Both models match exact size, MD5, pinned SHA-256, and manifest"
}

verify_install_attestation() {
  require_command python3
  [[ -f "$attestation_path" && ! -L "$attestation_path" ]] || die "Missing regular runtime attestation: $attestation_path"
  [[ -f "$install_bin" && ! -L "$install_bin" && -x "$install_bin" ]] || die "Missing regular executable: $install_bin"

  python3 - \
    "$attestation_path" \
    "$install_bin" \
    "$config_path" \
    "$model_dir/$MAIN_MODEL_NAME" \
    "$model_dir/$HUMAN_MODEL_NAME" \
    "$ATTESTATION_SCHEMA" \
    "$KATAGO_VERSION" \
    "$KATAGO_COMMIT" \
    "$CONFIG_SIZE" \
    "$CONFIG_SHA256" \
    "$MAIN_MODEL_SIZE" \
    "$MAIN_MODEL_SHA256" \
    "$HUMAN_MODEL_SIZE" \
    "$HUMAN_MODEL_SHA256" <<'PY'
import hashlib
import json
import os
import stat
import sys

(
    attestation_path,
    binary_path,
    config_path,
    main_path,
    human_path,
    schema,
    version,
    source_commit,
    config_size,
    config_sha256,
    main_size,
    main_sha256,
    human_size,
    human_sha256,
) = sys.argv[1:]


def fail(message: str) -> None:
    raise SystemExit(f"runtime attestation verification failed: {message}")


def regular_file(path: str, *, executable: bool = False) -> os.stat_result:
    try:
        result = os.lstat(path)
    except OSError as exc:
        fail(f"cannot stat {path}: {exc}")
    if not stat.S_ISREG(result.st_mode):
        fail(f"{path} is not a regular non-symbolic-link file")
    if executable and not os.access(path, os.X_OK, follow_symlinks=False):
        fail(f"{path} is not executable")
    return result


def sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


attestation_stat = regular_file(attestation_path)
if attestation_stat.st_size > 32 * 1024:
    fail("attestation exceeds 32 KiB")
try:
    with open(attestation_path, encoding="utf-8") as handle:
        payload = json.load(handle)
except (OSError, UnicodeError, json.JSONDecodeError) as exc:
    fail(f"cannot parse attestation: {exc}")

if not isinstance(payload, dict) or set(payload) != {
    "schema",
    "katago_version",
    "source_commit",
    "artifacts",
}:
    fail("unexpected top-level shape")
if payload["schema"] != int(schema):
    fail("schema does not match")
if payload["katago_version"] != version:
    fail("version does not match")
if payload["source_commit"] != source_commit:
    fail("source commit does not match")

expected = {
    "binary": (".local/bin/katago", binary_path, None, None, True),
    "config": (
        "config/katago-analysis-9x9.cfg",
        config_path,
        int(config_size),
        config_sha256,
        False,
    ),
    "main_model": (
        ".local/models/katago/kata9x9-b18c384nbt-20231025.bin.gz",
        main_path,
        int(main_size),
        main_sha256,
        False,
    ),
    "human_model": (
        ".local/models/katago/b18c384nbt-humanv0.bin.gz",
        human_path,
        int(human_size),
        human_sha256,
        False,
    ),
}
artifacts = payload["artifacts"]
if not isinstance(artifacts, dict) or set(artifacts) != set(expected):
    fail("unexpected artifact set")

for name, (relative_path, local_path, pinned_size, pinned_sha256, executable) in expected.items():
    entry = artifacts[name]
    if not isinstance(entry, dict) or set(entry) != {"path", "size", "sha256"}:
        fail(f"unexpected {name} entry shape")
    if entry["path"] != relative_path:
        fail(f"{name} path does not match")
    if type(entry["size"]) is not int or entry["size"] <= 0:
        fail(f"{name} size is invalid")
    if pinned_size is not None and entry["size"] != pinned_size:
        fail(f"{name} size pin does not match")
    if pinned_sha256 is not None and entry["sha256"] != pinned_sha256:
        fail(f"{name} SHA-256 pin does not match")
    result = regular_file(local_path, executable=executable)
    if result.st_size != entry["size"]:
        fail(f"{name} installed size no longer matches")
    if sha256(local_path) != entry["sha256"]:
        fail(f"{name} installed SHA-256 no longer matches")
PY
  log "Runtime attestation binds the exact binary, config, and model artifacts"
}

gpu_free_mib() {
  local gpu_index="$1"
  nvidia-smi --query-gpu=index,memory.free --format=csv,noheader,nounits |
    awk -F, -v wanted="$gpu_index" '
      {
        index_value = $1
        free_value = $2
        gsub(/[[:space:]]/, "", index_value)
        gsub(/[[:space:]]/, "", free_value)
        if (index_value == wanted) print free_value
      }
    '
}

run_smoke() {
  require_command nvidia-smi
  require_command python3

  local gpu_mask="${WEIQI_KATAGO_GPU:-1}"
  local min_free_mib="${WEIQI_KATAGO_MIN_FREE_MIB:-6144}"
  local timeout_seconds="${WEIQI_KATAGO_SMOKE_TIMEOUT_SECONDS:-120}"
  [[ "$gpu_mask" =~ ^[0-9]+$ ]] || die "WEIQI_KATAGO_GPU must be one physical GPU index"
  [[ "$min_free_mib" =~ ^[0-9]+$ ]] || die "WEIQI_KATAGO_MIN_FREE_MIB must be an integer"
  [[ "$timeout_seconds" =~ ^[0-9]+$ ]] || die "WEIQI_KATAGO_SMOKE_TIMEOUT_SECONDS must be an integer"
  ((min_free_mib >= 1024)) || die "WEIQI_KATAGO_MIN_FREE_MIB must be at least 1024"
  ((timeout_seconds >= 10 && timeout_seconds <= 600)) || die "Smoke timeout must be between 10 and 600 seconds"

  local free_mib
  free_mib="$(gpu_free_mib "$gpu_mask")"
  [[ "$free_mib" =~ ^[0-9]+$ ]] || die "Physical GPU $gpu_mask was not reported by nvidia-smi"
  ((free_mib >= min_free_mib)) || die "GPU $gpu_mask has ${free_mib} MiB free; smoke requires ${min_free_mib} MiB"
  log "GPU $gpu_mask preflight passed with ${free_mib} MiB free"

  CUDA_VISIBLE_DEVICES="$gpu_mask" python3 - \
    "$install_bin" \
    "$config_path" \
    "$model_dir/$MAIN_MODEL_NAME" \
    "$model_dir/$HUMAN_MODEL_NAME" \
    "$project_root" \
    "$timeout_seconds" <<'PY'
import json
import queue
import subprocess
import sys
import tempfile
import threading
import time

binary, config, main_model, human_model, project_root, timeout_text = sys.argv[1:]
timeout = int(timeout_text)
command = [
    binary,
    "analysis",
    "-config",
    config,
    "-model",
    main_model,
    "-human-model",
    human_model,
]


def fail(message: str) -> None:
    raise RuntimeError(message)


with tempfile.TemporaryFile(mode="w+t", encoding="utf-8") as stderr_file:
    process = subprocess.Popen(
        command,
        cwd=project_root,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=stderr_file,
        text=True,
        bufsize=1,
    )
    assert process.stdin is not None
    assert process.stdout is not None
    responses: queue.Queue[str | None] = queue.Queue()

    def read_stdout() -> None:
        for line in process.stdout:
            responses.put(line)
        responses.put(None)

    threading.Thread(target=read_stdout, daemon=True).start()

    def send(payload: dict) -> None:
        process.stdin.write(json.dumps(payload, separators=(",", ":")) + "\n")
        process.stdin.flush()

    def await_response(request_id: str) -> dict:
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                fail(f"timed out waiting for {request_id}")
            try:
                line = responses.get(timeout=remaining)
            except queue.Empty:
                fail(f"timed out waiting for {request_id}")
            if line is None:
                fail(f"KataGo exited before responding to {request_id}")
            try:
                response = json.loads(line)
            except json.JSONDecodeError:
                continue
            if response.get("error"):
                fail(f"KataGo error: {response['error']}")
            if response.get("id") == request_id and not response.get("isDuringSearch", False):
                return response

    try:
        send({"id": "verify-models", "action": "query_models"})
        model_response = await_response("verify-models")
        loaded_names = {str(item.get("name", "")).rsplit("/", 1)[-1] for item in model_response.get("models", [])}
        expected_names = {main_model.rsplit("/", 1)[-1], human_model.rsplit("/", 1)[-1]}
        if not expected_names.issubset(loaded_names):
            fail(f"query_models did not report both pinned models: {sorted(loaded_names)}")

        send(
            {
                "id": "verify-inference",
                "moves": [],
                "initialPlayer": "B",
                "rules": "chinese",
                "komi": 7.5,
                "boardXSize": 9,
                "boardYSize": 9,
                "maxVisits": 4,
                "analysisPVLen": 2,
                "includeOwnership": True,
                "includePolicy": True,
                "overrideSettings": {
                    "humanSLProfile": "rank_20k",
                    "ignorePreRootHistory": False,
                    "rootNumSymmetriesToSample": 1,
                },
            }
        )
        analysis = await_response("verify-inference")
        if not analysis.get("moveInfos"):
            fail("inference response has no moveInfos")
        if len(analysis.get("ownership", [])) != 81:
            fail("inference response does not contain 81-point ownership")
        if not analysis.get("humanPolicy"):
            fail("inference response does not contain HumanSL policy")
        if not analysis.get("rootInfo"):
            fail("inference response has no rootInfo")
        print("[verify-katago] GPU model-load and 4-visit HumanSL inference passed")
    except Exception:
        stderr_file.flush()
        stderr_file.seek(0)
        stderr_tail = stderr_file.read()[-6000:]
        if stderr_tail:
            print("KataGo stderr tail:\n" + stderr_tail, file=sys.stderr)
        raise
    finally:
        try:
            process.stdin.close()
        except Exception:
            pass
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
PY
}

main() {
  local static_only="false"
  local smoke="false"

  while (($# > 0)); do
    case "$1" in
      --static-only) static_only="true" ;;
      --smoke) smoke="true" ;;
      -h | --help)
        usage
        return 0
        ;;
      *)
        usage >&2
        die "Unknown option: $1"
        ;;
    esac
    shift
  done

  [[ "$static_only" != "true" || "$smoke" != "true" ]] || die "--static-only and --smoke cannot be combined"
  verify_static_configuration
  if [[ "$static_only" == "true" ]]; then
    log "Static verification passed; installed artifacts were intentionally not read"
    return 0
  fi

  assert_project_local_layout
  verify_source_checkout
  verify_models_and_manifest
  verify_install_attestation
  # The binary is executed only after its setup-recorded hash has been checked.
  verify_engine_binary
  if [[ "$smoke" == "true" ]]; then
    run_smoke
  fi
  log "Installed KataGo verification passed"
}

main "$@"
