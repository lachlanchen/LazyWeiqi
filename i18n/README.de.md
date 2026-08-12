[English](../README.md) · [العربية](README.ar.md) · [Español](README.es.md) · [Français](README.fr.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Tiếng Việt](README.vi.md) · [中文 (简体)](README.zh-Hans.md) · [中文（繁體）](README.zh-Hant.md) · [Deutsch](README.de.md) · [Русский](README.ru.md)

[![LazyingArt banner](https://github.com/lachlanchen/lachlanchen/raw/main/figs/banner.png)](https://github.com/lachlanchen/lachlanchen/blob/main/figs/banner.png)

# Path of Influence

*Lerne Weiqi als eine lesbare Reise, nicht als eine Wand unerklärter „beste Züge.“*

[![Website](https://img.shields.io/badge/Website-Lazying.Art-0EA5E9)](https://lazying.art) [![License](https://img.shields.io/badge/License-MIT-green.svg)](../LICENSE) [![GitHub Sponsors](https://img.shields.io/badge/Sponsor-lachlanchen-EA4AAA?logo=githubsponsors)](https://github.com/sponsors/lachlanchen)

Path of Influence ist eine Local-First-Lehranwendung für Go/Weiqi. Sie führt von kurzen 5×5- und 7×7-Lektionen über vollständige 9×9-Partien bis zum regulären Spiel auf dem vollen 19×19-Brett, begleitet von einem erklärenden Begleiter, begrenzten Spieleragenten, erzähltem Agententheater und einer wiederspielbaren Chronik. Exakte Regeln bleiben autoritativ, selbst wenn jeder Analyse- oder Sprachmodellanbieter offline ist.

| Donate | PayPal | Stripe |
| --- | --- | --- |
| [![Donate](https://img.shields.io/badge/Donate-LazyingArt-0EA5E9?style=for-the-badge&logo=kofi&logoColor=white)](https://chat.lazying.art/donate) | [![PayPal](https://img.shields.io/badge/PayPal-RongzhouChen-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/RongzhouChen) | [![Stripe](https://img.shields.io/badge/Stripe-Donate-635BFF?style=for-the-badge&logo=stripe&logoColor=white)](https://buy.stripe.com/aFadR8gIaflgfQV6T4fw400) |

## App-Vorschau

![Path of Influence Lehrbrett](../docs/images/app.png)

Das Brett hält exakte Freiheiten, Gruppen, Erfassungen, Ko und legale Züge visuell getrennt von KataGo Vorhersagen, Lehrerinterpretationen, Modellerklärungen und Metaphern.

Bei regulären 19×19-Eröffnungen trennen Kandidatenvorschauen die exakte lokale Form von berechnetem Gebietspotenzial und Einflussrichtung. Danach zeigen sie redaktionelle Gewinne, Abwägungen, Kraftform vorher→nachher, Bedingungen zum Überdenken, Fortsetzungen, gegnerische Antworten und Joseki-Kontext (定式). Nummerierte Minidiagramme sind zu prüfende Fragen, keine bereits gesetzten Steine oder erzwungene Folge. Die optionale vertiefte KI-Studie hält ihre lokalisierten Überschriften vom unveränderten Modelltext getrennt und setzt keinen Stein.

## Lehrvertrag

- Deterministischer Code besitzt Legalität, Erfassung, positionale Superko, Scoring, Geschichte und Persistenz.
- KataGo liefert begrenzte Analysebeweise und verändert niemals ein Spiel.
- Player Agents wählt nur aus positionsgebundenen legalen Kandidaten-IDs, die vom Server bereitgestellt werden.
- Companion Agents erklären und stellen Fragen; sie bewegen sich nur nach einer expliziten Ein-Zug-Delegation.
- „Energie“ ist eine Lehrmetapher mit separat gekennzeichneten exakten, taktischen, Motor-, Lehrer-, Modell- und Metaphernbeweisen.
- Reguläre Partien, einschließlich des Spiels auf dem vollen 19×19-Brett, verwenden deklarierte chinesische Flächenwertung mit positionalem Superko; Trainingsvarianten sind gekennzeichnet.

## Was ist enthalten

| Pfad | Inhalte |
| --- | --- |
| [`apps/api/`](../apps/api/) | FastAPI Autorität, deterministischer Go-Bereich, SQLite Chronik und begrenzte KataGo/LLM Adapter |
| [`apps/web/`](../apps/web/) | Reaktionsfähiger React/Vite Lehrclient mit 11 expliziten Schnittstellenkatalogen |
| [`config/`](../config/) | Überprüfte KataGo-Analysekonfigurationen für 9×9 und 19×19 |
| [`scripts/`](../scripts/) | Reproduzierbare Einrichtung, Verifizierung, Laufzeit und sichtbare Browserkontrollen |
| [`references/`](../references/) | [Architektur und Sicherheit](../references/architecture-and-safety.md), [Lehrprinzipien](../references/teaching-principles.md) und [Modellherkunft](../references/model-sources.md) |

## Schnellstart

Voraussetzungen: Linux, Python 3.10+, [uv](https://docs.astral.sh/uv/), Node.js 22 und npm. KataGo ist optional für den ersten Start.

```bash
git clone https://github.com/lachlanchen/LazyWeiqi.git
cd LazyWeiqi
npm ci
uv sync --project apps/api --extra dev --locked
cp .env.example .env
scripts/run.sh start
```

Öffne `http://127.0.0.1:8010/` für das kompakte Brett oder `http://127.0.0.1:8010/full` für die vollständige Lernansicht. Stoppe nur die von diesem Repository besessenen Prozesse mit:

```bash
scripts/run.sh stop
```

Installiere die festgelegten, hash-verifizierten KataGo-Lehr-Engines, wenn eine Analyse benötigt wird. Die besondere 19×19-Einrichtung hat eine eigene geprüfte Konfiguration und Prüfung:

```bash
scripts/setup-katago.sh --print-plan
scripts/setup-katago.sh
scripts/verify-katago.sh
scripts/setup-katago19-models.sh
scripts/verify-katago19.sh --static-only
scripts/verify-katago19.sh
```

## Elfsprachige Schnittstelle

Der persistente, erlaubte Selektor unterstützt `en`, `ar`, `es`, `fr`, `ja`, `ko`, `vi`, `zh-Hans`, `zh-Hant`, `de` und `ru`. Jede Locale hat die gleichen 629 expliziten Nachrichten-Schlüssel und die gleichen Interpolationsplatzhalter. Die Dokumentensprache folgt der Auswahl, und Arabisch wechselt die Seite zu einem von rechts nach links gerichteten Layout.

Stabile Schnittstellenversion und bekannte deterministische Regelverletzungen sind lokalisiert. Unbekannte Motor- oder Modellprosa bleibt wörtlich und behält ihre Beweisherkunft; der Client präsentiert niemals eine nicht überprüfte Übersetzung als exakte Go-Fakt.

## Architektur

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

Private Notizen, Anmeldeinformationen, Datenbanken, Browserprofile, heruntergeladene Modelle, Tuning-Caches und generierte Laufzeitevidenzen bleiben ignoriert und außerhalb von Git.

## Entwicklung und Validierung

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

Browserseitige Änderungen erfordern zusätzlich die dedizierte Loopback noVNC/CDP Desktop-Prüfung bei Desktop- und Mobilbreiten, Screenshots und null unerwartete Konsolen- oder Netzwerkfehler.

## Zitation

Wenn du Path of Influence im Unterricht oder in der Forschung verwendest, zitiere das Repository. GitHub liest [CITATION.cff](../CITATION.cff) und zeigt ein **Dieses Repository zitieren**-Panel auf der Repository-Seite.

```bibtex
@software{chen_path_of_influence_2026,
  author = {Chen, Lachlan},
  title = {Path of Influence: A Local-First Weiqi Teaching Journey},
  year = {2026},
  version = {0.1.0},
  url = {https://github.com/lachlanchen/LazyWeiqi}
}
```

## Status und Umfang

Dies ist eine Produktionslehranwendung unter aktiver Entwicklung, kein wegwerfbares Brettspiel-Demo. Der Quellcode ist MIT-lizenziert; KataGo und heruntergeladene Netzwerke behalten ihre upstream Lizenzen und sind hier nicht festgeschrieben. Die Lehrvoreinstellung bleibt 9×9; reguläres Spiel auf dem vollen 19×19-Brett wird ebenfalls mit deklarierter chinesischer Flächenwertung und positionalem Superko unterstützt.
