# Path of Influence

**Learn Weiqi as a readable journey—not as a wall of unexplained “best moves.”**

Path of Influence is a local-first teaching game for people who know the basic
rules of Go/Weiqi but still do not know how to begin, what to notice, or why a
move matters. It starts with short 5×5 and 7×7 scenes, then opens into complete
9×9 games with a companion, player agents, narrated agent-vs-agent theatre, and
an honest review chronicle. The interface is available in English, Simplified
Chinese, and Japanese; the language selector preserves the active game and does
not translate or relabel unconstrained model prose as verified evidence.

The product has one strict rule: deterministic code owns the game. KataGo may
analyze a position, and a language model may explain verified evidence, but
neither may invent legality, captures, scoring, history, or a move outside the
server's position-bound candidate list.

## What it teaches

- **Breath** — exact liberties, atari, capture, escape, and sacrifice.
- **Bonds** — connected groups, cuts, shared liberties, and shape.
- **Shelter** — eye space and the difference between running and settling.
- **Reach** — engine-estimated influence and where a wall can exert pressure.
- **Ground** — ownership tendency without pretending uncertain territory is
  already points in the bank.
- **Tempo** — initiative, forcing replies, and when it is safe to turn away.

“Energy” is deliberately a teaching metaphor, never a mystical number. Every
claim is labeled as **Exact**, **Tactical read**, **Engine estimate**, **Teacher
guidance**, **Model explanation**, or **Metaphor**, so a learner can feel the
story without losing the underlying Go knowledge.

Before the first move on a supported 9×9 board, KataGo's order-zero candidate
is already visible. Its field is not a stone-distance halo: it compares KataGo's
ownership forecast after that move with the current position. Blue means more
Black tendency, orange more White tendency, and violet a near-balanced or
high-variation boundary. Hover or keyboard-focus another candidate to compare
its field. Click any legal intersection—even one outside the shortlist—to
analyze that exact if-played position without placing a stone. **Place stone**
appears only after the matching legal preview is ready and remains the sole
commit action. Right-click the board or press **Esc** to return to the current
agent suggestions; touch users have the same **Back to suggestions** action.

The companion beside the board stays concrete:

1. **Play** — the coordinate and a clearly labeled teacher hypothesis about its job.
2. **Because** — exact facts, engine comparisons, and teacher interpretation kept separate.
3. **Changes** — captures, liberties, connections, score forecast, and ownership shape.
4. **Opponent** — one supplied continuation, explicitly not a forced line.
5. **Then check** — the failure condition or follow-up to calculate.
6. **Principle** — one reusable strategy idea, including its limitation.

The optional Presence sketch remains a clearly labeled beginner analogy for
corner/side/center efficiency and nearby stones. It does **not** rank moves and
is never presented as physics, territory, ownership, or score.

The specialized installed network is used only on 9×9, the board size for which
upstream designed it. The short 5×5 and 7×7 lessons use deterministic rules and
authored Weiqi theory; their location previews never borrow a false ownership,
score, or KataGo badge from the 9×9 model.

## Learning modes

| Mode | Who moves | What the teaching agent does |
| --- | --- | --- |
| Human + Companion | You | Explains the position and asks reflection questions. It never gains move authority; an explicit invitation invokes a separate, one-turn bounded chooser and records who delegated it. |
| Human vs Player Agent | You and a bounded player agent | The agent chooses only from legal, position-bound candidates. |
| Agent Theatre | Two player agents | Mountain and River play while Lantern narrates intentions, tension, shape, and consequences. |
| Two people | Two humans | Deterministic local board and history without an AI player. |

The beginner route starts immediately on 5×5, continues through 7×7, and makes
9×9 the default real-game board. The 13×13 and 19×19 chapters are visible as
later bridges rather than barriers at the entrance.

## Architecture

```text
React teaching UI
       │ exact commands + revision CAS
       ▼
FastAPI game service ───────► SQLite game/branch chronicle
       │
       ├── deterministic rules, superko, capture, Chinese-area scoring
       │
       ├── position-bound legal shortlist ──► KataGo + HumanSL
       │                                      analysis only
       │
       └── bounded verified evidence ───────► GPT-5.6 Sol, LocalLLM,
                                              or deterministic coach
```

Core safety properties:

- immutable board transitions and load-time replay validation;
- positional superko, passes, resignation, and Chinese-area scoring in Python;
- optimistic revisions for every mutation and fingerprinted idempotent retries for moves and coach exchanges;
- one-turn delegation that never upgrades the Companion into a Player Agent;
- private SQLite/WAL storage under the ignored `data/` directory;
- loopback-only API, browser, CDP, VNC, and noVNC listeners;
- downloaded engine/model/runtime artifacts stay under ignored `.local/` paths.

See [teaching and decision-map principles](references/teaching-principles.md)
for the explanation contract, [Architecture and safety](references/architecture-and-safety.md)
for the authority model, and [model sources](references/model-sources.md) for
exact engine and network provenance.

## Quick start

Prerequisites: Linux, Python 3.10+, [uv](https://docs.astral.sh/uv/), Node.js
22, and npm. KataGo is optional for the first launch; exact rules and authored
lessons work without it.

```bash
git clone https://github.com/lachlanchen/LazyWeiqi.git
cd LazyWeiqi
npm ci
uv sync --project apps/api --extra dev --locked
cp .env.example .env
scripts/run.sh start
```

Open <http://127.0.0.1:8010/> for the default compact, full-screen board or
<http://127.0.0.1:8010/full> for the complete learning interface. The header
switch changes between them without reloading or losing the active game. Stop
only this repository's owned API process with:

```bash
scripts/run.sh stop
```

### Install the pinned KataGo teaching engine

The setup builds KataGo `v1.17.2` from the exact pinned commit and downloads the
specialized 9×9 and HumanSL networks with size/hash verification. It never
installs or replaces system CUDA components.

```bash
scripts/setup-katago.sh --print-plan
scripts/setup-katago.sh
scripts/verify-katago.sh
WEIQI_KATAGO_GPU=1 scripts/verify-katago.sh --smoke
```

Setup atomically records an ignored local attestation only after the pinned
binary, exact analysis config, clean source commit, and both model hashes pass.
Runtime status verifies that identity without executing KataGo and caches the
hash result while file signatures remain unchanged. Existing complete installs
can add the attestation without rebuilding or downloading via
`scripts/setup-katago.sh --attest-existing`.

The smoke test checks free VRAM before loading and never evicts another process.
Change the physical GPU only after checking current placement with
`nvidia-smi`; the checked-in KataGo config uses logical CUDA device 0 after the
physical-device mask is applied.

### Optional teaching models

Provider priority is quality-first and fail-soft:

1. GPT-5.6 Sol through the official OpenAI Responses API when
   `WEIQI_OPENAI_API_KEY` is configured **and the API project has model access**.
2. A deterministic coach derived from exact rules and KataGo evidence.
3. The existing loopback LocalLLM/Ollama runtime for bounded legal-candidate
   choice. Local prose coaching is default-off and must be explicitly enabled
   only after the configured model passes a factual Weiqi evaluation.

The game remains usable when every language model is offline. Arbitrary model
prose is labeled as model-generated and never receives an `Exact` badge; exact
badges belong only to server-computed rules/facets. Model output is never stored
as hidden reasoning; only the validated learner-facing explanation is persisted.

### Language contract

English is the default, with reviewed Simplified Chinese and Japanese catalogs.
The header selector uses an allowlist, persists its choice locally, and updates
the document language without restarting the lesson or changing the active UI
route. Stable interface copy, deterministic rules explanations, and curriculum
lessons are localized by catalog key or lesson ID. Unconstrained engine/model
prose stays verbatim and keeps its evidence label; the client never presents a
machine translation as verified Weiqi evidence.

## Dedicated visible browser

For repeatable UI work, start the app first and then the isolated browser desktop:

```bash
scripts/run.sh start
scripts/launch-novnc.sh start
uv run --locked --project apps/api python scripts/browser-smoke.py
```

The default viewer is:

<http://127.0.0.1:6131/vnc.html?host=127.0.0.1&port=6131&autoconnect=1&resize=scale>

Chrome inside that desktop exposes CDP only on `127.0.0.1:9471`. Runtime
profiles, logs, screenshots, and evidence are ignored. The launcher validates
PID ownership and refuses occupied displays or ports rather than killing foreign
processes. Browser smoke is serialized and keeps a private ledger of only the
exact game IDs it creates. It revision-checks and removes those test games in a
`finally` cleanup, verifies that the pre-existing chronicle is unchanged, and
never deletes a learner game by title or heuristic.

## Development and validation

```bash
npm run lint
npm test
npm run build
uv run --locked --project apps/api ruff check apps/api
uv run --locked --project apps/api ruff format --check apps/api
uv run --locked --project apps/api pytest -q
scripts/tests/test-katago-scripts.sh
bash -n scripts/*.sh scripts/tests/*.sh
git diff --check
```

The deterministic suite covers captures, suicide, superko, scoring, SGF,
candidate authority, stale-state rejection, serialization replay, API body and
host boundaries, branch rewind, delegation, provider validation, CAS, and
idempotency. Web tests cover the board, API contracts, accessibility, fallback
truthfulness, and interaction lifecycles. GitHub Actions use mocks and static
pins; real GPU/model smoke remains an explicit local gate.

## Project map

- [`apps/api/weiqi/domain`](apps/api/weiqi/domain) — pure Go rules, actors,
  scoring, coordinates, SGF, and transparent teaching metrics.
- [`apps/api/weiqi/services`](apps/api/weiqi/services) — game authority,
  curriculum, serialization, and bounded provider orchestration.
- [`apps/web/src`](apps/web/src) — responsive journey, board, energy lenses,
  companion rail, theatre, and chronicle.
- [`config/katago-analysis-9x9.cfg`](config/katago-analysis-9x9.cfg) — bounded
  analysis configuration.
- [`references/model-sources.md`](references/model-sources.md) — pinned source,
  model, hashes, licenses, and HumanSL settings.

## Roadmap

- reviewed board-photo proposals through a vision model, never auto-committed;
- richer life-and-death, ladder, net, ko, endgame, and full-game reviews;
- optional 13×13/19×19 bridge with a separately measured model/runtime budget;
- AgInTiFlow coordination only as a later experimental layer, after the core
  deterministic teaching loop is stable.

## License and citation

The application source is MIT licensed. KataGo and downloaded networks retain
their upstream licenses and are not committed to this repository.

If Path of Influence supports your teaching or research, cite the repository;
GitHub reads [`CITATION.cff`](CITATION.cff) and exposes **Cite this repository**.

```bibtex
@software{chen_path_of_influence_2026,
  author = {Lachlan Chen},
  title = {Path of Influence: A Local-First Weiqi Teaching Journey},
  year = {2026},
  version = {0.1.0},
  url = {https://github.com/lachlanchen/LazyWeiqi}
}
```

## Support

If this work is useful, you can support continued development through
[GitHub Sponsors](https://github.com/sponsors/lachlanchen). More projects and
contact links are available at [Lazying Art](https://lazying.art),
[Lazying Chat](https://chat.lazying.art), and
[OnlyIdeas.Art](https://onlyideas.art).
