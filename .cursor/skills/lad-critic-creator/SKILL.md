---
name: lad-critic-creator
description: >-
  Двухролевой цикл «Критик → Креатор → Исполнитель» для Лад ВлГУ: серьёзные
  фичи, UI/data/SW, аудит, документация, /goal, релиз. Критик ищет
  контрпримеры и слабые доказательства; креатор планирует измеримые шаги;
  исполнитель правит код и прогоняет gate. Use when /goal, release, audit,
  large diff, or changes under src/styles, schedule data path, public/sw.js,
  Playwright QA scripts, artifacts/final-audit.
---

# Лад ВлГУ: Критик и Креатор

**Базовый процесс:** personal skill **`critic-creator-core`** (любой репозиторий).  
Ниже — **overlay** только для Лад ВлГУ (gate, viewport, data, прод).

## Когда включать (все условия — «да» для серьёзного шага)

Включай цикл, если **хотя бы одно**:

- Пользователь: `/goal`, «релиз», «аудит», «на прод», «фича», «документация на сдачу»
- Затронуты: `src/styles.css`, неделя/today UI, `scheduleApi`, `public/sw.js`, `data/`, QA-скрипты, gate-доки
- Дифф **> ~80 строк** или меняется поведение для студента (данные, офлайн, вёрстка)

**Не включай** на: typos, однострочные правки, чистый ответ «как работает», рефакторинг без смены UX/данных.

## Роли (разделение обязанно)

| Роль | Может | Не может |
|------|--------|----------|
| **Критик** | Спорить, ломать гипотезы, требовать evidence, перечислить регрессии | Писать патчи, смягчать критерии «готово», деплоить |
| **Креатор** | 1–3 следующих шага, критерии готовности, trade-offs | Игнорировать blockers критика, раздувать scope |
| **Исполнитель** (основной агент) | Код, тесты, деплой по правилам репо, журнал | Закрывать goal без доказательств |

## Цикл (макс. 2 раунда критика)

Сначала **`critic-creator-core`**: goal из `GOAL-TEMPLATE.md` (personal store), обязателен **Impact pass** перед критиком.

1. **Креатор (коротко)** — цель, measurable «готово», gate-команды из таблицы ниже, **радиус влияния** (см. чеклист LAD ниже).
2. **Исполнитель** — изменения + соразмерные проверки (`AGENTS.md`).
3. **Impact pass** — хотя бы 1 смежный сценарий **кроме** главного gate (напр. правили «Неделю» → смотри «Сегодня» или навигацию).
4. **Критик** — отчёт по шаблону + `### Impact pass gaps`.
5. **Исполнитель** — blockers + обоснованные major.
6. **Критик** — повтор (раунд 2); если blockers остались → явно остановиться, не врать «готово».

### LAD: смежное по умолчанию (выбери из goal 2–4 пункта)

| Меняли | Типичный смежный impact |
|--------|-------------------------|
| `styles.css` / week | Сегодня, сайдбар, 1920 + 2560 + 3440, карта нагрузки |
| `styles.css` / today | Неделя, freshness-banner, нижняя навигация |
| `scheduleApi` / data | выбор пары по слоту, study periods, пустой API ≠ «нет пар» |
| `public/sw.js` | offline reload, controller, кэш после hard refresh |
| QA scripts | прогнать **не только** изменённый скрипт, но measure или layout единым контуром |

### Subagent: когда вызывать Task

- **Критик отдельным субагентом** — дифф > 200 строк, UI+data в одном PR, релиз, спорное решение (breakpoint, кэш, SW).
- Промпт субагента: `Task` description = `LAD Critic review`, тело:

  ```
  Full Repository Path: <abs path>
  Diff: branch changes OR uncommitted changes
  Custom Instructions: You are the Critic only. Do not edit files. Output:
  ## Blockers / ## Major / ## Minor / ## Missing evidence
  Each item: claim → why it fails → what evidence would prove fix.
  Domain: LAD VlSU PWA — empty API ≠ no lessons; week selection by slot; prod vs preview; 1920/2560/3440 viewports; time-grid only ≥3440px.
  ```

- **Креатор субагент** — только если критик выдал ≥2 blockers и нужен выбор стратегии (не для мелочей).

Для мелких серьёзных правок достаточно **встроенного** критика (отдельная секция в ответе, без Task).

## Gate по типу изменения

Перед `UpdateGoal complete` или заявлением «на проде ок»:

| Путь / тема | Обязательный минимум |
|-------------|----------------------|
| `src/styles.css`, week/today UI | `npm run build`, `node artifacts/final-audit-2026-11-25/measure-viewport-layout.mjs` (preview **и** prod при деплое), `scripts/qa-desktop-layout.cjs`, `scripts/qa-desktop-surfaces.cjs` |
| `scheduleApi`, data fixtures | `pnpm test` / vitest по затронутым, `scripts/qa-study-periods.cjs`, `qa-lesson-selection.cjs` при логике недели |
| `public/sw.js` | `node --check public/sw.js`, офлайн-сценарий из `AGENTS.md` |
| Аудит / release docs | Сверка SHA/CI; **anti-ai-slop** + `lint-text.cjs` на изменённые md (strict, без → и §) |
| Любой push Pages | `PRE-PROD-RELEASE-GATE.md`, smoke ПИ-124, `lad-full-bug-audit` если менялся прод-контур |

Быстрая подсказка локально: `node scripts/lad-critic-gate-preflight.cjs`

## Шаблон отчёта Критика

```markdown
## Критик (раунд N)
### Blockers
- …
### Major
- …
### Minor
- …
### Missing evidence
- …
### Что бы сломал студент
- …
```

## Шаблон ответа Креатора

```markdown
## Креатор
**Готово когда:** …
**Следующие шаги (≤3):**
1. …
**Сознательно не делаем:** …
```

## Журнал (серьёзные волны)

Добавь в `artifacts/final-audit-2026-11-25/lad-vlsu-audit-i-testirovanie.md` блок:

```markdown
### Critic→Creator (кратко)
- **Критик:** …
- **Креатор:** …
- **Evidence:** команды exit 0, commit SHA, скрин/viewport
```

## Анти-паттерны

- Закрыть goal по preview, если цель включала прод.
- Менять тест, чтобы скрыть баг (только если тест не отражал согласованный продукт).
- Time-grid на 1920–3439 (только list; grid с 3440 — см. волна D в аудите).
- Выдуманные занятия или чужие группы в данных.

## Связанные документы

- `docs/CRITIC-CREATOR-WORKFLOW.md` — для человека
- `.cursor/rules/lad-critic-creator.mdc` — напоминание агенту
- `AGENTS.md` — доказательства и QA-команды