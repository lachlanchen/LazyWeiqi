[English](../README.md) · [العربية](README.ar.md) · [Español](README.es.md) · [Français](README.fr.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Tiếng Việt](README.vi.md) · [中文 (简体)](README.zh-Hans.md) · [中文（繁體）](README.zh-Hant.md) · [Deutsch](README.de.md) · [Русский](README.ru.md)

[![LazyingArt banner](https://github.com/lachlanchen/lachlanchen/raw/main/figs/banner.png)](https://github.com/lachlanchen/lachlanchen/blob/main/figs/banner.png)

# Path of Influence

*Weiqiを説明のない「最善手」の壁としてではなく、読みやすい旅として学びましょう。*

[![Website](https://img.shields.io/badge/Website-Lazying.Art-0EA5E9)](https://lazying.art) [![License](https://img.shields.io/badge/License-MIT-green.svg)](../LICENSE) [![GitHub Sponsors](https://img.shields.io/badge/Sponsor-lachlanchen-EA4AAA?logo=githubsponsors)](https://github.com/sponsors/lachlanchen)

Path of Influenceは、Go/Weiqiのためのローカルファーストの教育アプリケーションです。短い5×5および7×7のレッスンから、説明付きの伴侶、制約されたプレイヤーエージェント、ナレーション付きエージェントシアター、再生可能な年代記を伴う完全な9×9ゲームへと進みます。正確なルールは、すべての分析や言語モデルプロバイダーがオフラインであっても権威を持ち続けます。

| Donate | PayPal | Stripe |
| --- | --- | --- |
| [![Donate](https://img.shields.io/badge/Donate-LazyingArt-0EA5E9?style=for-the-badge&logo=kofi&logoColor=white)](https://chat.lazying.art/donate) | [![PayPal](https://img.shields.io/badge/PayPal-RongzhouChen-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/RongzhouChen) | [![Stripe](https://img.shields.io/badge/Stripe-Donate-635BFF?style=for-the-badge&logo=stripe&logoColor=white)](https://buy.stripe.com/aFadR8gIaflgfQV6T4fw400) |

## アプリプレビュー

![Path of Influence教育ボード](../docs/images/app.png)

ボードは、KataGoの予測、教師の解釈、モデルの説明、比喩から視覚的に分離された正確な自由度、グループ、キャプチャ、コウ、合法的な手を保持します。

## 教育契約

- 決定論的コードは、合法性、キャプチャ、位置的スーパコウ、スコア、履歴、および永続性を所有します。
- KataGoは制約された分析証拠を提供し、ゲームを決して変異させません。
- Player Agentsは、サーバーから提供された位置に制約された合法的な候補IDの中からのみ選択します。
- Companion Agentsは説明し、質問をします。彼らは明示的な1ターンの委任の後にのみ動きます。
- 「エネルギー」は、正確、戦術的、エンジン、教師、モデル、比喩の証拠が別々にラベル付けされた教育の比喩です。
- 通常のゲームは宣言された中国のエリアルールを使用します。トレーニングバリアントにはラベルが付けられています。

## 含まれるもの

| パス | コンテンツ |
| --- | --- |
| [`apps/api/`](../apps/api/) | FastAPIの権威、決定論的Goドメイン、SQLiteの年代記、および制約されたKataGo/LLMアダプター |
| [`apps/web/`](../apps/web/) | 11の明示的なインターフェースカタログを持つ応答性のあるReact/Vite教育クライアント |
| [`config/`](../config/) | レビュー済みの9×9 KataGo分析構成 |
| [`scripts/`](../scripts/) | 再現可能なセットアップ、検証、ランタイム、および可視ブラウザコントロール |
| [`references/`](../references/) | [アーキテクチャと安全性](../references/architecture-and-safety.md)、[教育原則](../references/teaching-principles.md)、および[モデルの出所](../references/model-sources.md) |

## クイックスタート

前提条件: Linux、Python 3.10以上、[uv](https://docs.astral.sh/uv/)、Node.js 22、およびnpm。KataGoは初回起動時にはオプションです。

```bash
git clone https://github.com/lachlanchen/LazyWeiqi.git
cd LazyWeiqi
npm ci
uv sync --project apps/api --extra dev --locked
cp .env.example .env
scripts/run.sh start
```

コンパクトボード用の`http://127.0.0.1:8010/`を開くか、完全な学習ビュー用の`http://127.0.0.1:8010/full`を開いてください。このリポジトリが所有するプロセスのみを停止するには、次のコマンドを使用します:

```bash
scripts/run.sh stop
```

分析が必要な場合は、ピン留めされたハッシュ検証済みのKataGo教育エンジンをインストールします:

```bash
scripts/setup-katago.sh --print-plan
scripts/setup-katago.sh
scripts/verify-katago.sh
```

## 11言語インターフェース

保持された、許可されたセレクターは`en`、`ar`、`es`、`fr`、`ja`、`ko`、`vi`、`zh-Hans`、`zh-Hant`、`de`、`ru`をサポートします。すべてのロケールには同じ409の明示的メッセージキーと同じ補間プレースホルダーがあります。文書の言語は選択に従い、アラビア語はページを右から左へのレイアウトに切り替えます。

安定したインターフェースコピーと既知の決定論的ルールの失敗はローカライズされています。未知のエンジンやモデルの文章はそのまま残り、その証拠の出所を保持します。クライアントは未レビューの翻訳を正確なGoの事実として提示することはありません。

## アーキテクチャ

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

プライベートノート、資格情報、データベース、ブラウザプロファイル、ダウンロードされたモデル、チューニングキャッシュ、および生成されたランタイム証拠は無視され、Gitの外にあります。

## 開発と検証

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

ブラウザ向けの変更には、デスクトップおよびモバイル幅での専用のループバックnoVNC/CDPデスクトップチェック、スクリーンショット、および予期しないコンソールやネットワークエラーがゼロであることが追加で必要です。

## 引用

Path of Influenceを教育や研究に使用する場合は、リポジトリを引用してください。GitHubは[CITATION.cff](../CITATION.cff)を読み、リポジトリページに**このリポジトリを引用する**パネルを表示します。

```bibtex
@software{chen_path_of_influence_2026,
  author = {Chen, Lachlan},
  title = {Path of Influence: A Local-First Weiqi Teaching Journey},
  year = {2026},
  version = {0.1.0},
  url = {https://github.com/lachlanchen/LazyWeiqi}
}
```

## ステータスと範囲

これは、アクティブに開発中の生産教育アプリケーションであり、使い捨てのボードゲームデモではありません。ソースはMITライセンスであり、KataGoおよびダウンロードされたネットワークはその上流ライセンスを保持し、ここにコミットされることはありません。現在のデフォルトは9×9であり、13×13および19×19は別途予算が組まれた計画として残っています。
