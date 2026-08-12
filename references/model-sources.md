# KataGo engine and model provenance

Last verified against upstream primary sources: 2026-08-10.

This project deliberately separates three roles:

1. KataGo is the rules-aware evaluator and source of quantitative board evidence.
2. HumanSL models rank/style and supplies likely human candidate moves.
3. The companion LLM explains engine-grounded evidence in learner-friendly language.

The companion is not the engine and is not a player. It must select and discuss
only legal candidates supplied by the game rules and KataGo analysis. HumanSL may
give a player-agent an explicit rank/style, but an LLM must never invent a move,
score, ownership claim, principal variation, or tactical conclusion and present it
as engine output.

“Energy” remains a teaching metaphor, never a single engine metric. Explanations
must keep exact groups/liberties, tactical variations, estimated ownership, and
narrative language as separately labeled facets. Ordinary lessons use the app's
declared Chinese area rules with positional superko; experimental rule variants
must be identified before analysis.

## Pinned engine

- Repository: <https://github.com/lightvector/KataGo>
- Release: [`v1.17.2`](https://github.com/lightvector/KataGo/releases/tag/v1.17.2)
- Commit: `6a1fc5de9fc253723ac475a0683bf0b9d9b7bd19`
- Build backend: CUDA from source, `BUILD_DISTRIBUTED=0`
- Compile instructions: <https://github.com/lightvector/KataGo/blob/v1.17.2/Compiling.md>
- Engine license: the project's MIT-style license, with separately licensed
  vendored components documented upstream:
  <https://github.com/lightvector/KataGo/blob/v1.17.2/LICENSE>

The workstation has a CUDA 13.0 toolkit and cuDNN 9.23.1. The pinned source build
uses those existing libraries. The initial setup does not install TensorRT or
replace any system CUDA component.

KataGo `v1.17.2` is the current release, but upstream only publishes TensorRT
binaries for that bug-fix release. Building the tag's CUDA backend gives an exact
engine pin without introducing a mismatched CUDA 13.2/TensorRT 10.16.1 runtime.

## Pinned teaching networks

| Purpose | Upstream artifact | Bytes | Upstream object MD5 | Repository-pinned SHA-256 |
| --- | --- | ---: | --- | --- |
| Dedicated 9x9 evaluator | [`kata9x9-b18c384nbt-20231025.bin.gz`](https://media.katagotraining.org/uploaded/networks/models_extra/kata9x9-b18c384nbt-20231025.bin.gz) | `97,878,277` | `586322e0f1715b3718361cfadea481f6` | `a1298ce1adc1dad7bd868ca962b2384cc8388ed373a00e6bae1114fa6f9e2d61` |
| Human rank/style policy | [`b18c384nbt-humanv0.bin.gz`](https://media.katagotraining.org/uploaded/networks/models_extra/b18c384nbt-humanv0.bin.gz) | `99,066,230` | `dc7ce241411b05ef2a5416d6406313a4` | `637746e44f0efe00ad1245a50aa9bbf0716efe364c43965ead97bd6835d84ab5` |

The [official extra-network catalog](https://katagotraining.org/extra_networks/)
describes the dedicated 9x9 network as likely one of the strongest KataGo networks
for 9x9, even relative to more recent general networks. It describes HumanSL as a
model trained from human games to predict play across ranks and historical styles.

The dedicated evaluator is hard-gated to exactly 9×9 in the game service. The
introductory 5×5 and 7×7 scenes deliberately stay on deterministic legality,
liberties, authored theory, and the clearly labeled teaching-presence field.
They do not query this network, because upstream warns that the specialized net
should not be expected to play other board sizes well.

The official network files are covered by the upstream
[neural-network license](https://katagotraining.org/network_license/), an
MIT-style permission notice. Preserve its copyright and permission notice when
redistributing a network.

The two older storage objects expose byte length, CRC32C, and MD5 through the
official Google Cloud Storage response headers, but no upstream SHA-256. This
repository independently pins the measured SHA-256 values above. Setup verifies
byte length, upstream MD5, and repository-pinned SHA-256 before atomically moving
each `*.part` file, then writes an exact local manifest for later checks. Models,
source, builds, logs, and the generated manifest live under `.local/` and must not
be committed.

## Why HumanSL is a teaching dependency

The pinned [analysis-engine documentation](https://github.com/lightvector/KataGo/blob/v1.17.2/docs/Analysis_Engine.md)
supports these modern profiles:

- `rank_20k` through `rank_9d`
- different Black and White ranks such as `rank_15k_5k`
- pre-AlphaZero styles `preaz_20k` through `preaz_9d`
- historical professional styles `proyear_1800` through `proyear_2023`

For a beginning learner, request `includePolicy: true` with
`humanSLProfile: rank_20k` and `ignorePreRootHistory: false`. HumanSL returns the
moves such a learner is likely to see. The main 9x9 model remains authoritative
for evaluation; HumanSL is not used as the sole score or win-rate model.

For candidate teaching, one bounded Analysis Engine request asks for root and
per-move ownership plus searched-continuation variation
(`includeMovesOwnership` and `includeMovesOwnershipStdev`). Every map must have
exactly 81 finite bounded cells or it is omitted. `scoreLead`, win rate, and
ownership remain Black-perspective; the UI labels that invariant and separately
converts candidate differences into the mover's perspective. A principal
variation is replayed through the deterministic rules and truncated at the first
illegal move before it is shown.

A useful review query also sets:

```json
{
  "includeOwnership": true,
  "includePolicy": true,
  "overrideSettings": {
    "humanSLProfile": "rank_20k",
    "ignorePreRootHistory": false,
    "humanSLRootExploreProbWeightless": 0.5,
    "humanSLCpuctPermanent": 2.0
  }
}
```

This spends search effort on likely human moves without allowing those exploratory
visits to bias KataGo's main evaluation. The companion can then explain differences
among legal, actually analyzed candidates.

## Runtime and GPU isolation

The checked-in configuration is
[`config/katago-analysis-9x9.cfg`](../config/katago-analysis-9x9.cfg). It uses:

- exact 9x9 neural-network buffers;
- one logical CUDA device;
- a batch of 16 and 16 total search threads;
- bounded caches suitable for a workstation shared with LocalLLM;
- a stable Black analysis perspective to avoid sign changes between turns.

Runtime defaults to physical GPU 1:

```bash
WEIQI_KATAGO_GPU=1 CUDA_VISIBLE_DEVICES=1 .local/bin/katago analysis \
  -config config/katago-analysis-9x9.cfg \
  -model .local/models/katago/kata9x9-b18c384nbt-20231025.bin.gz \
  -human-model .local/models/katago/b18c384nbt-humanv0.bin.gz
```

Because CUDA exposes the masked physical GPU as logical device 0, the KataGo
configuration correctly uses `cudaDeviceToUse = 0`. Do not combine a physical
index in the config with `CUDA_VISIBLE_DEVICES`; that can select the wrong device.

The optional smoke verifier requires at least 6,144 MiB free by default and exits
before launching when the reserve is unavailable. It never stops or evicts other
GPU processes.

## Reproducible setup and checks

Print the complete plan without writing or downloading:

```bash
scripts/setup-katago.sh --print-plan
```

Perform the source build and model download:

```bash
scripts/setup-katago.sh
```

Setup writes `.local/katago-install-attestation.json` only after it has verified
the clean pinned source checkout, executable/version, exact config, both model
sizes and hashes, and the two-entry model manifest. Runtime availability checks
the attested binary/config hashes plus the repository-pinned model identities;
unchanged file-stat signatures reuse the result, so routine status polling does
not repeatedly hash roughly 200 MB of networks or execute the binary. To upgrade
an already-installed workstation from the earlier un-attested layout without a
build or download, run:

```bash
scripts/setup-katago.sh --attest-existing
```

Static pins/configuration can be checked in CI without installed artifacts:

```bash
scripts/verify-katago.sh --static-only
```

After setup, verify the clean pinned source checkout, attested binary/config,
engine version, model size/MD5, and repository-pinned SHA-256:

```bash
scripts/verify-katago.sh
```

GPU loading and a bounded four-visit 9x9 HumanSL inference are deliberately opt-in:

```bash
WEIQI_KATAGO_GPU=1 scripts/verify-katago.sh --smoke
```

## Pinned ordinary 19x19 networks

Ordinary 19×19 games use a separate, serialized engine lane. They never reuse or
silently replace the specialized beginner 9×9 evaluator. Both general networks
come from KataGo's official [`v1.17.1` release](https://github.com/lightvector/KataGo/releases/tag/v1.17.1),
whose release notes describe the small transformer as stronger per visit than the
strongest b18 main-run network and the larger transformer as stronger than the b40
Zhizi networks while normally being as fast or faster.

| Profile | Upstream artifact | Bytes | Repository-pinned SHA-256 | Bounded use |
| --- | --- | ---: | --- | --- |
| Interactive | [`b10c384h6nbttflrs.bin.gz`](https://github.com/lightvector/KataGo/releases/download/v1.17.1/b10c384h6nbttflrs.bin.gz) | `38,245,488` | `0ba27eced5180b3e3d0b898b280c541112989765e789d1eb6cd0d31b2b2c1229` | Analysis, candidate preview, and player-agent candidate intersection; default `24` visits |
| Deep study | [`b11c768h12nbt3tflrs-fson-silu.bin.gz`](https://github.com/lightvector/KataGo/releases/download/v1.17.1/b11c768h12nbt3tflrs-fson-silu.bin.gz) | `211,660,960` | `1881600caab9e9d85a3dd6a019e9b8e7d2c237b5f984e13ed49a8645be3077c6` | Explicit 19×19 reflection only; default `64` visits |

The reviewed [`katago-analysis-19x19.cfg`](../config/katago-analysis-19x19.cfg)
has SHA-256 `c6c4b5d9d3c1a1b572ac4eeb0a1ab1ab8a024995c8aacf03e5728d1e114b2305`.
One manager serializes queries, admits at most eight waiters, stops the active
process before switching profiles, and releases an idle process after 90 seconds.
Thus the fast and quality networks are never resident simultaneously. Candidate
moves still come from deterministic legality and engine moves are intersected with
those current, position-bound candidates.

Every accepted response records the exact engine version, profile, model name,
model bytes and SHA-256, configuration and binary pins, requested and actual
visits, elapsed time, Black perspective, state token, position hash, history
digest, move number, side to move, and query digest. A malformed or mismatched
binding is discarded rather than displayed.

Install both private, ignored networks and write their exact two-entry manifest:

```bash
scripts/setup-katago19-models.sh
scripts/verify-katago19.sh
```

GPU loading is an explicit sequential smoke check. It stops each profile before
loading the next and checks ownership, ownership variation, policy, candidate,
history, turn, and principal-variation shapes:

```bash
WEIQI_KATAGO19_GPU=1 scripts/verify-katago19.sh --smoke
```

The release smoke measured the fast profile at roughly 1.1 seconds for its first
empty-board load and 0.05 seconds for a warm opening query, and the quality profile
at roughly 3.4 seconds for its first load and 0.13 seconds warm at the reviewed
visit bounds. These are workstation observations, not portable latency promises.
