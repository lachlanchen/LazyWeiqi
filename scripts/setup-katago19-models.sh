#!/usr/bin/env bash
set -euo pipefail

umask 077

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
model_dir="$project_root/.local/models/katago19"
manifest_path="$model_dir/installed-models.sha256"
lock_path="$model_dir/.download.lock"

readonly fast_name="b10c384h6nbttflrs.bin.gz"
readonly fast_url="https://github.com/lightvector/KataGo/releases/download/v1.17.1/$fast_name"
readonly fast_size="38245488"
readonly fast_sha256="0ba27eced5180b3e3d0b898b280c541112989765e789d1eb6cd0d31b2b2c1229"

readonly quality_name="b11c768h12nbt3tflrs-fson-silu.bin.gz"
readonly quality_url="https://github.com/lightvector/KataGo/releases/download/v1.17.1/$quality_name"
readonly quality_size="211660960"
readonly quality_sha256="1881600caab9e9d85a3dd6a019e9b8e7d2c237b5f984e13ed49a8645be3077c6"

temporary_paths=()
print_plan="false"

die() {
  echo "setup-katago19-models: $*" >&2
  exit 1
}

cleanup() {
  local path
  for path in "${temporary_paths[@]:-}"; do
    [[ -z "$path" || ! -e "$path" || -L "$path" ]] || rm -f -- "$path"
  done
}
trap cleanup EXIT

require_commands() {
  local command_name
  for command_name in "$@"; do
    command -v "$command_name" >/dev/null || die "missing prerequisite: $command_name"
  done
}

usage() {
  cat <<'EOF'
Usage: scripts/setup-katago19-models.sh [--print-plan]

With no arguments, download and verify both reviewed 19x19 KataGo networks
into the ignored project-local model directory. --print-plan performs no
writes or network requests and prints the exact destinations and pins.
EOF
}

show_plan() {
  printf '%s\n' \
    "19x19 KataGo model plan" \
    "Destination: $model_dir" \
    "Fast model: $fast_name" \
    "Fast URL: $fast_url" \
    "Fast bytes: $fast_size" \
    "Fast SHA-256: $fast_sha256" \
    "Quality model: $quality_name" \
    "Quality URL: $quality_url" \
    "Quality bytes: $quality_size" \
    "Quality SHA-256: $quality_sha256" \
    "Manifest: $manifest_path"
}

validate_directory() {
  local expected
  [[ ! -L "$project_root/.local" && ! -L "$project_root/.local/models" && ! -L "$model_dir" ]] ||
    die "model parent directories must not be symbolic links"
  mkdir -p -- "$model_dir"
  chmod 700 -- "$project_root/.local" "$project_root/.local/models" "$model_dir"
  expected="$(realpath -m -- "$project_root/.local/models/katago19")"
  [[ "$(realpath -e -- "$model_dir")" == "$expected" ]] ||
    die "model directory does not resolve to the project-local destination"
  [[ ! -L "$manifest_path" && ! -L "$lock_path" ]] ||
    die "model metadata paths must not be symbolic links"
}

verify_model() {
  local path="$1"
  local expected_size="$2"
  local expected_sha256="$3"
  local actual_sha256
  [[ -f "$path" && ! -L "$path" ]] || return 1
  [[ "$(stat -c %s -- "$path")" == "$expected_size" ]] || return 1
  actual_sha256="$(sha256sum -- "$path" | cut -d' ' -f1)"
  [[ "$actual_sha256" == "$expected_sha256" ]]
}

download_model() {
  local name="$1"
  local url="$2"
  local expected_size="$3"
  local expected_sha256="$4"
  local destination="$model_dir/$name"
  local staging

  [[ ! -L "$destination" ]] || die "refusing symbolic-link model destination: $name"
  if [[ -e "$destination" ]]; then
    verify_model "$destination" "$expected_size" "$expected_sha256" ||
      die "existing $name does not match the reviewed size and SHA-256; preserve or remove it explicitly before retrying"
    echo "Verified existing model: $name"
    return
  fi

  staging="$(mktemp "$model_dir/.${name}.part.XXXXXX")"
  temporary_paths+=("$staging")
  [[ -f "$staging" && ! -L "$staging" ]] || die "unsafe download staging path"
  chmod 600 -- "$staging"
  curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 \
    --max-filesize "$expected_size" \
    --retry 3 --retry-delay 2 --output "$staging" "$url"
  verify_model "$staging" "$expected_size" "$expected_sha256" ||
    die "downloaded $name failed the reviewed size/SHA-256 check"
  [[ ! -e "$destination" ]] || die "model destination appeared during installation"
  mv -- "$staging" "$destination"
  echo "Installed verified model: $name"
}

write_manifest() {
  local staging
  staging="$(mktemp "$model_dir/.installed-models.sha256.part.XXXXXX")"
  temporary_paths+=("$staging")
  printf '%s  %s\n%s  %s\n' \
    "$fast_sha256" "$fast_name" \
    "$quality_sha256" "$quality_name" >"$staging"
  chmod 600 -- "$staging"
  [[ ! -L "$manifest_path" ]] || die "manifest destination is a symbolic link"
  mv -- "$staging" "$manifest_path"
  (
    cd "$model_dir"
    sha256sum --check "$(basename "$manifest_path")"
  )
}

main() {
  while (($#)); do
    case "$1" in
      --print-plan) print_plan="true" ;;
      -h|--help) usage; return 0 ;;
      *) usage >&2; die "unknown argument: $1" ;;
    esac
    shift
  done
  if [[ "$print_plan" == "true" ]]; then
    show_plan
    return 0
  fi
  require_commands curl cut flock mktemp mv realpath sha256sum stat
  validate_directory
  exec 9>"$lock_path"
  chmod 600 -- "$lock_path"
  flock -n 9 || die "another 19x19 model installation is already running"
  download_model "$fast_name" "$fast_url" "$fast_size" "$fast_sha256"
  download_model "$quality_name" "$quality_url" "$quality_size" "$quality_sha256"
  write_manifest
  echo "Fast and quality 19x19 KataGo models are installed and verified."
  echo "Models remain private under: $model_dir"
}

main "$@"
