[English](../README.md) · [العربية](README.ar.md) · [Español](README.es.md) · [Français](README.fr.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Tiếng Việt](README.vi.md) · [中文 (简体)](README.zh-Hans.md) · [中文（繁體）](README.zh-Hant.md) · [Deutsch](README.de.md) · [Русский](README.ru.md)

[![LazyingArt banner](https://github.com/lachlanchen/lachlanchen/raw/main/figs/banner.png)](https://github.com/lachlanchen/lachlanchen/blob/main/figs/banner.png)

# Path of Influence

*Weiqi를 설명이 없는 "최고의 수"의 벽이 아닌 읽을 수 있는 여정으로 배우세요.*

[![Website](https://img.shields.io/badge/Website-Lazying.Art-0EA5E9)](https://lazying.art) [![License](https://img.shields.io/badge/License-MIT-green.svg)](../LICENSE) [![GitHub Sponsors](https://img.shields.io/badge/Sponsor-lachlanchen-EA4AAA?logo=githubsponsors)](https://github.com/sponsors/lachlanchen)

Path of Influence는 Go/Weiqi를 위한 로컬 우선 교육 애플리케이션입니다. 짧은 5×5 및 7×7 수업에서 완전한 9×9 대국을 거쳐 일반적인 19×19 전체판 대국으로 이어지며, 설명을 제공하는 동반자, 제한된 플레이어 에이전트, 내레이션이 있는 에이전트 극장, 다시 볼 수 있는 연대기를 제공합니다. 모든 분석 및 언어 모델 제공자가 오프라인이어도 정확한 규칙이 최종 기준으로 남습니다.

| Donate | PayPal | Stripe |
| --- | --- | --- |
| [![Donate](https://img.shields.io/badge/Donate-LazyingArt-0EA5E9?style=for-the-badge&logo=kofi&logoColor=white)](https://chat.lazying.art/donate) | [![PayPal](https://img.shields.io/badge/PayPal-RongzhouChen-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/RongzhouChen) | [![Stripe](https://img.shields.io/badge/Stripe-Donate-635BFF?style=for-the-badge&logo=stripe&logoColor=white)](https://buy.stripe.com/aFadR8gIaflgfQV6T4fw400) |

## 앱 미리보기

![Path of Influence 교육 보드](../docs/images/app.png)

보드는 정확한 자유도, 그룹, 포획, 코, 그리고 합법적인 수를 KataGo 예측, 교사 해석, 모델 설명, 은유와 시각적으로 분리하여 유지합니다.

일반적인 19×19 포석에서 후보 미리보기는 정확한 국소 모양을 계산된 집 가능성 및 세력 방향과 분리하고, 이어서 작성된 이득과 대가, 착수 전→후의 힘 모양, 재검토 조건, 후속 수, 상대 응수, 정석(定式) 맥락을 보여 줍니다. 번호가 붙은 미니 다이어그램은 검토할 질문이지 이미 놓인 돌이나 강제 수순이 아닙니다. 선택형 심층 AI 연구는 번역된 제목을 모델 원문과 분리하며 돌을 놓지 않습니다.

## 교육 계약

- 결정론적 코드는 합법성, 포획, 위치적 슈퍼코, 점수, 역사 및 지속성을 소유합니다.
- KataGo는 제한된 분석 증거를 제공하며 게임을 변형하지 않습니다.
- Player Agents는 서버에서 제공하는 위치 제한 합법 후보 ID 중에서만 선택합니다.
- Companion Agents는 설명하고 질문을 하며, 명시적인 1턴 위임 후에만 이동합니다.
- "에너지"는 정확한, 전술적, 엔진, 교사, 모델 및 은유 증거가 별도로 레이블이 붙은 교육 은유입니다.
- 19×19 전체판 대국을 포함한 일반 대국은 명시된 중국식 면적 계가 규칙과 위치적 슈퍼코를 사용하며, 훈련 변형에는 레이블이 붙습니다.

## 포함된 내용

| 경로 | 목차 |
| --- | --- |
| [`apps/api/`](../apps/api/) | FastAPI 권한, 결정론적 Go 도메인, SQLite 연대기 및 제한된 KataGo/LLM 어댑터 |
| [`apps/web/`](../apps/web/) | 11개의 명시적 인터페이스 카탈로그가 있는 반응형 React/Vite 교육 클라이언트 |
| [`config/`](../config/) | 검토된 9×9 및 19×19 KataGo 분석 구성 |
| [`scripts/`](../scripts/) | 재현 가능한 설정, 검증, 런타임 및 가시 브라우저 제어 |
| [`references/`](../references/) | [아키텍처 및 안전성](../references/architecture-and-safety.md), [교육 원칙](../references/teaching-principles.md), 및 [모델 출처](../references/model-sources.md) |

## 빠른 시작

필수 조건: Linux, Python 3.10+, [uv](https://docs.astral.sh/uv/), Node.js 22 및 npm. KataGo는 첫 번째 실행 시 선택 사항입니다.

```bash
git clone https://github.com/lachlanchen/LazyWeiqi.git
cd LazyWeiqi
npm ci
uv sync --project apps/api --extra dev --locked
cp .env.example .env
scripts/run.sh start
```

압축된 보드를 위해 `http://127.0.0.1:8010/`를 열거나, 완전한 학습 보기를 위해 `http://127.0.0.1:8010/full`를 엽니다. 다음 명령으로 이 리포지토리의 소유 프로세스만 중지합니다:

```bash
scripts/run.sh stop
```

분석이 필요할 때 고정되고 해시 검증된 KataGo 교육 엔진을 설치합니다. 전용 19×19 설정에는 별도의 검토된 구성과 검증 절차가 있습니다:

```bash
scripts/setup-katago.sh --print-plan
scripts/setup-katago.sh
scripts/verify-katago.sh
scripts/setup-katago19-models.sh
scripts/verify-katago19.sh --static-only
scripts/verify-katago19.sh
```

## 11개 언어 인터페이스

지속된, 허용된 선택기는 `en`, `ar`, `es`, `fr`, `ja`, `ko`, `vi`, `zh-Hans`, `zh-Hant`, `de` 및 `ru`를 지원합니다. 모든 로케일은 동일한 629개의 명시적 메시지 키와 동일한 보간 플레이스홀더를 가지고 있습니다. 문서 언어는 선택에 따라 달라지며, 아랍어는 페이지를 오른쪽에서 왼쪽으로 레이아웃으로 전환합니다.

안정적인 인터페이스 복사본과 알려진 결정론적 규칙 실패는 지역화됩니다. 알려지지 않은 엔진이나 모델 문장은 그대로 유지되며 그 증거 출처를 보존합니다; 클라이언트는 검토되지 않은 번역을 정확한 Go 사실로 제시하지 않습니다.

## 아키텍처

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

개인 메모, 자격 증명, 데이터베이스, 브라우저 프로필, 다운로드된 모델, 조정 캐시 및 생성된 런타임 증거는 무시되고 Git에서 제외됩니다.

## 개발 및 검증

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

브라우저에 표시되는 변경 사항은 추가로 데스크탑 및 모바일 너비에서 전용 루프백 noVNC/CDP 데스크탑 검사를 요구하며, 스크린샷 및 예기치 않은 콘솔 또는 네트워크 오류가 없어야 합니다.

## 인용

교육이나 연구에 Path of Influence를 사용하면 리포지토리를 인용하세요. GitHub는 [CITATION.cff](../CITATION.cff)를 읽고 리포지토리 페이지에 **이 리포지토리를 인용하세요** 패널을 표시합니다.

```bibtex
@software{chen_path_of_influence_2026,
  author = {Chen, Lachlan},
  title = {Path of Influence: A Local-First Weiqi Teaching Journey},
  year = {2026},
  version = {0.1.0},
  url = {https://github.com/lachlanchen/LazyWeiqi}
}
```

## 상태 및 범위

이것은 활발히 개발 중인 실사용 교육 애플리케이션이며, 일회용 보드 게임 데모가 아닙니다. 소스는 MIT 라이선스이며, KataGo 및 다운로드한 네트워크는 원래 라이선스를 유지하고 이 저장소에는 커밋되지 않습니다. 교육 기본 크기는 계속 9×9이며, 일반적인 19×19 전체판 대국도 명시된 중국식 면적 계가 규칙과 위치적 슈퍼코 아래 지원됩니다.
