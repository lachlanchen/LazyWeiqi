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

## Optional later 13x13/19x19 network

Do not download this for the initial 9x9 course. KataGo's `v1.17.1` release calls
`b11c768h12nbt3tflrs-fson-silu.bin.gz` its strongest released transformer and
states that it is stronger than the large b40 Zhizi networks while normally being
as fast or faster.

- Release: <https://github.com/lightvector/KataGo/releases/tag/v1.17.1>
- Asset: <https://github.com/lightvector/KataGo/releases/download/v1.17.1/b11c768h12nbt3tflrs-fson-silu.bin.gz>
- Bytes: `211,660,960`
- SHA-256: `1881600caab9e9d85a3dd6a019e9b8e7d2c237b5f984e13ed49a8645be3077c6`

Adding it requires a separate 19x19 runtime configuration and a fresh measured GPU
memory budget. It must not silently replace the specialized beginner 9x9 lane.
