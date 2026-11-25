# Лад ВлГУ — финальный аудит и тестирование (исходный репозиторий + прод)

**Объект:** https://germanpolkin.ru/lad-vlsu/  
**Репозиторий:** `plugin-browser-openai-bundled-build-web` (lad-vlsu)  
**Дата:** 25.11.2026  
**Release прод:** `9859da8` (meta `lad-release` в index.html)  
**Коммит репо:** `9859da820`  
**Локальная сборка:** `lad-release` `202611251337` (vite, без `GITHUB_SHA`)

**Метод:** Vitest (583), production build, `node --check public/sw.js`, Playwright QA на `vite preview`, полный HEAD-скан 739 schedule, HTTP-аудит прода, smoke в браузере на germanpolkin.ru.

**Артефакты:** `lad-bugs-master.json`, `Лад-ВлГУ-финальный-аудит-и-тестирование.docx` (пересборка: `python build-lad-word-report.py`).

---

## 1. Краткий итог

| Направление | Оценка | Статус |
|-------------|--------|--------|
| Код и регрессии (Vitest) | 10 / 10 | **583/583 Pass** |
| Сборка | 9 / 10 | **Pass**; цепочка `pnpm run check` на Windows нестабильна |
| Статические данные на проде | 9.5 / 10 | **739/739** schedule, JSON валиден |
| Деплой API на origin PWA | 2 / 10 | **`/vlsu-api` и `/app-api` → 404** на germanpolkin.ru |
| Реализация API в репо | 9 / 10 | `functions/vlsu-api`, vite proxy — **Pass на :4173** |
| Live refresh (Worker) | 5 / 10 | workers.dev работает; риск **устаревшего cached** |
| PWA / offline | 8 / 10 | SW, manifest — OK |
| Доступность (прод) | 6.5 / 10 | h1 «ПИ -124», zoom, контраст табов |
| Визуал и UX (общее) | 8.2 / 10 | Сильный дизайн |
| **Масштаб / laptop desktop** | **6 / 10** | **LAD-VIS-01…03** — колонки «Сегодня», ширина «Недели» |
| Масштаб страницы (pinch-zoom) | 4 / 10 | `user-scalable=no` (LAD-009) |

**Главный вывод:** продукт **готов по коду и статике**, но **инфраструктура публикации не подключает** serverless-прокси с ВлГУ. Исправление — не столько фронтенд, сколько **маршрутизация домена** (Cloudflare Pages Functions / Worker с assets / reverse proxy).

---

## 2. Что проверено в репозитории

### 2.1. Автотесты

- `pnpm run test` — 67 файлов, **583 теста**, 0 failures (логика расписания, SW, snapshot, PDF/reviewed, worker).
- `pnpm run build` — `tsc --noEmit` + vite, dist собран (~14.8 s).
- `node --check public/sw.js` — синтаксис OK.

### 2.2. Playwright (preview `http://127.0.0.1:4173/`)

| Скрипт | Результат |
|--------|-----------|
| `qa-lesson-selection.cjs` | **Pass** (402, 430, 1440) |
| `qa-university-cache-race.cjs` | **Pass** |
| `qa-desktop-layout.cjs` (390×844) | **Pass**, без horizontal overflow |
| `qa-desktop-layout.cjs` (1024–1920 laptop) | **Fail** — геометрия Today (LAD-VIS-03) |
| `measure-viewport-layout.mjs` | Laptop: Today gap, Week width (см. §6) |
| `qa-study-periods.cjs` | **Partial** — 1 кейс, затем crash Edge headless |
| `qa-group-startup.cjs` | **Partial** — сценарии до crash |
| Полный desktop 26 viewport | **Не запускался** (время + стабильность браузера) |

На Windows Playwright периодически падает с `Target crashed` / exit `3221225477` — в CI ожидается стабильность на `ubuntu-latest` (см. REP-003).

### 2.3. HTTP прод

| Проверка | Результат |
|----------|-----------|
| `coverage.json` → HEAD `schedule/{id}.json` × 739 | **739/739 = 200** |
| `catalog.json`, `quality.json` | 200, 14 институтов, missing=225 |
| `university-schedule.json` | 200, **3 466 338 B** (~3.47 MB) |
| `https://germanpolkin.ru/vlsu-api/...` | **404 HTML** |
| `https://germanpolkin.ru/app-api/health` | **404** |
| `http://127.0.0.1:4173/vlsu-api/catalogs/GetInstitutes` | **200 JSON** (14 институтов) |

---

## 3. Smoke на проде (браузер)

- Группа **ПИ-124**, вкладка «Сегодня» — пары, неделя, навигация **OK**.
- **LAD-007 подтверждён:** accessibility `heading` **«ПИ -124»** (лишний пробел в accessible name).
- Кнопка «Обновить расписание» — без падения UI (live-цепочка см. LAD-001…004).

---

## 4. Реестр дефектов

Полный список с деталями: **`lad-bugs-master.json`** (24× LAD, 4× REP).

### Critical (P0)

| ID | Суть |
|----|------|
| LAD-001 | `/vlsu-api` на germanpolkin.ru → 404 |
| LAD-002 | `/app-api/schedule` на том же домене → 404 |
| LAD-024 | **В репозитории прокси есть, на проде не развёрнут** |

### High (выборка)

| ID | Суть |
|----|------|
| LAD-003 | Refresh через workers.dev (имя worker misleading) |
| LAD-004 | cached worker старше static для ПИ-124 |
| LAD-006 | 225/964 групп без снимка |
| LAD-007 | a11y h1 «ПИ -124» |
| LAD-008 | Контраст active nav ~1:1 |

Остальные LAD-009…023 — a11y, UX, perf, PWA shortcuts (из согласованного реестра утреннего аудита + LAD-023 обновлён сканом 739/739).

---

## 6. Визуальное масштабирование и ноутбуки

Проверка: `measure-viewport-layout.mjs` (7 размеров × вкладки Сегодня/Неделя), `qa-desktop-layout.cjs`.

| ID | Проблема | Где проявляется |
|----|-----------|-----------------|
| **LAD-VIS-01** | ~~Правая колонка перекрывала summary~~ — **исправлено** (`max-height` + scroll в detail), gap ≤82 px на preview | Закрыто на preview 25.11 вечер |
| **LAD-VIS-02** | ~~Ширина week-overview~~ — **исправлено** (`max-width: 100%`, `overflow-x: clip`) | Закрыто на preview |
| **LAD-VIS-03** | ~~qa-desktop-layout fail~~ — **Pass** полный прогон на `127.0.0.1:4173` | Закрыто на preview |

Горизонтального scroll у `document` нет — баги **внутри сетки**, не полоса прокрутки всей страницы.

Декоративные `.data-route-*` за краем экрана — анимация фона; отдельно от контента расписания.

**Pinch-zoom:** LAD-009 **закрыт** — `maximum-scale=5`, без `user-scalable=no`.

**Волна A (preview):** vitest, build, desktop QA — Pass. **Прод GitHub Pages:** только статика + `data/` (без workers.dev и без same-origin `/vlsu-api`; live API — dev/preview или опциональный Worker).

---

## 7. Исправления до прода: что реально

Подробный gate: **`PRE-PROD-RELEASE-GATE.md`**.

| Можно сделать **в репо** и прогнать на **preview** без публикации | Нужен **ваш деплой** / отдельный цикл |
|----------------------------------------------------------------|----------------------------------------|
| LAD-VIS-01…03, LAD-007…016, часть LAD-003/004/022 (логика) | LAD-001, 002, 024 (`/vlsu-api`, `/app-api` на germanpolkin) |
| Vitest + Playwright + measure-viewport | LAD-006 (225 групп), LAD-017 (3.5 MB), LAD-018 (CSP) |

**Ответ на «исправить все баги без прода»:**  
- **Пакет UI + desktop + a11y + refresh в коде** — да: правки → `pnpm test` / `build` → `preview` → QA-скрипты → вы отдаёте отчёт «gate OK».  
- **Весь реестр LAD (включая live API на проде и покрытие данных)** — нет: без деплоя прокси critical останутся на старом germanpolkin, даже если локально всё зелёное.

**Предлагаемый порядок:** волна A (VIS + a11y) → локальный полный прогон → выкат статики/PWA → волна B (прокси) → повтор HTTP-аудита → при OK считать релиз принятым.

---

## 8. Следующие шаги

1. **Волна A (код):** LAD-VIS-01…03, LAD-007…010, LAD-013…016.
2. **Gate:** чек-лист в `PRE-PROD-RELEASE-GATE.md`.
3. **Выкладка:** по вашему разрешению — Pages/домен.
4. **Волна B:** деплой `/vlsu-api` (LAD-024), проверка `lad-full-bug-audit.mjs`.
5. **Данные:** roadmap — missing 225 групп.

---

*Отчёт обновлён 25.11.2026 (§6–7 — масштаб/ноутбуки и план до прода). Исправления кода в этой итерации ещё не начинались.*