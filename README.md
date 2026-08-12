[English](README.md) · [العربية](i18n/README.ar.md) · [Español](i18n/README.es.md) · [Français](i18n/README.fr.md) · [日本語](i18n/README.ja.md) · [한국어](i18n/README.ko.md) · [Tiếng Việt](i18n/README.vi.md) · [中文 (简体)](i18n/README.zh-Hans.md) · [中文（繁體）](i18n/README.zh-Hant.md) · [Deutsch](i18n/README.de.md) · [Русский](i18n/README.ru.md)

[![LazyingArt banner](https://github.com/lachlanchen/lachlanchen/raw/main/figs/banner.png)](https://github.com/lachlanchen/lachlanchen/blob/main/figs/banner.png)

# Path of Influence

*Learn Weiqi as a readable journey, not as a wall of unexplained “best moves.”*

[![Website](https://img.shields.io/badge/Website-Lazying.Art-0EA5E9)](https://lazying.art) [![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE) [![GitHub Sponsors](https://img.shields.io/badge/Sponsor-lachlanchen-EA4AAA?logo=githubsponsors)](https://github.com/sponsors/lachlanchen)

Path of Influence is a local-first teaching application for Go/Weiqi. It moves from short 5×5 and 7×7 lessons through complete 9×9 games to ordinary full-board 19×19 play, with an explanatory companion, bounded player agents, narrated agent theatre, and a replayable chronicle. Exact rules remain authoritative even when every analysis or language-model provider is offline.

| Donate | PayPal | Stripe |
| --- | --- | --- |
| [![Donate](https://img.shields.io/badge/Donate-LazyingArt-0EA5E9?style=for-the-badge&logo=kofi&logoColor=white)](https://chat.lazying.art/donate) | [![PayPal](https://img.shields.io/badge/PayPal-RongzhouChen-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/RongzhouChen) | [![Stripe](https://img.shields.io/badge/Stripe-Donate-635BFF?style=for-the-badge&logo=stripe&logoColor=white)](https://buy.stripe.com/aFadR8gIaflgfQV6T4fw400) |

## App preview

![Path of Influence teaching board](docs/images/app.png)

The board keeps exact liberties, groups, captures, ko, and legal moves visually separate from KataGo forecasts, teacher interpretation, model explanation, and metaphor.

On ordinary 19×19 openings, candidate previews separate exact local shape from calculated territory potential and influence direction, then show authored gains, tradeoffs, before→after power shape, reconsideration conditions, follow-ups, opponent replies, and joseki (定式) context. Numbered mini-diagrams are questions to examine, not stones already played or a forced sequence. The optional deeper AI study keeps its localized headings separate from verbatim model prose and never places a stone.

## Teaching contract

- Deterministic code owns legality, capture, positional superko, scoring, history, and persistence.
- KataGo supplies bounded analysis evidence and never mutates a game.
- Player Agents choose only from position-bound legal candidate IDs supplied by the server.
- Companion Agents explain and ask questions; they move only after an explicit one-turn delegation.
- “Energy” is a teaching metaphor with separately labeled exact, tactical, engine, teacher, model, and metaphor evidence.
- Ordinary games, including full-board 19×19 play, use declared Chinese area rules with positional superko; training variants are labeled.

## What is included

| Path | Contents |
| --- | --- |
| [`apps/api/`](apps/api/) | FastAPI authority, deterministic Go domain, SQLite chronicle, and bounded KataGo/LLM adapters |
| [`apps/web/`](apps/web/) | Responsive React/Vite teaching client with 11 explicit interface catalogs |
| [`config/`](config/) | Reviewed 9×9 and 19×19 KataGo analysis configurations |
| [`scripts/`](scripts/) | Reproducible setup, verification, runtime, and visible-browser controls |
| [`references/`](references/) | [Architecture and safety](references/architecture-and-safety.md), [teaching principles](references/teaching-principles.md), and [model provenance](references/model-sources.md) |

## Quick start

Prerequisites: Linux, Python 3.10+, [uv](https://docs.astral.sh/uv/), Node.js 22, and npm. KataGo is optional for the first launch.

```bash
git clone https://github.com/lachlanchen/LazyWeiqi.git
cd LazyWeiqi
npm ci
uv sync --project apps/api --extra dev --locked
cp .env.example .env
scripts/run.sh start
```

Open `http://127.0.0.1:8010/` for the compact board or `http://127.0.0.1:8010/full` for the complete learning view. Stop only this repository’s owned processes with:

```bash
scripts/run.sh stop
```

Install the pinned, hash-verified KataGo teaching engines when analysis is needed. The dedicated 19×19 setup has its own reviewed configuration and verification path:

```bash
scripts/setup-katago.sh --print-plan
scripts/setup-katago.sh
scripts/verify-katago.sh
scripts/setup-katago19-models.sh
scripts/verify-katago19.sh --static-only
scripts/verify-katago19.sh
```

## Eleven-language interface

The persisted, allowlisted selector supports `en`, `ar`, `es`, `fr`, `ja`, `ko`, `vi`, `zh-Hans`, `zh-Hant`, `de`, and `ru`. Every locale has the same 629 explicit message keys and the same interpolation placeholders. The document language follows the selection, and Arabic switches the page to right-to-left layout.

Stable interface copy and known deterministic rule failures are localized. Unknown engine or model prose remains verbatim and keeps its evidence provenance; the client never presents an unreviewed translation as an exact Go fact.

## Architecture

```text
React teaching UI
       │ exact commands + revision checks
       ▼
FastAPI game service ───────► SQLite game and branch chronicle
       │
       ├── deterministic rules, capture, superko, and scoring
       ├── legal candidate IDs ──► KataGo / bounded Player Agent
       └── verified evidence ────► Companion / narrator explanation
```

Private notes, credentials, databases, browser profiles, downloaded models, tuning caches, and generated runtime evidence remain ignored and out of Git.

## Development and validation

```bash
npm run lint
npm test
npm run build
uv run --locked --project apps/api ruff check apps/api
uv run --locked --project apps/api ruff format --check apps/api
uv run --locked --project apps/api pytest -q
bash -n scripts/*.sh scripts/tests/*.sh
git diff --check
```

Browser-facing changes additionally require the dedicated loopback noVNC/CDP desktop check at desktop and mobile widths, screenshots, and zero unexpected console or network errors.

## Citation

If you use Path of Influence in teaching or research, cite the repository. GitHub reads [CITATION.cff](CITATION.cff) and shows a **Cite this repository** panel on the repository page.

```bibtex
@software{chen_path_of_influence_2026,
  author = {Chen, Lachlan},
  title = {Path of Influence: A Local-First Weiqi Teaching Journey},
  year = {2026},
  version = {0.1.0},
  url = {https://github.com/lachlanchen/LazyWeiqi}
}
```

## Status and scope

This is a production teaching application under active development, not a disposable board-game demo. The source is MIT licensed; KataGo and downloaded networks retain their upstream licenses and are not committed here. The teaching default remains 9×9; ordinary full-board 19×19 play is also supported under declared Chinese area rules with positional superko.
