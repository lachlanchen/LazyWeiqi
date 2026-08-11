[English](../README.md) · [العربية](README.ar.md) · [Español](README.es.md) · [Français](README.fr.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Tiếng Việt](README.vi.md) · [中文 (简体)](README.zh-Hans.md) · [中文（繁體）](README.zh-Hant.md) · [Deutsch](README.de.md) · [Русский](README.ru.md)

[![LazyingArt banner](https://github.com/lachlanchen/lachlanchen/raw/main/figs/banner.png)](https://github.com/lachlanchen/lachlanchen/blob/main/figs/banner.png)

# Path of Influence

*Изучайте Weiqi как читаемое путешествие, а не как стену необъясненных «лучших ходов».*

[![Website](https://img.shields.io/badge/Website-Lazying.Art-0EA5E9)](https://lazying.art) [![License](https://img.shields.io/badge/License-MIT-green.svg)](../LICENSE) [![GitHub Sponsors](https://img.shields.io/badge/Sponsor-lachlanchen-EA4AAA?logo=githubsponsors)](https://github.com/sponsors/lachlanchen)

Path of Influence — это локальное приложение для обучения игре в Го/Weiqi. Оно ведёт от коротких уроков 5×5 и 7×7 через полные партии 9×9 к обычной игре на полной доске 19×19 с объясняющим компаньоном, ограниченными игровыми агентами, театром агентов с повествованием и воспроизводимой хроникой. Точные правила остаются решающим источником истины, даже когда все поставщики анализа и языковых моделей недоступны.

| Donate | PayPal | Stripe |
| --- | --- | --- |
| [![Donate](https://img.shields.io/badge/Donate-LazyingArt-0EA5E9?style=for-the-badge&logo=kofi&logoColor=white)](https://chat.lazying.art/donate) | [![PayPal](https://img.shields.io/badge/PayPal-RongzhouChen-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/RongzhouChen) | [![Stripe](https://img.shields.io/badge/Stripe-Donate-635BFF?style=for-the-badge&logo=stripe&logoColor=white)](https://buy.stripe.com/aFadR8gIaflgfQV6T4fw400) |

## Предварительный просмотр приложения

![Обучающая доска Path of Influence](../docs/images/app.png)

Доска визуально отделяет точные свободы, группы, захваты, ко и законные ходы от прогнозов KataGo, интерпретации учителя, объяснения модели и метафоры.

## Обучающий контракт

- Детерминированный код отвечает за законность, захват, позиционный суперко, подсчет очков, историю и сохранение.
- KataGo предоставляет ограниченные доказательства анализа и никогда не изменяет игру.
- Player Agents выбирает только из законных идентификаторов кандидатов, ограниченных позицией, предоставленных сервером.
- Companion Agents объясняет и задает вопросы; они делают ход только после явной делегации на один ход.
- «Энергия» — это обучающая метафора с отдельно обозначенными точными, тактическими, двигательными, учительскими, модельными и метафорическими доказательствами.
- Обычные партии, включая игру на полной доске 19×19, используют заявленные китайские правила подсчёта по площади с позиционным суперко; тренировочные варианты помечены.

## Что включено

| Путь | Содержимое |
| --- | --- |
| [`apps/api/`](../apps/api/) | Авторитет FastAPI, детерминированная область Го, хроника SQLite и ограниченные адаптеры KataGo/LLM |
| [`apps/web/`](../apps/web/) | Отзывчивый клиент обучения React/Vite с 11 явными каталогами интерфейса |
| [`config/`](../config/) | Проверенная конфигурация анализа 9×9 KataGo |
| [`scripts/`](../scripts/) | Воспроизводимая настройка, верификация, выполнение и видимые элементы управления браузером |
| [`references/`](../references/) | [Архитектура и безопасность](../references/architecture-and-safety.md), [принципы обучения](../references/teaching-principles.md) и [происхождение модели](../references/model-sources.md) |

## Быстрый старт

Предварительные требования: Linux, Python 3.10+, [uv](https://docs.astral.sh/uv/), Node.js 22 и npm. KataGo является необязательным для первого запуска.

```bash
git clone https://github.com/lachlanchen/LazyWeiqi.git
cd LazyWeiqi
npm ci
uv sync --project apps/api --extra dev --locked
cp .env.example .env
scripts/run.sh start
```

Откройте `http://127.0.0.1:8010/` для компактной доски или `http://127.0.0.1:8010/full` для полного учебного вида. Остановите только процессы, принадлежащие этому репозиторию, с помощью:

```bash
scripts/run.sh stop
```

Установите закрепленный, проверенный по хешу двигатель обучения KataGo, когда требуется анализ:

```bash
scripts/setup-katago.sh --print-plan
scripts/setup-katago.sh
scripts/verify-katago.sh
```

## Интерфейс на одиннадцати языках

Селектор с сохранением и разрешением поддерживает `en`, `ar`, `es`, `fr`, `ja`, `ko`, `vi`, `zh-Hans`, `zh-Hant`, `de` и `ru`. Каждый язык имеет одинаковые 409 явных ключей сообщений и одинаковые заполнители для интерполяции. Язык документа следует выбору, а арабский переключает страницу на компоновку справа налево.

Копия стабильного интерфейса и известные детерминированные сбои правил локализованы. Неизвестный текст двигателя или модели остается без изменений и сохраняет свои доказательства происхождения; клиент никогда не представляет непроверенный перевод как точный факт Го.

## Архитектура

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

Личные заметки, учетные данные, базы данных, профили браузеров, загруженные модели, кэши настройки и сгенерированные доказательства выполнения остаются игнорируемыми и вне Git.

## Разработка и валидация

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

Изменения, касающиеся браузера, дополнительно требуют специальной проверки обратного цикла noVNC/CDP на настольных и мобильных ширинах, скриншотов и отсутствия неожиданных ошибок консоли или сети.

## Цитирование

Если вы используете Path of Influence в обучении или исследовании, укажите репозиторий. GitHub читает [CITATION.cff](../CITATION.cff) и показывает панель **Цитировать этот репозиторий** на странице репозитория.

```bibtex
@software{chen_path_of_influence_2026,
  author = {Chen, Lachlan},
  title = {Path of Influence: A Local-First Weiqi Teaching Journey},
  year = {2026},
  version = {0.1.0},
  url = {https://github.com/lachlanchen/LazyWeiqi}
}
```

## Статус и объем

Это рабочее учебное приложение в активной разработке, а не одноразовая демонстрация настольной игры. Исходный код лицензирован по MIT; KataGo и загруженные сети сохраняют свои исходные лицензии и не включаются в этот репозиторий. Учебный размер по умолчанию остаётся 9×9; обычная игра на полной доске 19×19 также поддерживается по заявленным китайским правилам подсчёта по площади с позиционным суперко.
