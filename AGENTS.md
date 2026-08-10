# Weiqi repository guidance

Weiqi is a production teaching application, not a disposable board-game demo.

## Product contract

- Deterministic code owns rules, legality, captures, scoring, game history, and persistence.
- KataGo supplies bounded analysis evidence. It never mutates a game directly.
- Player Agents may choose only from server-supplied legal candidate IDs.
- Companion Agents explain evidence and ask questions. They never move a stone unless the learner explicitly delegates a turn.
- “Energy” is a teaching metaphor with separately labeled facets: exact liberties and groups, tactical reads, engine ownership estimates, and narrative language. Never present one mystical aggregate score.
- Training variants must be labeled. Ordinary games use declared Chinese area rules with positional superko.
- Private notes, credentials, databases, browser profiles, downloaded models, tuning caches, and generated runtime evidence stay out of Git.

## Structure

- `apps/api/`: FastAPI service, deterministic Go domain, SQLite store, KataGo and LocalLLM adapters.
- `apps/web/`: React/Vite learning client.
- `config/`: reviewed runtime configuration.
- `scripts/`: reproducible setup, verification, run, and browser-control scripts.
- `references/`: public source and model provenance.
- `references/private/`: ignored private source notes.

## Quality gates

Run before committing:

```bash
npm run lint
npm test
npm run build
uv run --locked --project apps/api ruff check apps/api
uv run --locked --project apps/api ruff format --check apps/api
uv run --locked --project apps/api pytest -q
bash -n scripts/*.sh
git diff --check
```

Browser changes also require a dedicated loopback noVNC/CDP desktop check at desktop and mobile widths, screenshots, and zero unexpected console/network errors.
