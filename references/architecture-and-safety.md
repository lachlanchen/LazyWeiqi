# Architecture and safety

Path of Influence is a teaching application with model assistance, not a model
that happens to draw a board. This document defines the authority boundary that
keeps its lessons honest and its games reproducible.

## Sources of authority

| Layer | May do | Must never do |
| --- | --- | --- |
| Rules domain | Validate and apply moves; capture; enforce positional superko; pass, resign, and score | Depend on model output |
| Game service | Check actor authority, revision CAS, idempotency, branches, and persistence | Accept a coordinate invented by a model |
| KataGo | Evaluate a canonical position and rank bounded legal candidates | Mutate the game or define canonical history |
| Player Agent | Choose one server-issued candidate ID for its current authorized turn | Return arbitrary GTP/SGF coordinates or act as Companion |
| Companion/Narrator | Explain verified evidence, ask questions, and construct story | Move a stone, claim unsupported analysis, or expose hidden reasoning |
| React client | Preview intent and submit explicit commands | Treat an unverified local preview as legal |

All model-facing candidate IDs are short-lived and bound to a state token that
includes board, side to move, move number, pass count, phase, and the superko
history digest. A choice from an earlier turn or branch is rejected even when the
visible stones happen to match.

## Durable game state

SQLite runs with WAL and `synchronous=FULL`. Game nodes are immutable and linked
to their parents; rewind changes the active node and a later move creates a new
branch. The current game row carries a monotonically increasing revision. Every
mutation uses compare-and-swap semantics, while idempotency keys additionally
bind the exact request fingerprint.

Loading a game does not blindly trust a serialized snapshot. The domain decodes
the setup and ordered move history, replays every move, and verifies position
hashes, captures, superko history, actor authority, passes, and result invariants.

## Teaching evidence

The Energy Lens deliberately separates evidence classes:

- **Exact**: liberties, groups, adjacency, captures, phase, and legal status.
- **Tactical read**: a bounded variation, clearly identified as a read.
- **Engine estimate**: KataGo ownership, policy, score, and uncertainty.
- **Model explanation**: validated learner-facing prose that is not itself an
  exact board fact.
- **Metaphor**: learner-facing language such as breath, shelter, roads, or reach.

A metaphor may summarize verified facts but cannot be converted into a synthetic
“energy score.” A language model receives only a bounded canonical snapshot,
candidate IDs, labeled facets, lesson target, the current question, and at most
four clipped question/answer pairs from the active branch (at most 4,000 UTF-8
bytes together). Rewound dialogue is excluded. Strict structured output rejects
unknown candidate IDs and unsupported fields. Provider failure falls back to
deterministic teaching rather than blocking play.

The default Cloud layer is a transparent distance-decay visualization computed
from canonical stone coordinates. On an empty board it shows authored
corner/side/center opening potential; after play it shows separate Black, White,
and overlap fields. It is labeled **Metaphor** and is never score, territory,
physics, or hidden model output. On 9×9, a separate Reach/Ground layer may render
the supplied KataGo ownership estimate with an **Engine estimate** label. The
installed 9×9-specialized network is never queried for 5×5 or 7×7 positions.

The adjacent teaching card uses a fixed beginner scan—place, change, reply,
next—rather than an essay. Coordinates and exact liberty/capture facts come from
the deterministic position; candidate summaries and replies are displayed only
when they exist in the position-bound shortlist. Model instructions forbid
turning “two or more liberties” into an unsupported alive/safe claim.

The complete learner-facing dialogue remains in the game chronicle. This release
does not turn older model text into a privileged semantic summary; only the
bounded recent window above is reused as model context, avoiding silent elevation
of stale or model-authored claims.

Chronicle discovery is cursor-paginated (`GET /api/games?limit=20&cursor=…`).
The client retains the opaque continuation cursor and can load older pages
without a fixed recent-session ceiling; ordering is stable by last activity and
game ID.

Coach dialogue has a separate branch- and revision-bound cursor endpoint,
`GET /api/games/{id}/coach-history`. The first response remains bounded while
the learner can reveal older persisted exchanges; a rewind invalidates stale
history cursors instead of mixing branches.

## Agent roles and delegation

`player_agent` is the only model-backed role that can choose a move. Its color and
turn are fixed by the game actor map. `companion_agent` and `narrator_agent` have
no move authority in the deterministic domain.

When a learner presses “Invite Lantern to choose this one move,” the request is a
one-turn delegation by the current human actor. The server chooses through a
bounded Player Agent path, applies the resolved deterministic candidate, and
records both chooser and delegator provenance. It does not modify the Companion's
role or create standing permission for later turns.

## Network and filesystem boundary

- The API binds only `127.0.0.1` and rejects untrusted Host headers.
- JSON request bodies are counted while consumed and capped before domain work.
- LocalLLM and Ollama endpoints are exact loopback URLs validated by settings.
- OpenAI traffic, when explicitly configured, uses only the official HTTPS API;
  `store:false` is set and only the bounded evidence/context described above is
  sent.
- The data directory may not be a symlink and receives private permissions.
- KataGo source, binaries, models, logs, browser profiles, and evidence are
  ignored under `.local/`; databases are ignored under `data/`. KataGo is
  reported ready only when a setup-produced attestation still matches the exact
  executable, reviewed config, and pinned model files; status checks never
  execute an unattested binary.
- Setup, verification, and runtime readiness reject symlinked intermediate
  `.local` parents and require every KataGo artifact/log path to resolve beneath
  the canonical project root.
- The noVNC/CDP harness binds every listener to loopback, checks PID ownership,
  disables the detached crash reporter, routes non-loopback browser names and
  HTTP(S) through fail-closed local sinks, checks page requests and browser
  sockets, and refuses foreign ports/displays. Chrome's internal FCM invalidation
  may log a blocked `-130` attempt; the evidence reports that honestly and passes
  only when no external request or socket escaped.

This is a same-user local application, not a hostile multi-user service. Any
future remote deployment needs authentication, TLS, per-user authorization,
request admission, and a new threat-model review.

## Model hierarchy

The preferred companion model is GPT-5.6 Sol when an official API key and model
entitlement are present. LocalLLM/Ollama always remains eligible for bounded
legal-candidate selection, while its prose teaching path is default-off until the
configured model passes a factual Weiqi evaluation. Model prose is never labeled
`Exact`; exact claims are rendered from deterministic rules/facets. KataGo remains
the Go expert regardless of companion provider. AgInTiFlow is intentionally
deferred to a later orchestration stage and is not required by the core
application.
