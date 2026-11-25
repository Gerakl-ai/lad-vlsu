# Лад ВлГУ — финальный аудит и тестирование (исходный репозиторий + прод)

**Объект:** https://germanpolkin.ru/lad-vlsu/  
**Репозиторий:** `lad-vlsu` (Gerakl-ai), рабочая копия `plugin-browser-openai-bundled-build-web`  
**Дата финала:** 25.11.2026 (вечер)  
**Release прод (meta `lad-release`):** `953b049`  
**Коммит репозитория:** `953b049b2` … `f0c481c62` (волна A + static-only Pages)

**Метод:** Vitest (583+), `pnpm run build`, `node --check public/sw.js`, Playwright на preview и **проде** (`measure-viewport-layout.mjs`), `lad-full-bug-audit.mjs`, smoke в браузере (ПИ-124).

**Артефакты:** `lad-bugs-master.json`, `PRE-PROD-RELEASE-GATE.md`, Word: `python build-lad-word-report.py`.

---

## 1. Краткий итог (после волны A и static-only)

| Направление | Оценка | Статус |
|-------------|--------|--------|
| Код и регрессии (Vitest) | 10 / 10 | **588+ тестов** Pass (в т.ч. `apiOrigins`) |
| Сборка GitHub Pages | 9 / 10 | CI «Публикация на GitHub Pages» — **success** |
| Статические данные на проде | 9.5 / 10 | **739/739** schedule HEAD 200 |
| **Архитектура прод** | **9 / 10** | **Только GitHub Pages**: `data/` + PWA, **без workers.dev** в сборке |
| Same-origin `/vlsu-api` | N/A | **Не входит в scope** (осознанно; см. §5) |
| PWA / offline | 8.5 / 10 | SW; preload warning **исправлен** в `public/sw.js` (ожидает выкладки) |
| Доступность | 7.5 / 10 | LAD-007…009 закрыты в коде; на проде в a11y-tree возможен кэш старого бандла |
| Визуал desktop/laptop | 9 / 10 | LAD-VIS-01…03 закрыты; **measure на проде — exit 0** |
| Покрытие групп | 7 / 10 | 225/964 без пригодного снимка (данные, не UI) |

**Вывод для пользователя:** для групп **из покрытия (739)** сайтом **можно пользоваться с комфортом** — телефон, ноутбук, офлайн, один origin (germanpolkin.ru / github.io), без Cloudflare и без лишних сторонних запросов. Свежесть расписания = **публикация снимков** (ветка `data` + Pages), не live API ВлГУ в браузере.

---

## 2. Что сделано в репозитории (журнал работ 25.11.2026)

### Волна A (UI / a11y / desktop)

- **LAD-VIS-01…03:** колонка «Сегодня», ширина «Недели», полный `qa-desktop-layout`.
- **LAD-007…016 (часть):** `aria-label` заголовка, pinch-zoom, контраст nav, compose без двойного dialog, URL группы, без автомодалки группы.
- Gate на preview: vitest, build, measure, QA-скрипты.

**Коммиты:** `9c0f9f541` (волна A), правки QA/стилей.

### Публикация

- Push в `main` → workflow **«Публикация на GitHub Pages»** — success.
- Прод: бандлы `index-Daxj6x9a.js` → позже **`953b049`** (static-only).

### Отказ от Cloudflare на проде (по запросу владельца)

- Удалён `VITE_SCHEDULE_FALLBACK_URL` из `.github/workflows/pages.yml`.
- Модуль `src/lib/apiOrigins.ts`: на `/lad-vlsu/` **нет** маршрутизации на workers.dev; каталоги/расписание из **`/lad-vlsu/data/`**.
- `loadSchedule`: без fallback URL не вызывается Worker и live `/app-api`.
- Опциональный workflow `.github/workflows/cloudflare-worker.yml` — только **workflow_dispatch** (не автодеплой).
- Краткая попытка маршрутизации через Worker (`2e52bf08e` … `f0c481c62`) **откачена по смыслу** коммитом **`953b049b2`**.

### Финальный аудит прод (вечер)

- `lad-full-bug-audit.mjs`: **0 Critical/High**, 3× Low (API note, 225 missing, CSP).
- `measure-viewport-layout.mjs` на **https://germanpolkin.ru/lad-vlsu/** — **ISSUES []**.
- Smoke: ПИ-124, «Сегодня», неделя — OK.

### Service Worker (DevTools)

- Сообщение: *«navigation preload request was cancelled before preloadResponse settled»* при отдаче **кэшированной** оболочки без ожидания preload.
- **Исправление:** в `public/sw.js` при `cachedShell` — `await event.preloadResponse` перед ответом (коммит после этой правки — см. git log).

---

## 3. Автотесты и QA

| Проверка | Результат |
|----------|-----------|
| `pnpm run test` | Pass (583+ на CI Pages workflow) |
| `qa-desktop-layout.cjs` (preview, волна A) | Pass 1024–1920 |
| `measure-viewport-layout.mjs` (прод) | **exit 0** |
| `lad-full-bug-audit.mjs` (прод) | bugCount **3**, все Low |

---

## 4. Реестр дефектов — актуальность

### Снято с продакшен-чеклиста (Pages-only)

| ID | Было | Сейчас |
|----|------|--------|
| LAD-001, 002, 024 | Critical «нет прокси на germanpolkin» | **Не применимо**: прод = статика; live API только в `vite dev` / опциональный Worker |
| LAD-003, 004 | Worker refresh | **Не используется** в Pages-сборке |
| LAD-VIS-01…03 | High | **Закрыто** на проде (measure) |
| LAD-009 | pinch-zoom | **Закрыто** в коде |

### Остаётся

| ID | Суть | Влияние на UX |
|----|------|----------------|
| LAD-006 / DATA-04 | 225 групп без снимка | Нет расписания для этих групп |
| LAD-018 / SEC-01 | Нет CSP на GH Pages | Инфраструктура |
| LAD-007 (редко) | a11y «ПИ -124» | Мелочь; сбросить кэш PWA после релиза |

Полный исторический реестр: **`lad-bugs-master.json`** (утренний аудит + VIS).

---

## 5. Модель развёртывания (зафиксировано)

**Прод:** только **GitHub Pages** + custom domain `germanpolkin.ru/lad-vlsu/`.

- Данные: `data/catalog.json`, `data/schedule/*.json`, `university-schedule.json` в артефакте Pages.
- **Нет** обязательного Cloudflare Workers, **нет** workers.dev в бандле Pages.
- **`/vlsu-api` на корне домена** — 404 (норма для статического хостинга).
- Разработка: `vite` проксирует `/vlsu-api` локально.

---

## 6. Визуальное масштабирование

| ID | Статус |
|----|--------|
| LAD-VIS-01…03 | **Закрыто** (preview gate + **прод measure 25.11 вечер**) |

---

## 7. Gate перед следующей выкладкой

См. **`PRE-PROD-RELEASE-GATE.md`**. Для Pages-only достаточно: test → build → sw.js check → push `main` → smoke ПИ-124 → `lad-full-bug-audit.mjs` (ожидать 0 High).

---

## 8. Рекомендации владельцу

1. После обновления SW: жёсткое обновление вкладки или «Восстановить приложение» в PWA (снять старый бандл с workers.dev, если ставилась промежуточная сборка).
2. Обновление расписания студентов: pipeline снимков → ветка `data` → автоматический пересбор Pages.
3. Не считать отсутствие `/vlsu-api` на germanpolkin.ru регрессией при выбранной архитектуре.

---

*Отчёт переписан 25.11.2026 вечер — финал волны A, static-only Pages, прод-аудит, исправление SW preload.*