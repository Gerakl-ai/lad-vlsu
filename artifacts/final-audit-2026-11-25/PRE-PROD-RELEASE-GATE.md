# Контрольный прогон до выкладки в прод

Цель: собрать исправления **локально**, прогнать тесты на **preview/staging**, только после этого — публикация на germanpolkin.ru / GitHub Pages.

## Что можно закрыть без доступа к прод-хостингу

| Класс | ID (примеры) | Где чинится | Как проверить до прода |
|-------|----------------|-------------|-------------------------|
| **Вёрстка desktop/ноутбук** | LAD-VIS-01…03 | `src/styles.css`, разметка Today/Week | `qa-desktop-layout.cjs`, `measure-viewport-layout.mjs`, preview |
| **A11y UI** | LAD-007…012, 009 | `App.tsx`, `index.html`, темы | Vitest + Playwright + ручной a11y-tree |
| **UX** | LAD-013…016, 015 | `App.tsx`, роутинг URL | Playwright smoke |
| **Refresh logic** | LAD-003, 004, 022 | `scheduleUpdate.ts`, `worker.ts` | Vitest + preview Network + unit worker |
| **Данные (частично)** | LAD-006 | pipeline snapshot, не hotfix | `quality.json` после snapshot, не блокер одного UI-релиза |

## Что не станет «исправлено на проде» только кодом в репо

| Класс | ID | Почему |
|-------|-----|--------|
| **Прокси на origin** | LAD-001, 002, 024 | Нужен **деплой** (CF Worker/Pages, правила сайта). На preview прокси **уже работает** (vite). |
| **CSP/HSTS** | LAD-018 | Заголовки хостинга GH Pages |
| **225 групп без снимка** | LAD-006 | Контент/сбор данных, отдельный цикл |
| **3.5 MB university-schedule** | LAD-017 | Архитектура пакета данных |

**Решение владельца (25.11 вечер):** прод = **только GitHub Pages**. LAD-001/002/024 **не в gate** — live API не обещаем; данные из `data/`. В `pages.yml` **нет** `VITE_SCHEDULE_FALLBACK_URL`.

## Чек-лист перед выкладкой (release gate)

```text
1. pnpm run test          → 583/583 (или актуальный счёт)
2. pnpm run build         → dist без ошибок
3. node --check public/sw.js
4. pnpm preview           → фон на :4173
5. QA_URL=http://127.0.0.1:4173/ node scripts/qa-desktop-layout.cjs   # laptop must pass
6. node artifacts/final-audit-2026-11-25/measure-viewport-layout.mjs  # exit 0
7. node scripts/qa-lesson-selection.cjs
8. node scripts/qa-group-startup.cjs   # желательно на ubuntu CI
9. После деплоя: `lad-full-bug-audit.mjs` → 0 Critical/High (ожидаемы Low: missing groups, CSP)
10. На проде: meta `lad-release` = ожидаемый SHA, smoke ПИ-124, DevTools без красных ошибок SW preload
```

## Рекомендуемые волны работ

**Волна A (до прода UI, только репо):** LAD-VIS-01…03, LAD-007…010, LAD-013…016 — затем полный прогон п.1–8.

**Волна B (опционально):** Cloudflare Worker — только если снова понадобится live API (workflow `cloudflare-worker.yml`, вручную).

**Данные:** ветка `data` + snapshot workflow — основной путь свежести расписания.

## Ответ на вопрос «исправить всё без прода?»

- **Да, для UI/a11y/desktop и логики refresh** — можно: правки → preview → автотесты → ваш деплой статики/PWA.
- **Нет, для полного закрытия реестра LAD** — без **вашей** выкладки прокси и без работы над данными (225 missing, 3.5 MB bundle) «всё» не сойдётся.
- **Рациональный план:** волна A + gate → выкат → волна B/C → повторный аудит (`build-lad-word-report.py`).

*Обновлено: 25.11.2026*