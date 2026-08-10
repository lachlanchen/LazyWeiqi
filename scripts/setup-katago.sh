#!/usr/bin/env bash
set -Eeuo pipefail

umask 022

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
readonly build_dir="$local_root/build/katago-$KATAGO_VERSION-cuda"
readonly install_bin="$local_root/bin/katago"
readonly model_dir="$local_root/models/katago"
readonly manifest_path="$model_dir/installed-models.sha256"
readonly config_path="$project_root/config/$CONFIG_NAME"
readonly attestation_path="$local_root/katago-install-attestation.json"
readonly runtime_log_dir="$local_root/runtime/katago/logs"
readonly setup_lock_path="$local_root/.katago-setup.lock"

log() {
  printf '[setup-katago] %s\n' "$*"
}

die() {
  printf '[setup-katago] ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: scripts/setup-katago.sh [options]

Build the pinned KataGo CUDA engine and download the two pinned 9x9 teaching
models into ignored .local directories.

Options:
  --skip-build       Do not clone or build; verify the existing pinned engine.
  --skip-models      Do not download; verify the existing pinned models.
  --attest-existing  Verify an existing complete installation and atomically
                     add/refresh its runtime attestation; no build or download.
  --replace-invalid  Preserve and replace an existing model that fails checks.
  --print-plan       Print all pinned sources and destination paths, then exit.
  -h, --help         Show this help.

Environment:
  WEIQI_PROJECT_ROOT       Test/deployment project-root override.
  WEIQI_CMAKE_BIN          CMake executable (default: /usr/bin/cmake).
  WEIQI_KATAGO_BUILD_JOBS  Parallel build jobs (default: 8, range: 1-64).
  WEIQI_KATAGO_GPU         Physical GPU mask used by runtime scripts (default: 1).

The script never installs system packages and never modifies an existing source
checkout. Interrupted downloads remain as *.part and are never promoted until
their exact byte size, upstream MD5, and pinned SHA-256 all pass.
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
    "$local_root/build"
    "$build_dir"
    "$local_root/bin"
    "$local_root/models"
    "$model_dir"
    "$local_root/runtime"
    "$local_root/runtime/katago"
    "$runtime_log_dir"
  )
  local -a artifact_paths=(
    "$source_dir"
    "$build_dir"
    "$install_bin"
    "$model_dir/$MAIN_MODEL_NAME"
    "$model_dir/$HUMAN_MODEL_NAME"
    "$manifest_path"
    "$attestation_path"
    "$runtime_log_dir"
    "$setup_lock_path"
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

acquire_setup_lock() {
  require_command flock
  assert_project_local_layout
  mkdir -p -- "$local_root"
  [[ -d "$local_root" ]] || die "Local install root is not a directory: $local_root"
  [[ ! -L "$setup_lock_path" ]] || die "Setup lock must not be a symbolic link"
  exec 9>"$setup_lock_path"
  chmod 0600 -- "$setup_lock_path"
  flock -n 9 || die "Another KataGo setup is already running for this project"
}

artifact_is_valid() {
  local path="$1"
  local expected_size="$2"
  local expected_md5="$3"
  local expected_sha256="$4"
  local actual_size actual_md5 actual_sha256

  [[ -f "$path" && ! -L "$path" ]] || return 1
  actual_size="$(stat -c '%s' -- "$path" 2>/dev/null)" || return 1
  [[ "$actual_size" == "$expected_size" ]] || return 1
  actual_md5="$(md5sum -- "$path" | awk '{print $1}')" || return 1
  [[ "${actual_md5,,}" == "${expected_md5,,}" ]] || return 1
  actual_sha256="$(sha256sum -- "$path" | awk '{print $1}')" || return 1
  [[ "${actual_sha256,,}" == "${expected_sha256,,}" ]]
}

verify_artifact() {
  local path="$1"
  local expected_size="$2"
  local expected_md5="$3"
  local expected_sha256="$4"

  if ! artifact_is_valid "$path" "$expected_size" "$expected_md5" "$expected_sha256"; then
    local actual_size="missing"
    local actual_md5="missing"
    local actual_sha256="missing"
    if [[ -f "$path" && ! -L "$path" ]]; then
      actual_size="$(stat -c '%s' -- "$path" 2>/dev/null || printf 'unreadable')"
      actual_md5="$(md5sum -- "$path" 2>/dev/null | awk '{print $1}' || printf 'unreadable')"
      actual_sha256="$(sha256sum -- "$path" 2>/dev/null | awk '{print $1}' || printf 'unreadable')"
    fi
    die "Artifact verification failed for $path (size $actual_size, md5 $actual_md5, sha256 $actual_sha256; expected size $expected_size, md5 $expected_md5, sha256 $expected_sha256)"
  fi
}

promote_verified_artifact() {
  local part_path="$1"
  local destination="$2"
  local expected_size="$3"
  local expected_md5="$4"
  local expected_sha256="$5"

  [[ ! -e "$destination" && ! -L "$destination" ]] || die "Refusing to overwrite existing destination: $destination"
  verify_artifact "$part_path" "$expected_size" "$expected_md5" "$expected_sha256"
  chmod 0644 -- "$part_path"
  mv -- "$part_path" "$destination"
  verify_artifact "$destination" "$expected_size" "$expected_md5" "$expected_sha256"
}

download_artifact() {
  local name="$1"
  local url="$2"
  local expected_size="$3"
  local expected_md5="$4"
  local expected_sha256="$5"
  local replace_invalid="$6"
  local destination="$model_dir/$name"
  local part_path="$destination.part"

  if artifact_is_valid "$destination" "$expected_size" "$expected_md5" "$expected_sha256"; then
    log "Verified existing model: $name"
    return 0
  fi

  if [[ -e "$destination" || -L "$destination" ]]; then
    [[ "$replace_invalid" == "true" ]] || die "Existing model is invalid: $destination (rerun with --replace-invalid to preserve and replace it)"
    [[ ! -L "$destination" ]] || die "Refusing to replace a symbolic-link model path: $destination"
    local backup_path="$destination.invalid.$(date -u +%Y%m%dT%H%M%SZ).$$"
    mv -- "$destination" "$backup_path"
    log "Preserved invalid model as: $backup_path"
  fi

  [[ ! -L "$part_path" ]] || die "Refusing to write through symbolic link: $part_path"
  log "Downloading $name ($expected_size bytes)"
  curl \
    --proto '=https' \
    --proto-redir '=https' \
    --tlsv1.2 \
    --location \
    --fail \
    --show-error \
    --silent \
    --retry 5 \
    --retry-all-errors \
    --connect-timeout 30 \
    --max-filesize "$expected_size" \
    --output "$part_path" \
    "$url" || die "Download failed; final artifact was not changed (partial path: $part_path)"

  promote_verified_artifact "$part_path" "$destination" "$expected_size" "$expected_md5" "$expected_sha256"
  log "Installed verified model: $destination"
}

source_checkout_is_valid() {
  [[ -d "$source_dir/.git" ]] || return 1
  [[ "$(git -C "$source_dir" rev-parse HEAD 2>/dev/null)" == "$KATAGO_COMMIT" ]] || return 1
  [[ "$(git -C "$source_dir" remote get-url origin 2>/dev/null)" == "$KATAGO_REPOSITORY_URL" ]] || return 1
  [[ -z "$(git -C "$source_dir" status --porcelain --untracked-files=normal 2>/dev/null)" ]]
}

ensure_source_checkout() {
  mkdir -p -- "$(dirname "$source_dir")"

  if source_checkout_is_valid; then
    log "Verified existing source checkout at $KATAGO_COMMIT"
    return 0
  fi

  if [[ -e "$source_dir" || -L "$source_dir" ]]; then
    die "Source path exists but is not the pinned checkout: $source_dir"
  fi

  local temporary_checkout
  temporary_checkout="$(mktemp -d "$(dirname "$source_dir")/.KataGo-$KATAGO_VERSION.part.XXXXXX")"
  log "Cloning KataGo $KATAGO_VERSION into a temporary directory"
  git clone \
    --filter=blob:none \
    --depth 1 \
    --branch "$KATAGO_VERSION" \
    "$KATAGO_REPOSITORY_URL" \
    "$temporary_checkout" || die "Git clone failed; temporary checkout retained at $temporary_checkout"

  local cloned_commit
  cloned_commit="$(git -C "$temporary_checkout" rev-parse HEAD)"
  [[ "$cloned_commit" == "$KATAGO_COMMIT" ]] || die "Tag resolved to unexpected commit $cloned_commit; expected $KATAGO_COMMIT"
  mv -- "$temporary_checkout" "$source_dir"
  source_checkout_is_valid || die "Pinned source verification failed after promotion"
}

resolve_cmake() {
  local requested="${WEIQI_CMAKE_BIN:-/usr/bin/cmake}"
  if [[ "$requested" == */* ]]; then
    [[ -x "$requested" ]] || die "CMake executable is unavailable: $requested"
    printf '%s\n' "$requested"
  else
    command -v "$requested" || die "CMake executable is unavailable: $requested"
  fi
}

verify_version_output() {
  local binary="$1"
  local output
  output="$("$binary" version 2>&1)" || die "KataGo version command failed: $binary"
  [[ "$output" == *"$KATAGO_VERSION"* ]] || die "Unexpected KataGo version output: $output"
}

build_engine() {
  local build_jobs="${WEIQI_KATAGO_BUILD_JOBS:-8}"
  [[ "$build_jobs" =~ ^[0-9]+$ ]] || die "WEIQI_KATAGO_BUILD_JOBS must be an integer"
  ((build_jobs >= 1 && build_jobs <= 64)) || die "WEIQI_KATAGO_BUILD_JOBS must be between 1 and 64"

  require_command git
  require_command nvcc
  require_command g++
  local cmake_bin
  cmake_bin="$(resolve_cmake)"

  ensure_source_checkout
  mkdir -p -- "$build_dir" "$(dirname "$install_bin")"

  log "Configuring the pinned CUDA build"
  "$cmake_bin" \
    -S "$source_dir/cpp" \
    -B "$build_dir" \
    -DUSE_BACKEND=CUDA \
    -DBUILD_DISTRIBUTED=0 \
    -DCMAKE_BUILD_TYPE=Release

  log "Building KataGo with $build_jobs parallel jobs"
  "$cmake_bin" --build "$build_dir" --parallel "$build_jobs"
  [[ -x "$build_dir/katago" ]] || die "Build completed without producing $build_dir/katago"
  verify_version_output "$build_dir/katago"

  local install_part="$install_bin.part.$$"
  [[ ! -L "$install_part" ]] || die "Refusing to write through symbolic link: $install_part"
  install -m 0755 -- "$build_dir/katago" "$install_part"
  mv -f -- "$install_part" "$install_bin"
  verify_version_output "$install_bin"
  log "Installed KataGo $KATAGO_VERSION: $install_bin"
}

write_local_sha256_manifest() {
  verify_artifact "$model_dir/$MAIN_MODEL_NAME" "$MAIN_MODEL_SIZE" "$MAIN_MODEL_MD5" "$MAIN_MODEL_SHA256"
  verify_artifact "$model_dir/$HUMAN_MODEL_NAME" "$HUMAN_MODEL_SIZE" "$HUMAN_MODEL_MD5" "$HUMAN_MODEL_SHA256"

  local manifest_part
  manifest_part="$(mktemp "$model_dir/.installed-models.sha256.part.XXXXXX")"
  (
    cd "$model_dir"
    printf '%s  %s\n' "$MAIN_MODEL_SHA256" "$MAIN_MODEL_NAME"
    printf '%s  %s\n' "$HUMAN_MODEL_SHA256" "$HUMAN_MODEL_NAME"
  ) >"$manifest_part"
  chmod 0644 -- "$manifest_part"
  mv -f -- "$manifest_part" "$manifest_path"
  log "Wrote local SHA-256 manifest: $manifest_path"
}

install_models() {
  local replace_invalid="$1"
  require_command curl
  require_command stat
  require_command md5sum
  require_command sha256sum
  mkdir -p -- "$model_dir"

  download_artifact "$MAIN_MODEL_NAME" "$MAIN_MODEL_URL" "$MAIN_MODEL_SIZE" "$MAIN_MODEL_MD5" "$MAIN_MODEL_SHA256" "$replace_invalid"
  download_artifact "$HUMAN_MODEL_NAME" "$HUMAN_MODEL_URL" "$HUMAN_MODEL_SIZE" "$HUMAN_MODEL_MD5" "$HUMAN_MODEL_SHA256" "$replace_invalid"
  write_local_sha256_manifest
}

verify_exact_config() {
  [[ -f "$config_path" && ! -L "$config_path" ]] || die "Missing regular config file: $config_path"
  local actual_size actual_sha256
  actual_size="$(stat -c '%s' -- "$config_path")"
  actual_sha256="$(sha256sum -- "$config_path" | awk '{print $1}')"
  [[ "$actual_size" == "$CONFIG_SIZE" ]] || die "Config has size $actual_size; expected $CONFIG_SIZE"
  [[ "${actual_sha256,,}" == "${CONFIG_SHA256,,}" ]] || die "Config SHA-256 is $actual_sha256; expected $CONFIG_SHA256"
}

verify_exact_manifest() {
  [[ -f "$manifest_path" && ! -L "$manifest_path" ]] || die "Missing regular model manifest: $manifest_path"
  local manifest_names
  manifest_names="$(awk '{print $2}' "$manifest_path" | LC_ALL=C sort | paste -sd ' ' -)"
  [[ "$manifest_names" == "$HUMAN_MODEL_NAME $MAIN_MODEL_NAME" ]] || die "Model manifest must contain exactly the two pinned basenames"
  grep -Fxq "$MAIN_MODEL_SHA256  $MAIN_MODEL_NAME" "$manifest_path" || die "Main-model manifest pin is wrong"
  grep -Fxq "$HUMAN_MODEL_SHA256  $HUMAN_MODEL_NAME" "$manifest_path" || die "HumanSL manifest pin is wrong"
  (
    cd "$model_dir"
    sha256sum --check --strict --status "$(basename "$manifest_path")"
  ) || die "Model manifest verification failed"
}

write_install_attestation() {
  local binary_size binary_sha256 attestation_part
  if [[ -e "$attestation_path" || -L "$attestation_path" ]]; then
    [[ -f "$attestation_path" && ! -L "$attestation_path" ]] || die "Refusing to replace a non-regular or symbolic-link attestation path: $attestation_path"
  fi
  binary_size="$(stat -c '%s' -- "$install_bin")"
  binary_sha256="$(sha256sum -- "$install_bin" | awk '{print $1}')"
  [[ "$binary_size" =~ ^[0-9]+$ && "$binary_size" -gt 0 ]] || die "Installed binary has an invalid size"
  [[ "$binary_sha256" =~ ^[0-9a-f]{64}$ ]] || die "Installed binary has an invalid SHA-256"

  attestation_part="$(mktemp "$local_root/.katago-install-attestation.json.part.XXXXXX")"
  python3 - \
    "$attestation_part" \
    "$ATTESTATION_SCHEMA" \
    "$KATAGO_VERSION" \
    "$KATAGO_COMMIT" \
    "$binary_size" \
    "$binary_sha256" \
    "$CONFIG_SIZE" \
    "$CONFIG_SHA256" \
    "$MAIN_MODEL_SIZE" \
    "$MAIN_MODEL_SHA256" \
    "$HUMAN_MODEL_SIZE" \
    "$HUMAN_MODEL_SHA256" <<'PY'
import json
import sys

(
    destination,
    schema,
    version,
    source_commit,
    binary_size,
    binary_sha256,
    config_size,
    config_sha256,
    main_size,
    main_sha256,
    human_size,
    human_sha256,
) = sys.argv[1:]

payload = {
    "schema": int(schema),
    "katago_version": version,
    "source_commit": source_commit,
    "artifacts": {
        "binary": {
            "path": ".local/bin/katago",
            "size": int(binary_size),
            "sha256": binary_sha256,
        },
        "config": {
            "path": "config/katago-analysis-9x9.cfg",
            "size": int(config_size),
            "sha256": config_sha256,
        },
        "main_model": {
            "path": ".local/models/katago/kata9x9-b18c384nbt-20231025.bin.gz",
            "size": int(main_size),
            "sha256": main_sha256,
        },
        "human_model": {
            "path": ".local/models/katago/b18c384nbt-humanv0.bin.gz",
            "size": int(human_size),
            "sha256": human_sha256,
        },
    },
}
with open(destination, "w", encoding="utf-8", newline="\n") as handle:
    json.dump(payload, handle, indent=2, sort_keys=True)
    handle.write("\n")
PY
  chmod 0644 -- "$attestation_part"
  mv -f -- "$attestation_part" "$attestation_path"
  log "Wrote verified runtime attestation: $attestation_path"
}

verify_complete_installation_and_attest() {
  require_command git
  require_command stat
  require_command md5sum
  require_command sha256sum
  require_command python3

  source_checkout_is_valid || die "Source checkout is not the clean pinned $KATAGO_COMMIT checkout"
  [[ -f "$install_bin" && ! -L "$install_bin" && -x "$install_bin" ]] || die "Missing regular executable: $install_bin"
  verify_version_output "$install_bin"
  verify_exact_config
  verify_artifact "$model_dir/$MAIN_MODEL_NAME" "$MAIN_MODEL_SIZE" "$MAIN_MODEL_MD5" "$MAIN_MODEL_SHA256"
  verify_artifact "$model_dir/$HUMAN_MODEL_NAME" "$HUMAN_MODEL_SIZE" "$HUMAN_MODEL_MD5" "$HUMAN_MODEL_SHA256"
  write_local_sha256_manifest
  verify_exact_manifest
  write_install_attestation
}

print_plan() {
  cat <<EOF
KataGo repository: $KATAGO_REPOSITORY_URL
KataGo version:    $KATAGO_VERSION
KataGo commit:     $KATAGO_COMMIT
Source path:       $source_dir
Build path:        $build_dir
Installed binary:  $install_bin
Analysis config:   $config_path
Config size:       $CONFIG_SIZE
Config SHA256:     $CONFIG_SHA256
Runtime GPU mask:  ${WEIQI_KATAGO_GPU:-1}

Main 9x9 model:
  URL:  $MAIN_MODEL_URL
  Path: $model_dir/$MAIN_MODEL_NAME
  Size: $MAIN_MODEL_SIZE
  MD5:  $MAIN_MODEL_MD5
  SHA256: $MAIN_MODEL_SHA256

HumanSL model:
  URL:  $HUMAN_MODEL_URL
  Path: $model_dir/$HUMAN_MODEL_NAME
  Size: $HUMAN_MODEL_SIZE
  MD5:  $HUMAN_MODEL_MD5
  SHA256: $HUMAN_MODEL_SHA256

Local SHA-256 manifest: $manifest_path
Runtime attestation:    $attestation_path
EOF
}

main() {
  local skip_build="false"
  local skip_models="false"
  local replace_invalid="false"
  local print_only="false"
  local attest_existing="false"

  while (($# > 0)); do
    case "$1" in
      --skip-build) skip_build="true" ;;
      --skip-models) skip_models="true" ;;
      --attest-existing) attest_existing="true" ;;
      --replace-invalid) replace_invalid="true" ;;
      --print-plan) print_only="true" ;;
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

  if [[ "$print_only" == "true" ]]; then
    print_plan
    return 0
  fi
  # Every path below can write the install tree (including refreshing the
  # attestation/manifest), so serialize it before doing any verification or
  # mutation. The read-only plan path intentionally remains lock-free.
  assert_project_local_layout
  acquire_setup_lock
  if [[ "$attest_existing" == "true" ]]; then
    [[ "$skip_build" == "false" && "$skip_models" == "false" && "$replace_invalid" == "false" ]] || die "--attest-existing cannot be combined with build/model options"
    install -d -m 0700 -- "$runtime_log_dir"
    verify_complete_installation_and_attest
    log "Existing installation attestation refreshed without a build or download."
    return 0
  fi
  [[ "$skip_build" != "true" || "$skip_models" != "true" ]] || die "Both build and model installation were skipped"

  install -d -m 0700 -- "$runtime_log_dir"

  if [[ "$skip_build" != "true" ]]; then
    build_engine
  fi
  if [[ "$skip_models" != "true" ]]; then
    install_models "$replace_invalid"
  fi

  verify_complete_installation_and_attest

  log "Setup complete. Run scripts/verify-katago.sh for installed checks."
  log "An explicit scripts/verify-katago.sh --smoke performs the optional GPU inference check."
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
