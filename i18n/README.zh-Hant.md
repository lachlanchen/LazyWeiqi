[English](../README.md) · [العربية](README.ar.md) · [Español](README.es.md) · [Français](README.fr.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Tiếng Việt](README.vi.md) · [中文 (简体)](README.zh-Hans.md) · [中文（繁體）](README.zh-Hant.md) · [Deutsch](README.de.md) · [Русский](README.ru.md)

[![LazyingArt banner](https://github.com/lachlanchen/lachlanchen/raw/main/figs/banner.png)](https://github.com/lachlanchen/lachlanchen/blob/main/figs/banner.png)

# Path of Influence

*將 Weiqi 視為一段可讀的旅程，而不是一堵未解釋的「最佳走法」牆。*

[![Website](https://img.shields.io/badge/Website-Lazying.Art-0EA5E9)](https://lazying.art) [![License](https://img.shields.io/badge/License-MIT-green.svg)](../LICENSE) [![GitHub Sponsors](https://img.shields.io/badge/Sponsor-lachlanchen-EA4AAA?logo=githubsponsors)](https://github.com/sponsors/lachlanchen)

Path of Influence 是一個本地優先的圍棋/Weiqi 教學應用程式。它從簡短的 5×5 和 7×7 課程出發，經由完整的 9×9 對局，進階到一般的 19×19 全棋盤對局，並配有講解型陪伴代理、受限玩家代理、敘事式代理劇場和可重播的棋局編年史。即使所有分析和語言模型服務都離線，確定性規則仍是最終依據。

| Donate | PayPal | Stripe |
| --- | --- | --- |
| [![Donate](https://img.shields.io/badge/Donate-LazyingArt-0EA5E9?style=for-the-badge&logo=kofi&logoColor=white)](https://chat.lazying.art/donate) | [![PayPal](https://img.shields.io/badge/PayPal-RongzhouChen-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/RongzhouChen) | [![Stripe](https://img.shields.io/badge/Stripe-Donate-635BFF?style=for-the-badge&logo=stripe&logoColor=white)](https://buy.stripe.com/aFadR8gIaflgfQV6T4fw400) |

## 應用程式預覽

![Path of Influence 教學棋盤](../docs/images/app.png)

棋盤將確切的自由度、棋群、吃子、劫和合法走法與 KataGo 預測、教師解釋、模型說明和隱喻視覺上分開。

在一般 19×19 序盤中，候選預覽把確切的局部棋形與計算得到的地盤潛力、外勢方向分開，再顯示人工編寫的收益與取捨、著前→著後的力量形狀、重新考慮條件、後續著、對手應手和定式（joseki／定式）背景。帶編號的小圖是要檢驗的問題，不是已經落下的棋子或強制次序。可選的深入 AI 研究把已本地化的標題與保持原文的模型正文分開，並且絕不落子。

## 教學合約

- 確定性代碼擁有合法性、吃子、位置超劫、計分、歷史和持久性。
- KataGo 提供受限的分析證據，並且從不改變遊戲。
- Player Agents 僅從伺服器提供的與位置相關的合法候選 ID 中選擇。
- Companion Agents 解釋並提出問題；他們僅在明確的一步授權後才移動。
- 「能量」是一個教學隱喻，具有分別標記的確切、戰術、引擎、教師、模型和隱喻證據。
- 一般對局（包括 19×19 全棋盤對局）採用已宣告的中國規則面積計分和位置超劫；訓練變體均有明確標記。

## 包含的內容

| 路徑 | 內容 |
| --- | --- |
| [`apps/api/`](../apps/api/) | FastAPI 權威、確定性圍棋領域、SQLite 編年史和受限的 KataGo/LLM 轉接器 |
| [`apps/web/`](../apps/web/) | 響應式 React/Vite 教學客戶端，具有 11 個明確的介面目錄 |
| [`config/`](../config/) | 已審核的 9×9 和 19×19 KataGo 分析設定 |
| [`scripts/`](../scripts/) | 可重現的設置、驗證、運行時和可見瀏覽器控制 |
| [`references/`](../references/) | [架構與安全性](../references/architecture-and-safety.md)、[教學原則](../references/teaching-principles.md) 和 [模型來源](../references/model-sources.md) |

## 快速開始

先決條件：Linux、Python 3.10+、[uv](https://docs.astral.sh/uv/)、Node.js 22 和 npm。KataGo 在首次啟動時是可選的。

```bash
git clone https://github.com/lachlanchen/LazyWeiqi.git
cd LazyWeiqi
npm ci
uv sync --project apps/api --extra dev --locked
cp .env.example .env
scripts/run.sh start
```

打開 `http://127.0.0.1:8010/` 以獲取緊湊棋盤，或 `http://127.0.0.1:8010/full` 以獲取完整學習視圖。僅停止此存儲庫擁有的進程：

```bash
scripts/run.sh stop
```

需要分析時，安裝固定且經過哈希驗證的 KataGo 教學引擎。專用 19×19 設定有單獨的已審核設定和驗證流程：

```bash
scripts/setup-katago.sh --print-plan
scripts/setup-katago.sh
scripts/verify-katago.sh
scripts/setup-katago19-models.sh
scripts/verify-katago19.sh --static-only
scripts/verify-katago19.sh
```

## 十一語言介面

持久的、允許的選擇器支持 `en`、`ar`、`es`、`fr`、`ja`、`ko`、`vi`、`zh-Hans`、`zh-Hant`、`de` 和 `ru`。每個地區都有相同的 629 個明確消息鍵和相同的插值佔位符。文件語言遵循選擇，阿拉伯語將頁面切換為從右到左的佈局。

穩定的介面副本和已知的確定性規則失敗已本地化。未知的引擎或模型文本保持逐字不變並保留其證據來源；客戶端從不將未審核的翻譯呈現為確切的圍棋事實。

## 架構

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

私人筆記、憑證、數據庫、瀏覽器配置檔、下載的模型、調整緩存和生成的運行時證據將被忽略並不在 Git 中。

## 開發與驗證

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

面向瀏覽器的變更還需要在桌面和移動寬度下進行專用的回環 noVNC/CDP 桌面檢查、截圖，以及零意外的控制台或網絡錯誤。

## 引用

如果您在教學或研究中使用 Path of Influence，請引用該存儲庫。GitHub 讀取 [CITATION.cff](../CITATION.cff) 並在存儲庫頁面上顯示 **引用此存儲庫** 面板。

```bibtex
@software{chen_path_of_influence_2026,
  author = {Chen, Lachlan},
  title = {Path of Influence: A Local-First Weiqi Teaching Journey},
  year = {2026},
  version = {0.1.0},
  url = {https://github.com/lachlanchen/LazyWeiqi}
}
```

## 狀態與範圍

這是一個正在積極開發的實用教學應用程式，而不是一次性棋盤遊戲演示。原始碼採用 MIT 授權；KataGo 和下載的網絡保留其上游授權，不會提交至此儲存庫。教學預設棋盤仍為 9×9；一般的 19×19 全棋盤對局也已支援，並採用已宣告的中國規則面積計分和位置超劫。
