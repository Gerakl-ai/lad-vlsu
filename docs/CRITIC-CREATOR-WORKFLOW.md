# Критик и Креатор: как агент ведёт серьёзные задачи

Дополнение к [CONTINUOUS-IMPROVEMENT.md](CONTINUOUS-IMPROVEMENT.md).

- **Любой репозиторий (лично у тебя):** `critic-creator-core`, `critic-creator.md`, **`GOAL-TEMPLATE.md`** в Agent Store.
- **Лад ВлГУ:** project skill `.cursor/skills/lad-critic-creator/SKILL.md` (overlay).

## Зачем

Один агент склонен «дожать зелёный CI» и сжать цель. Разделение ролей снижает регрессии на **данных**, **2K/Full HD**, **проде** и в **отчётах**.

Пример из проекта (волна D): критик заметил смену режима «Неделя» на 2K (time-grid с 2200px); креатор предложил list до 3440px; measure на проде подтвердил `weekGridVisible: false` на 2560.

## Для человека

| Вы просите | Агент делает |
|------------|----------------|
| `/goal`, релиз, аудит | Цикл + gate на preview и прод |
| Большая фича / UI | Viewport QA, при необходимости субагент-критик |
| Доку на сдачу | Критик на факты и SHA; **anti-ai-slop** + lint обязательны |

Рутина, которую агент берёт на себя: подбор gate-команд, `lad-critic-gate-preflight.cjs`, запись волны в `artifacts/final-audit-2026-11-25/lad-vlsu-audit-i-testirovanie.md`.

## Быстрый preflight

```powershell
node scripts/lad-critic-gate-preflight.cjs
```

Покажет затронутые области и рекомендуемые проверки по `git diff`.

## Impact pass (общая картина)

Между правками и критиком — короткий отчёт: что затронуто, кто зависит, какие **смежные** сценарии из goal проверены (не только один exit 0). Шаблон цели: `GOAL-TEMPLATE.md` в personal store.

В Ладе пример: правка «Недели» → проверить «Сегодня», другой viewport, при деплое — measure на проде.

## Лимиты

- Не более **2** раундов критика подряд без эскалации.
- Критик **не коммитит**.
- Цель не закрывается без impact pass + доказательств из skill (не по ощущению).