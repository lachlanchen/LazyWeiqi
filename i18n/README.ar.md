[English](../README.md) · [العربية](README.ar.md) · [Español](README.es.md) · [Français](README.fr.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Tiếng Việt](README.vi.md) · [中文 (简体)](README.zh-Hans.md) · [中文（繁體）](README.zh-Hant.md) · [Deutsch](README.de.md) · [Русский](README.ru.md)

[![LazyingArt banner](https://github.com/lachlanchen/lachlanchen/raw/main/figs/banner.png)](https://github.com/lachlanchen/lachlanchen/blob/main/figs/banner.png)

# Path of Influence

*تعلم Weiqi كرحلة قابلة للقراءة، وليس كحائط من "أفضل الحركات" غير المفسرة.*

[![Website](https://img.shields.io/badge/Website-Lazying.Art-0EA5E9)](https://lazying.art) [![License](https://img.shields.io/badge/License-MIT-green.svg)](../LICENSE) [![GitHub Sponsors](https://img.shields.io/badge/Sponsor-lachlanchen-EA4AAA?logo=githubsponsors)](https://github.com/sponsors/lachlanchen)

Path of Influence هو تطبيق تعليمي محلي أولاً للعبة Go/Weiqi. ينتقل من دروس قصيرة 5×5 و7×7 إلى ألعاب كاملة 9×9 مع رفيق توضيحي، وعوامل لاعبين محدودة، ومسرح وكيل مُروى، وسجل قابل لإعادة التشغيل. تبقى القواعد الدقيقة موثوقة حتى عندما يكون كل مزود تحليل أو نموذج لغوي غير متصل بالإنترنت.

| Donate | PayPal | Stripe |
| --- | --- | --- |
| [![Donate](https://img.shields.io/badge/Donate-LazyingArt-0EA5E9?style=for-the-badge&logo=kofi&logoColor=white)](https://chat.lazying.art/donate) | [![PayPal](https://img.shields.io/badge/PayPal-RongzhouChen-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/RongzhouChen) | [![Stripe](https://img.shields.io/badge/Stripe-Donate-635BFF?style=for-the-badge&logo=stripe&logoColor=white)](https://buy.stripe.com/aFadR8gIaflgfQV6T4fw400) |

## معاينة التطبيق

![لوحة تعليم Path of Influence](../docs/images/app.png)

تحافظ اللوحة على الحريات الدقيقة، والمجموعات، والالتقاطات، والكو، والحركات القانونية بشكل منفصل بصريًا عن توقعات KataGo، وتفسير المعلم، وتفسير النموذج، والاستعارة.

## عقد التعليم

- الشفرة الحتمية تمتلك القانونية، والالتقاط، والسوبركو الموضعي، والتسجيل، والتاريخ، والاستمرارية.
- يوفر KataGo أدلة تحليل محدودة ولا يغير اللعبة أبدًا.
- Player Agents تختار فقط من معرفات المرشحين القانونية المرتبطة بالموقع التي يوفرها الخادم.
- Companion Agents تشرح وتطرح أسئلة؛ تتحرك فقط بعد تفويض صريح لدور واحد.
- "الطاقة" هي استعارة تعليمية مع أدلة دقيقة، وتكتيكية، ومحرك، ومعلم، ونموذج، واستعارة مُعلمة بشكل منفصل.
- تستخدم الألعاب العادية قواعد المنطقة الصينية المعلنة؛ يتم تصنيف متغيرات التدريب.

## ما هو مدرج

| مسار | المحتويات |
| --- | --- |
| [`apps/api/`](../apps/api/) | سلطة FastAPI، مجال Go الحتمي، سجل SQLite، ومحولات KataGo/LLM المحدودة |
| [`apps/web/`](../apps/web/) | عميل تعليم React/Vite المتجاوب مع 11 كتالوج واجهة صريح |
| [`config/`](../config/) | تكوين تحليل KataGo 9×9 المراجع |
| [`scripts/`](../scripts/) | إعداد قابل للتكرار، والتحقق، والتشغيل، وعناصر التحكم في المتصفح المرئي |
| [`references/`](../references/) | [الهندسة المعمارية والسلامة](../references/architecture-and-safety.md)، [مبادئ التعليم](../references/teaching-principles.md)، و[أصل النموذج](../references/model-sources.md) |

## بدء سريع

المتطلبات المسبقة: لينكس، بايثون 3.10+، [uv](https://docs.astral.sh/uv/)، Node.js 22، وnpm. KataGo اختياري للإطلاق الأول.

```bash
git clone https://github.com/lachlanchen/LazyWeiqi.git
cd LazyWeiqi
npm ci
uv sync --project apps/api --extra dev --locked
cp .env.example .env
scripts/run.sh start
```

افتح `http://127.0.0.1:8010/` للوحة المدمجة أو `http://127.0.0.1:8010/full` لعرض التعلم الكامل. توقف فقط عن العمليات المملوكة لهذا المستودع باستخدام:

```bash
scripts/run.sh stop
```

قم بتثبيت محرك التعليم KataGo المثبت، والمحقق من التجزئة عندما تكون التحليلات مطلوبة:

```bash
scripts/setup-katago.sh --print-plan
scripts/setup-katago.sh
scripts/verify-katago.sh
```

## واجهة متعددة اللغات

يدعم المحدد المدعوم، والمسموح به `en`، `ar`، `es`، `fr`، `ja`، `ko`، `vi`، `zh-Hans`، `zh-Hant`، `de`، و`ru`. كل لغة محلية لديها نفس 409 مفتاح رسالة صريح ونفس عناصر الاستبدال. تتبع لغة الوثيقة الاختيار، وتبدل العربية الصفحة إلى تخطيط من اليمين إلى اليسار.

نسخة واجهة مستقرة وفشل القواعد الحتمية المعروفة محلية. تظل النثرات غير المعروفة للمحرك أو النموذج كما هي وتحافظ على أصل أدلتها؛ لا يقدم العميل أبدًا ترجمة غير مراجعة كحقيقة دقيقة في Go.

## الهندسة المعمارية

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

تظل الملاحظات الخاصة، والاعتمادات، وقواعد البيانات، وملفات تعريف المتصفح، والنماذج التي تم تنزيلها، وذاكرات الضبط، وأدلة وقت التشغيل المولدة غير مُعالجة وخارج Git.

## التطوير والتحقق

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

تتطلب التغييرات الموجهة للمتصفح أيضًا فحص حلقة العودة المخصصة noVNC/CDP على عرض سطح المكتب والجوال، ولقطات الشاشة، وعدم وجود أخطاء غير متوقعة في وحدة التحكم أو الشبكة.

## الاستشهاد

إذا كنت تستخدم Path of Influence في التعليم أو البحث، استشهد بالمستودع. يقرأ GitHub [CITATION.cff](../CITATION.cff) ويظهر لوحة **استشهد بهذا المستودع** على صفحة المستودع.

```bibtex
@software{chen_path_of_influence_2026,
  author = {Chen, Lachlan},
  title = {Path of Influence: A Local-First Weiqi Teaching Journey},
  year = {2026},
  version = {0.1.0},
  url = {https://github.com/lachlanchen/LazyWeiqi}
}
```

## الحالة والنطاق

هذا تطبيق تعليمي إنتاجي تحت التطوير النشط، وليس عرضًا تجريبيًا للعبة لوحية يمكن التخلص منها. المصدر مرخص بموجب MIT؛ يحتفظ KataGo والشبكات التي تم تنزيلها بتراخيصها الأصلية ولا يتم الالتزام بها هنا. الإعداد الافتراضي الحالي هو 9×9، بينما تظل 13×13 و19×19 مخططة، وجسور مخصصة بشكل منفصل.
