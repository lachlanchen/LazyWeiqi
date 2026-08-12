#!/usr/bin/env bash
set -euo pipefail

umask 077

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
model_dir="$project_root/.local/models/katago19"
config_path="$project_root/config/katago-analysis-19x19.cfg"
binary_path="$project_root/.local/bin/katago"
manifest_path="$model_dir/installed-models.sha256"

readonly fast_name="b10c384h6nbttflrs.bin.gz"
readonly fast_size="38245488"
readonly fast_sha256="0ba27eced5180b3e3d0b898b280c541112989765e789d1eb6cd0d31b2b2c1229"
readonly quality_name="b11c768h12nbt3tflrs-fson-silu.bin.gz"
readonly quality_size="211660960"
readonly quality_sha256="1881600caab9e9d85a3dd6a019e9b8e7d2c237b5f984e13ed49a8645be3077c6"
readonly config_size="1247"
readonly config_sha256="c6c4b5d9d3c1a1b572ac4eeb0a1ab1ab8a024995c8aacf03e5728d1e114b2305"

run_smoke="false"
static_only="false"

die() {
  echo "verify-katago19: $*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: scripts/verify-katago19.sh [--static-only | --smoke]

--static-only verifies the checked-in configuration and matching model/runtime
pins without requiring downloaded artifacts. Without arguments, also verify the
installed models and existing KataGo binary attestation. --smoke additionally
loads the fast and quality models sequentially and runs bounded 19x19
ownership/PV queries.
EOF
}

require_commands() {
  local command_name
  for command_name in "$@"; do
    command -v "$command_name" >/dev/null || die "missing prerequisite: $command_name"
  done
}

verify_regular_file() {
  local path="$1"
  local expected_size="$2"
  local expected_sha256="$3"
  [[ -f "$path" && ! -L "$path" ]] || die "missing regular non-symbolic-link file: $path"
  [[ "$(stat -c %s -- "$path")" == "$expected_size" ]] || die "wrong byte size: $path"
  [[ "$(sha256sum -- "$path" | cut -d' ' -f1)" == "$expected_sha256" ]] ||
    die "wrong SHA-256: $path"
}

require_source_pin() {
  local path="$1"
  local needle="$2"
  grep -Fq -- "$needle" "$path" || die "checked-in 19x19 pin drift: $path lacks $needle"
}

verify_checked_in() {
  [[ -f "$config_path" && ! -L "$config_path" ]] || die "unsafe or missing 19x19 config"
  verify_regular_file "$config_path" "$config_size" "$config_sha256"
  "$project_root/scripts/verify-katago.sh" --static-only

  local setup="$project_root/scripts/setup-katago19-models.sh"
  local runtime="$project_root/apps/api/weiqi/adapters/katago/full_board.py"
  local settings="$project_root/apps/api/weiqi/config.py"
  [[ -f "$setup" && ! -L "$setup" && -f "$runtime" && ! -L "$runtime" ]] ||
    die "19x19 setup/runtime sources must be regular files"
  require_source_pin "$setup" "$fast_name"
  require_source_pin "$setup" "$fast_size"
  require_source_pin "$setup" "$fast_sha256"
  require_source_pin "$setup" "$quality_name"
  require_source_pin "$setup" "$quality_size"
  require_source_pin "$setup" "$quality_sha256"
  require_source_pin "$runtime" "$fast_name"
  require_source_pin "$runtime" "$fast_sha256"
  require_source_pin "$runtime" "$quality_name"
  require_source_pin "$runtime" "$quality_sha256"
  require_source_pin "$runtime" "$config_sha256"
  require_source_pin "$settings" "$fast_name"
  require_source_pin "$settings" "$quality_name"
  echo "Checked-in fast/quality 19x19 configuration and pins verified."
}

verify_installed() {
  [[ -d "$model_dir" && ! -L "$model_dir" ]] || die "unsafe or missing model directory"
  [[ -x "$binary_path" && ! -L "$binary_path" ]] || die "verified KataGo binary is missing"
  "$project_root/scripts/verify-katago.sh"
  verify_regular_file "$model_dir/$fast_name" "$fast_size" "$fast_sha256"
  verify_regular_file "$model_dir/$quality_name" "$quality_size" "$quality_sha256"
  verify_regular_file "$config_path" "$config_size" "$config_sha256"
  [[ -f "$manifest_path" && ! -L "$manifest_path" ]] || die "19x19 model manifest is missing"
  [[ "$(wc -l <"$manifest_path")" == 2 ]] || die "19x19 manifest must contain exactly two entries"
  (
    cd "$model_dir"
    sha256sum --check "$(basename "$manifest_path")"
  )
  echo "Reviewed fast/quality 19x19 model identities and configuration verified."
}

smoke() {
  mkdir -p -- "$project_root/.local/runtime/katago19/logs"
  chmod 700 -- "$project_root/.local/runtime/katago19" \
    "$project_root/.local/runtime/katago19/logs"
  PROJECT_ROOT="$project_root" python3 - <<'PY'
from __future__ import annotations

import json
import os
import selectors
import subprocess
import time
from pathlib import Path

root = Path(os.environ["PROJECT_ROOT"])
profiles = (
    ("fast", "b10c384h6nbttflrs.bin.gz", 24),
    ("quality", "b11c768h12nbt3tflrs-fson-silu.bin.gz", 64),
)
rules = {
    "hasButton": False,
    "ko": "POSITIONAL",
    "scoring": "AREA",
    "suicide": False,
    "tax": "NONE",
    "whiteHandicapBonus": "0",
    "friendlyPassOk": True,
}
positions = (
    ("empty", [], "B"),
    (
        "opening",
        [["B", "D16"], ["W", "Q4"], ["B", "Q16"], ["W", "D4"],
         ["B", "C14"], ["W", "R6"], ["B", "C6"], ["W", "R14"]],
        "B",
    ),
)


def bounded_query(profile: str, model_name: str, visits: int) -> list[dict[str, object]]:
    model = root / ".local/models/katago19" / model_name
    command = [
        str(root / ".local/bin/katago"),
        "analysis",
        "-config",
        str(root / "config/katago-analysis-19x19.cfg"),
        "-model",
        str(model),
        "-quit-without-waiting",
    ]
    environment = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": os.environ.get("HOME", "/tmp"),
        "CUDA_VISIBLE_DEVICES": os.environ.get("WEIQI_KATAGO19_GPU", "1"),
        "LC_ALL": "C.UTF-8",
    }
    process = subprocess.Popen(
        command,
        cwd=root,
        env=environment,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        bufsize=0,
    )
    assert process.stdin is not None and process.stdout is not None and process.stderr is not None
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ, "stdout")
    selector.register(process.stderr, selectors.EVENT_READ, "stderr")
    stderr: list[str] = []
    results: list[dict[str, object]] = []
    try:
        for label, moves, player in positions:
            request_id = f"verify-{profile}-{label}"
            query = {
                "id": request_id,
                "moves": moves,
                "initialPlayer": moves[0][0] if moves else player,
                "rules": rules,
                "komi": 7.5,
                "boardXSize": 19,
                "boardYSize": 19,
                "maxVisits": visits,
                "analysisPVLen": 12,
                "includeOwnership": True,
                "includeOwnershipStdev": True,
                "includeMovesOwnership": True,
                "includeMovesOwnershipStdev": True,
                "includePolicy": True,
                "overrideSettings": {
                    "rootNumSymmetriesToSample": 2,
                    "ignorePreRootHistory": False,
                },
            }
            started = time.monotonic()
            process.stdin.write((json.dumps(query, separators=(",", ":")) + "\n").encode())
            process.stdin.flush()
            response = None
            deadline = started + 150
            while time.monotonic() < deadline and process.poll() is None and response is None:
                for key, _ in selector.select(timeout=0.5):
                    line = key.fileobj.readline()
                    if not line:
                        continue
                    if key.data == "stderr":
                        stderr = (stderr + [line.decode(errors="replace").strip()])[-80:]
                        continue
                    payload = json.loads(line)
                    if (
                        payload.get("id") == request_id
                        and not payload.get("isDuringSearch")
                        and isinstance(payload.get("rootInfo"), dict)
                    ):
                        response = payload
                        break
            if response is None:
                raise RuntimeError("KataGo returned no bounded response: " + "\n".join(stderr[-20:]))
            root_info = response["rootInfo"]
            move_infos = response.get("moveInfos")
            expected_player = "B" if len(moves) % 2 == 0 else "W"
            if root_info.get("currentPlayer") != expected_player:
                raise RuntimeError("KataGo returned the wrong side-to-move binding")
            if response.get("turnNumber") != len(moves):
                raise RuntimeError("KataGo returned the wrong history binding")
            if not isinstance(move_infos, list) or not move_infos:
                raise RuntimeError("KataGo returned no candidate moves")
            if len(response.get("ownership", [])) != 361:
                raise RuntimeError("KataGo returned an incomplete ownership field")
            if len(response.get("ownershipStdev", [])) != 361:
                raise RuntimeError("KataGo returned an incomplete ownership-variation field")
            if len(response.get("policy", [])) != 362:
                raise RuntimeError("KataGo returned an incomplete policy field")
            top = move_infos[0]
            if not isinstance(top.get("pv"), list) or not top["pv"]:
                raise RuntimeError("KataGo returned no principal variation")
            results.append(
                {
                    "position": label,
                    "seconds": round(time.monotonic() - started, 3),
                    "visits": root_info.get("visits"),
                    "top_move": top.get("move"),
                    "pv": top.get("pv", [])[:6],
                }
            )
    finally:
        process.terminate()
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
    return results


report = {profile: bounded_query(profile, model, visits) for profile, model, visits in profiles}
print(json.dumps(report, indent=2))
PY
  echo "Sequential fast/quality 19x19 GPU smoke passed."
}

while (($#)); do
  case "$1" in
    --smoke) run_smoke="true" ;;
    --static-only) static_only="true" ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown argument: $1" ;;
  esac
  shift
done

[[ "$static_only" != "true" || "$run_smoke" != "true" ]] ||
  die "--static-only and --smoke are mutually exclusive"
require_commands cut grep sha256sum stat wc
verify_checked_in
if [[ "$static_only" == "true" ]]; then
  exit 0
fi
verify_installed
if [[ "$run_smoke" == "true" ]]; then
  require_commands python3 nvidia-smi
  [[ -n "${WEIQI_KATAGO19_GPU:-}" ]] ||
    die "--smoke requires an explicit WEIQI_KATAGO19_GPU physical device"
  [[ "$WEIQI_KATAGO19_GPU" =~ ^[0-9]+$ ]] ||
    die "WEIQI_KATAGO19_GPU must be a non-negative integer"
  nvidia-smi --query-gpu=index --format=csv,noheader,nounits | \
    grep -Fxq -- "$WEIQI_KATAGO19_GPU" ||
    die "WEIQI_KATAGO19_GPU does not identify an available physical GPU"
  smoke
fi
