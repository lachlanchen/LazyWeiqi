[English](../README.md) · [العربية](README.ar.md) · [Español](README.es.md) · [Français](README.fr.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Tiếng Việt](README.vi.md) · [中文 (简体)](README.zh-Hans.md) · [中文（繁體）](README.zh-Hant.md) · [Deutsch](README.de.md) · [Русский](README.ru.md)

[![LazyingArt banner](https://github.com/lachlanchen/lachlanchen/raw/main/figs/banner.png)](https://github.com/lachlanchen/lachlanchen/blob/main/figs/banner.png)

# Path of Influence

*将 Weiqi 视为一个可读的旅程，而不是一堵没有解释的“最佳走法”墙。*

[![Website](https://img.shields.io/badge/Website-Lazying.Art-0EA5E9)](https://lazying.art) [![License](https://img.shields.io/badge/License-MIT-green.svg)](../LICENSE) [![GitHub Sponsors](https://img.shields.io/badge/Sponsor-lachlanchen-EA4AAA?logo=githubsponsors)](https://github.com/sponsors/lachlanchen)

Path of Influence 是一个本地优先的围棋/Weiqi 教学应用。它从简短的 5×5 和 7×7 课程出发，经由完整的 9×9 对局，进阶到普通的 19×19 全棋盘对局，并配有讲解型陪伴代理、受限玩家代理、叙事式代理剧场和可重放的棋局编年史。即使所有分析和语言模型服务都离线，确定性规则仍是最终依据。

| Donate | PayPal | Stripe |
| --- | --- | --- |
| [![Donate](https://img.shields.io/badge/Donate-LazyingArt-0EA5E9?style=for-the-badge&logo=kofi&logoColor=white)](https://chat.lazying.art/donate) | [![PayPal](https://img.shields.io/badge/PayPal-RongzhouChen-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/RongzhouChen) | [![Stripe](https://img.shields.io/badge/Stripe-Donate-635BFF?style=for-the-badge&logo=stripe&logoColor=white)](https://buy.stripe.com/aFadR8gIaflgfQV6T4fw400) |

## 应用预览

![Path of Influence 教学棋盘](../docs/images/app.png)

棋盘将确切的气、棋群、提子、劫和合法走法与 KataGo 预测、教师解释、模型说明和隐喻视觉上分开。

## 教学合同

- 确定性代码拥有合法性、提子、位置超劫、计分、历史和持久性。
- KataGo 提供有限的分析证据，并且从不改变游戏。
- Player Agents 仅从服务器提供的位置绑定合法候选 ID 中选择。
- Companion Agents 解释并提出问题；它们仅在明确的一步委托后移动。
- “能量”是一个教学隐喻，具有单独标记的确切、战术、引擎、教师、模型和隐喻证据。
- 普通对局（包括 19×19 全棋盘对局）采用声明的中国规则面积计分和位置超劫；训练变体均有明确标记。

## 包含的内容

| 路径 | 内容 |
| --- | --- |
| [`apps/api/`](../apps/api/) | FastAPI 权威、确定性围棋领域、SQLite 编年史和有限的 KataGo/LLM 适配器 |
| [`apps/web/`](../apps/web/) | 响应式 React/Vite 教学客户端，具有 11 个明确的接口目录 |
| [`config/`](../config/) | 审核过的 9×9 KataGo 分析配置 |
| [`scripts/`](../scripts/) | 可重现的设置、验证、运行时和可见浏览器控制 |
| [`references/`](../references/) | [架构与安全](../references/architecture-and-safety.md)、[教学原则](../references/teaching-principles.md) 和 [模型来源](../references/model-sources.md) |

## 快速开始

先决条件：Linux、Python 3.10+、[uv](https://docs.astral.sh/uv/)、Node.js 22 和 npm。KataGo 在首次启动时是可选的。

```bash
git clone https://github.com/lachlanchen/LazyWeiqi.git
cd LazyWeiqi
npm ci
uv sync --project apps/api --extra dev --locked
cp .env.example .env
scripts/run.sh start
```

打开 `http://127.0.0.1:8010/` 以获取紧凑棋盘，或 `http://127.0.0.1:8010/full` 以获取完整学习视图。仅停止此存储库拥有的进程：

```bash
scripts/run.sh stop
```

在需要分析时安装固定的、哈希验证的 KataGo 教学引擎：

```bash
scripts/setup-katago.sh --print-plan
scripts/setup-katago.sh
scripts/verify-katago.sh
```

## 十一种语言接口

持久的、允许的选择器支持 `en`、`ar`、`es`、`fr`、`ja`、`ko`、`vi`、`zh-Hans`、`zh-Hant`、`de` 和 `ru`。每个区域都有相同的 409 个明确消息键和相同的插值占位符。文档语言遵循选择，阿拉伯语将页面切换为从右到左的布局。

稳定的接口副本和已知的确定性规则失败被本地化。未知的引擎或模型文本保持逐字不变，并保留其证据来源；客户端绝不会将未经审核的翻译呈现为确切的围棋事实。

## 架构

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

私人笔记、凭据、数据库、浏览器配置文件、下载的模型、调优缓存和生成的运行时证据保持被忽略并不在 Git 中。

## 开发与验证

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

面向浏览器的更改还需要在桌面和移动宽度下进行专用的回环 noVNC/CDP 桌面检查、屏幕截图，以及零意外控制台或网络错误。

## 引用

如果您在教学或研究中使用 Path of Influence，请引用该存储库。GitHub 阅读 [CITATION.cff](../CITATION.cff) 并在存储库页面上显示 **引用此存储库** 面板。

```bibtex
@software{chen_path_of_influence_2026,
  author = {Chen, Lachlan},
  title = {Path of Influence: A Local-First Weiqi Teaching Journey},
  year = {2026},
  version = {0.1.0},
  url = {https://github.com/lachlanchen/LazyWeiqi}
}
```

## 状态与范围

这是一个正在积极开发的实用教学应用，而不是一次性棋盘游戏演示。源代码采用 MIT 许可证；KataGo 和下载的网络保留其上游许可证，不会提交到此仓库。教学默认棋盘仍为 9×9；普通的 19×19 全棋盘对局也已受支持，并采用声明的中国规则面积计分和位置超劫。
