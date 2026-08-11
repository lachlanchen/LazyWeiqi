[English](../README.md) · [العربية](README.ar.md) · [Español](README.es.md) · [Français](README.fr.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Tiếng Việt](README.vi.md) · [中文 (简体)](README.zh-Hans.md) · [中文（繁體）](README.zh-Hant.md) · [Deutsch](README.de.md) · [Русский](README.ru.md)

[![LazyingArt banner](https://github.com/lachlanchen/lachlanchen/raw/main/figs/banner.png)](https://github.com/lachlanchen/lachlanchen/blob/main/figs/banner.png)

# Path of Influence

*Aprende Weiqi como un viaje legible, no como una pared de "mejores movimientos" sin explicación.*

[![Website](https://img.shields.io/badge/Website-Lazying.Art-0EA5E9)](https://lazying.art) [![License](https://img.shields.io/badge/License-MIT-green.svg)](../LICENSE) [![GitHub Sponsors](https://img.shields.io/badge/Sponsor-lachlanchen-EA4AAA?logo=githubsponsors)](https://github.com/sponsors/lachlanchen)

Path of Influence es una aplicación de enseñanza local-prioritaria para Go/Weiqi. Pasa de lecciones cortas de 5×5 y 7×7 a juegos completos de 9×9 con un compañero explicativo, agentes de jugador limitados, teatro de agentes narrados y una crónica reproducible. Las reglas exactas siguen siendo autoritativas incluso cuando cada análisis o proveedor de modelos de lenguaje está fuera de línea.

| Donate | PayPal | Stripe |
| --- | --- | --- |
| [![Donate](https://img.shields.io/badge/Donate-LazyingArt-0EA5E9?style=for-the-badge&logo=kofi&logoColor=white)](https://chat.lazying.art/donate) | [![PayPal](https://img.shields.io/badge/PayPal-RongzhouChen-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/RongzhouChen) | [![Stripe](https://img.shields.io/badge/Stripe-Donate-635BFF?style=for-the-badge&logo=stripe&logoColor=white)](https://buy.stripe.com/aFadR8gIaflgfQV6T4fw400) |

## Vista previa de la aplicación

![Tablero de enseñanza de Path of Influence](../docs/images/app.png)

El tablero mantiene las libertades exactas, grupos, capturas, ko y movimientos legales visualmente separados de las previsiones de KataGo, interpretación del profesor, explicación del modelo y metáfora.

## Contrato de enseñanza

- El código determinista posee legalidad, captura, superko posicional, puntuación, historia y persistencia.
- KataGo proporciona evidencia de análisis limitado y nunca muta un juego.
- Player Agents elige solo entre IDs de candidatos legales limitados por la posición suministrados por el servidor.
- Companion Agents explica y hace preguntas; se mueven solo después de una delegación explícita de un turno.
- La "energía" es una metáfora de enseñanza con evidencia exacta, táctica, de motor, del profesor, del modelo y de metáfora etiquetada por separado.
- Los juegos ordinarios utilizan reglas de área chinas declaradas; las variantes de entrenamiento están etiquetadas.

## Qué está incluido

| Ruta | Contenidos |
| --- | --- |
| [`apps/api/`](../apps/api/) | Autoridad de FastAPI, dominio determinista de Go, crónica de SQLite y adaptadores limitados de KataGo/LLM |
| [`apps/web/`](../apps/web/) | Cliente de enseñanza React/Vite responsivo con 11 catálogos de interfaz explícitos |
| [`config/`](../config/) | Configuración de análisis KataGo revisada de 9×9 |
| [`scripts/`](../scripts/) | Configuración reproducible, verificación, tiempo de ejecución y controles visibles del navegador |
| [`references/`](../references/) | [Arquitectura y seguridad](../references/architecture-and-safety.md), [principios de enseñanza](../references/teaching-principles.md) y [procedencia del modelo](../references/model-sources.md) |

## Inicio rápido

Requisitos previos: Linux, Python 3.10+, [uv](https://docs.astral.sh/uv/), Node.js 22 y npm. KataGo es opcional para el primer lanzamiento.

```bash
git clone https://github.com/lachlanchen/LazyWeiqi.git
cd LazyWeiqi
npm ci
uv sync --project apps/api --extra dev --locked
cp .env.example .env
scripts/run.sh start
```

Abre `http://127.0.0.1:8010/` para el tablero compacto o `http://127.0.0.1:8010/full` para la vista de aprendizaje completa. Detén solo los procesos de este repositorio con:

```bash
scripts/run.sh stop
```

Instala el motor de enseñanza KataGo verificado por hash cuando se necesite análisis:

```bash
scripts/setup-katago.sh --print-plan
scripts/setup-katago.sh
scripts/verify-katago.sh
```

## Interfaz de once idiomas

El selector persistente y en lista blanca admite `en`, `ar`, `es`, `fr`, `ja`, `ko`, `vi`, `zh-Hans`, `zh-Hant`, `de` y `ru`. Cada localidad tiene las mismas 409 claves de mensaje explícitas y los mismos marcadores de interpolación. El idioma del documento sigue la selección, y el árabe cambia la página a un diseño de derecha a izquierda.

Copia de interfaz estable y fallos de regla determinista conocidos están localizados. La prosa de motor o modelo desconocida permanece textual y conserva su procedencia de evidencia; el cliente nunca presenta una traducción no revisada como un hecho exacto de Go.

## Arquitectura

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

Notas privadas, credenciales, bases de datos, perfiles de navegador, modelos descargados, cachés de ajuste y evidencia de tiempo de ejecución generada permanecen ignorados y fuera de Git.

## Desarrollo y validación

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

Los cambios visibles en el navegador requieren además la verificación de bucle de retroalimentación dedicada noVNC/CDP en anchos de escritorio y móvil, capturas de pantalla y cero errores inesperados en la consola o red.

## Citación

Si usas Path of Influence en enseñanza o investigación, cita el repositorio. GitHub lee [CITATION.cff](../CITATION.cff) y muestra un panel de **Citar este repositorio** en la página del repositorio.

```bibtex
@software{chen_path_of_influence_2026,
  author = {Chen, Lachlan},
  title = {Path of Influence: A Local-First Weiqi Teaching Journey},
  year = {2026},
  version = {0.1.0},
  url = {https://github.com/lachlanchen/LazyWeiqi}
}
```

## Estado y alcance

Esta es una aplicación de enseñanza en producción bajo desarrollo activo, no una demostración desechable de juego de mesa. La fuente tiene licencia MIT; KataGo y redes descargadas mantienen sus licencias upstream y no están comprometidas aquí. El predeterminado actual es 9×9, mientras que 13×13 y 19×19 permanecen planificados, puentes presupuestados por separado.
