[English](../README.md) · [العربية](README.ar.md) · [Español](README.es.md) · [Français](README.fr.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Tiếng Việt](README.vi.md) · [中文 (简体)](README.zh-Hans.md) · [中文（繁體）](README.zh-Hant.md) · [Deutsch](README.de.md) · [Русский](README.ru.md)

[![LazyingArt banner](https://github.com/lachlanchen/lachlanchen/raw/main/figs/banner.png)](https://github.com/lachlanchen/lachlanchen/blob/main/figs/banner.png)

# Path of Influence

*Apprenez Weiqi comme un voyage lisible, et non comme un mur de « meilleurs coups » inexpliqués.*

[![Website](https://img.shields.io/badge/Website-Lazying.Art-0EA5E9)](https://lazying.art) [![License](https://img.shields.io/badge/License-MIT-green.svg)](../LICENSE) [![GitHub Sponsors](https://img.shields.io/badge/Sponsor-lachlanchen-EA4AAA?logo=githubsponsors)](https://github.com/sponsors/lachlanchen)

Path of Influence est une application d'enseignement locale pour Go/Weiqi. Elle passe de courtes leçons de 5×5 et 7×7 à des parties complètes de 9×9 avec un compagnon explicatif, des agents joueurs limités, un théâtre d'agents narré et une chronique rejouable. Les règles exactes restent autoritaires même lorsque chaque analyse ou fournisseur de modèle linguistique est hors ligne.

| Donate | PayPal | Stripe |
| --- | --- | --- |
| [![Donate](https://img.shields.io/badge/Donate-LazyingArt-0EA5E9?style=for-the-badge&logo=kofi&logoColor=white)](https://chat.lazying.art/donate) | [![PayPal](https://img.shields.io/badge/PayPal-RongzhouChen-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/RongzhouChen) | [![Stripe](https://img.shields.io/badge/Stripe-Donate-635BFF?style=for-the-badge&logo=stripe&logoColor=white)](https://buy.stripe.com/aFadR8gIaflgfQV6T4fw400) |

## Aperçu de l'application

![Tableau d'enseignement Path of Influence](../docs/images/app.png)

Le tableau garde les libertés exactes, les groupes, les captures, le ko et les coups légaux visuellement séparés des prévisions KataGo, de l'interprétation de l'enseignant, de l'explication du modèle et de la métaphore.

## Contrat d'enseignement

- Le code déterministe possède la légalité, la capture, le superko positionnel, le score, l'historique et la persistance.
- KataGo fournit des preuves d'analyse limitées et ne modifie jamais une partie.
- Player Agents choisit uniquement parmi les ID de candidats légaux liés à la position fournis par le serveur.
- Companion Agents explique et pose des questions ; ils ne se déplacent qu'après une délégation explicite d'un tour.
- L'« énergie » est une métaphore d'enseignement avec des preuves exactes, tactiques, de moteur, d'enseignant, de modèle et de métaphore séparément étiquetées.
- Les parties ordinaires utilisent les règles de zone chinoises déclarées ; les variantes d'entraînement sont étiquetées.

## Ce qui est inclus

| Chemin | Contenu |
| --- | --- |
| [`apps/api/`](../apps/api/) | Autorité FastAPI, domaine Go déterministe, chronique SQLite et adaptateurs KataGo/LLM limités |
| [`apps/web/`](../apps/web/) | Client d'enseignement React/Vite réactif avec 11 catalogues d'interface explicites |
| [`config/`](../config/) | Configuration d'analyse KataGo 9×9 révisée |
| [`scripts/`](../scripts/) | Configuration reproductible, vérification, exécution et contrôles visibles du navigateur |
| [`references/`](../references/) | [Architecture et sécurité](../references/architecture-and-safety.md), [principes d'enseignement](../references/teaching-principles.md) et [provenance du modèle](../references/model-sources.md) |

## Démarrage rapide

Prérequis : Linux, Python 3.10+, [uv](https://docs.astral.sh/uv/), Node.js 22 et npm. KataGo est optionnel pour le premier lancement.

```bash
git clone https://github.com/lachlanchen/LazyWeiqi.git
cd LazyWeiqi
npm ci
uv sync --project apps/api --extra dev --locked
cp .env.example .env
scripts/run.sh start
```

Ouvrez `http://127.0.0.1:8010/` pour le tableau compact ou `http://127.0.0.1:8010/full` pour la vue d'apprentissage complète. Arrêtez uniquement les processus possédés par ce dépôt avec :

```bash
scripts/run.sh stop
```

Installez le moteur d'enseignement KataGo, vérifié par hachage, lorsque l'analyse est nécessaire :

```bash
scripts/setup-katago.sh --print-plan
scripts/setup-katago.sh
scripts/verify-katago.sh
```

## Interface en onze langues

Le sélecteur persistant et autorisé prend en charge `en`, `ar`, `es`, `fr`, `ja`, `ko`, `vi`, `zh-Hans`, `zh-Hant`, `de` et `ru`. Chaque locale a les mêmes 409 clés de message explicites et les mêmes espaces réservés d'interpolation. La langue du document suit la sélection, et l'arabe change la page en mise en page de droite à gauche.

La copie de l'interface stable et les échecs de règles déterministes connus sont localisés. La prose d'un moteur ou d'un modèle inconnu reste verbatim et conserve sa provenance de preuve ; le client ne présente jamais une traduction non révisée comme un fait exact de Go.

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

Les notes privées, les identifiants, les bases de données, les profils de navigateur, les modèles téléchargés, les caches de réglage et les preuves d'exécution générées restent ignorés et hors de Git.

## Développement et validation

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

Les changements visibles dans le navigateur nécessitent également la vérification de boucle de retour dédiée noVNC/CDP à des largeurs de bureau et mobiles, des captures d'écran et aucune erreur inattendue de console ou de réseau.

## Citation

Si vous utilisez Path of Influence dans l'enseignement ou la recherche, citez le dépôt. GitHub lit [CITATION.cff](../CITATION.cff) et affiche un panneau **Citez ce dépôt** sur la page du dépôt.

```bibtex
@software{chen_path_of_influence_2026,
  author = {Chen, Lachlan},
  title = {Path of Influence: A Local-First Weiqi Teaching Journey},
  year = {2026},
  version = {0.1.0},
  url = {https://github.com/lachlanchen/LazyWeiqi}
}
```

## Statut et portée

Ceci est une application d'enseignement en production en cours de développement actif, pas une démo de jeu de société jetable. La source est sous licence MIT ; KataGo et les réseaux téléchargés conservent leurs licences en amont et ne sont pas engagés ici. Le défaut actuel est 9×9, tandis que 13×13 et 19×19 restent prévus, avec des ponts budgétés séparément.
