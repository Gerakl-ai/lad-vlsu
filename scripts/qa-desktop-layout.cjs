const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

const allViewports = [
  { width: 402, height: 874 },
  { width: 932, height: 430 },
  { width: 960, height: 600 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1400, height: 900 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2540, height: 1276 },
  { width: 2560, height: 1440 }
];
const viewportFilter = process.env.QA_VIEWPORT;
const viewports = viewportFilter
  ? allViewports.filter(({ width, height }) => `${width}x${height}` === viewportFilter)
  : allViewports;
const groupQuery = '?group=7936a2a43b11b20b01d30f5b00c73166&institute=5b42fa53ec1dd1892e5ec44a3a60a896';
const qaUrl = new URL(groupQuery, process.env.QA_URL || 'http://127.0.0.1:4173/').href;

function assertVisibleTabMotion(motion, label, direction) {
  assert.ok(motion, `${label} should animate into view`);
  assert.equal(motion.name, `tab-view-enter-${direction}`, `${label} should move in the navigation direction`);
  assert.equal(motion.playState, 'running', `${label} transition should actually start`);
  const startTransform = motion.keyframes[0].transform || '';
  const offset = Number(startTransform.match(/translate3d\(([-\d.]+)px/)?.[1] ?? 0);
  assert.ok(Math.abs(offset) >= 45, `${label} transition should have a visible but restrained slide: ${startTransform}`);
  assert.ok(Number(motion.keyframes[0].opacity) < 0.3, `${label} transition should include a clear fade-in`);
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
  fs.mkdirSync('artifacts/qa/desktop-layout', { recursive: true });
  try {
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport, serviceWorkers: 'block' });
      const savedAt = '2026-11-04T14:20:00.000Z';
      if (viewport.width === 1024) {
        await page.addInitScript(() => {
          window.requestIdleCallback = (callback) => {
            window.__deferredIdleCallback = callback;
            return 1;
          };
          window.cancelIdleCallback = () => {};
        });
        await page.route('**/assets/NotesView-*.js', async (route) => {
          await new Promise((resolve) => setTimeout(resolve, 500));
          await route.continue();
        });
      }
      await page.addInitScript(({ timestamp, emptyNotes }) => {
        localStorage.setItem('lad.notes.fallback', JSON.stringify(emptyNotes ? [] : [
          {
            id: 'qa-note-project', text: 'План проекта\nСобрать сценарии и согласовать сроки.', contentHtml: '<h2>План проекта</h2><p>Собрать сценарии и <strong>согласовать сроки</strong>.</p>',
            title: 'План проекта', status: 'open', pinned: true, kind: 'task', space: 'Проект', topic: 'Университетский продукт', confidence: 0.96,
            createdAt: timestamp, updatedAt: timestamp, contentUpdatedAt: timestamp, classificationSource: 'local'
          },
          {
            id: 'qa-note-work', text: 'Интервью\nПодготовить вопросы.', title: 'Интервью', status: 'open', pinned: false, kind: 'note', space: 'Работа', topic: 'Подготовка', confidence: 0.91,
            createdAt: '2026-11-03T10:00:00.000Z', updatedAt: '2026-11-03T10:00:00.000Z', contentUpdatedAt: '2026-11-03T10:00:00.000Z', classificationSource: 'local'
          }
        ]));
      }, { timestamp: savedAt, emptyNotes: viewport.width === 402 });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      try {
        await page.goto(qaUrl, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: 'Добавить событие' }).waitFor();
        await page.evaluate(() => {
          window.__tabMotionHistory = [];
          const nativeAnimate = Element.prototype.animate;
          Element.prototype.animate = function (keyframes, options) {
            const animation = nativeAnimate.call(this, keyframes, options);
            queueMicrotask(() => {
              if (!animation.id?.startsWith('tab-view-enter-')) return;
              window.__tabMotionHistory.push({
                element: this,
                motionId: document.querySelector('.content-scroll')?.getAttribute('data-tab-motion-id'),
                name: animation.id,
                playState: animation.playState,
                duration: animation.effect.getTiming().duration,
                keyframes: animation.effect.getKeyframes()
              });
            });
            return animation;
          };
          window.__readTabMotion = (selector) => {
            const element = document.querySelector(selector);
            if (!element) return undefined;
            const animation = element.getAnimations().find((entry) => entry.id?.startsWith('tab-view-enter-'));
            if (animation) return {
              name: animation.id,
              playState: animation.playState,
              duration: animation.effect.getTiming().duration,
              keyframes: animation.effect.getKeyframes()
            };
            const motionId = document.querySelector('.content-scroll')?.getAttribute('data-tab-motion-id');
            return [...window.__tabMotionHistory].reverse().find((entry) => entry.element === element && entry.motionId === motionId);
          };
        });
        const desktop = viewport.width >= 960 && viewport.height >= 600;
        if (desktop) {
          if (viewport.width >= 1280) {
            const frame = page.locator('.phone-frame');
            const toggle = page.locator('.desktop-sidebar-toggle');
            const expandedWidth = await page.locator('.bottom-nav').evaluate((element) => element.getBoundingClientRect().width);
            assert.equal(expandedWidth, 210, `Unexpected expanded sidebar width at ${viewport.width}px`);
            const transition = await frame.evaluate((element) => ({
              duration: Number.parseFloat(getComputedStyle(element).transitionDuration) * 1000,
              properties: getComputedStyle(element).transitionProperty
            }));
            assert.ok(transition.duration >= 350, `Sidebar transition is too brief: ${transition.duration}ms`);
            assert.ok(transition.properties.includes('grid-template-columns'), `Missing sidebar width transition: ${transition.properties}`);
            await frame.evaluate((element) => {
              const state = window.__sidebarAnimation = { samples: [], done: false, runs: 0 };
              const sample = () => element.querySelector('.bottom-nav').getBoundingClientRect().width;
              element.addEventListener('transitionrun', (event) => {
                if (event.propertyName !== 'grid-template-columns') return;
                state.runs += 1;
                state.samples = [];
                state.done = false;
                const collect = () => {
                  state.samples.push(sample());
                  if (!state.done) requestAnimationFrame(collect);
                };
                requestAnimationFrame(collect);
              });
              element.addEventListener('transitionend', (event) => {
                if (event.propertyName !== 'grid-template-columns') return;
                state.samples.push(sample());
                state.done = true;
              });
            });
            await toggle.click();
            await page.waitForFunction(() => document.querySelector('.phone-frame')?.getAttribute('data-sidebar-collapsed') === 'true');
            await page.waitForFunction(() => window.__sidebarAnimation?.done === true);
            const widthSamples = await page.evaluate(() => window.__sidebarAnimation.samples);
            assert.equal(widthSamples.at(-1), 76, `Sidebar did not reach its compact width: ${widthSamples.join(' -> ')}`);
            assert.ok(widthSamples.some((width) => width < expandedWidth - 8 && width > 76), `Sidebar did not pass through an animated width: ${widthSamples.join(' -> ')}`);
            const collapsedLabel = await page.locator('.bottom-nav .nav-label').first().evaluate((element) => ({
              opacity: Number.parseFloat(getComputedStyle(element).opacity),
              visibility: getComputedStyle(element).visibility
            }));
            assert.equal(collapsedLabel.opacity, 0);
            assert.equal(collapsedLabel.visibility, 'hidden');
            await toggle.click();
            await page.waitForFunction(() => window.__sidebarAnimation?.runs >= 2 && window.__sidebarAnimation?.done === true && document.querySelector('.phone-frame')?.getAttribute('data-sidebar-collapsed') === 'false');
            assert.equal(await page.locator('.bottom-nav').evaluate((element) => element.getBoundingClientRect().width), expandedWidth);
          }
          assert.equal(await page.locator('.today-primary').evaluate((element) => getComputedStyle(element).position), 'static');
          const todaySummaryGeometry = await page.evaluate(() => {
            const rect = (selector) => {
              const box = document.querySelector(selector).getBoundingClientRect();
              return { top: box.top, bottom: box.bottom, height: box.height };
            };
            return {
              primary: rect('.today-primary'),
              hero: rect('.today-primary > .hero-card'),
              summary: rect('.today-day-summary'),
              detail: rect('.today-detail-scroll'),
              summaryDisplay: getComputedStyle(document.querySelector('.today-day-summary')).display
            };
          });
          assert.equal(todaySummaryGeometry.summaryDisplay, 'grid', JSON.stringify(todaySummaryGeometry));
          assert.ok(todaySummaryGeometry.hero.height >= 260 && todaySummaryGeometry.hero.bottom < todaySummaryGeometry.summary.top, JSON.stringify(todaySummaryGeometry));
          assert.ok(todaySummaryGeometry.summary.height >= 80 && todaySummaryGeometry.summary.bottom <= todaySummaryGeometry.primary.bottom + 1, JSON.stringify(todaySummaryGeometry));
          assert.ok(Math.abs(todaySummaryGeometry.primary.bottom - todaySummaryGeometry.detail.bottom) <= 2, JSON.stringify(todaySummaryGeometry));
          if (viewport.width === 1280) await page.screenshot({ path: 'artifacts/qa/desktop-layout/today-workspace-1280x800.png' });
          if (viewport.width === 1024) {
            await page.locator('.bottom-nav').getByRole('button', { name: 'Записи' }).click();
            await page.waitForTimeout(80);
            assert.equal(await page.locator('.content-scroll').getAttribute('data-active-tab'), 'today', 'Keep the current screen while Notes is loaded');
            assert.equal(await page.locator('.today-view').count(), 1);
            assert.equal(await page.locator('.content-scroll > .notes-loading').count(), 0, 'Do not flash a placeholder between tabs');
            await page.waitForFunction(() => document.querySelector('.content-scroll')?.getAttribute('data-active-tab') === 'notes');
            await page.locator('.notes-view').waitFor();
            const lazyNotesMotion = await page.evaluate(() => window.__readTabMotion('.notes-view'));
            assertVisibleTabMotion(lazyNotesMotion, 'Notes tab after lazy import', 'forward');
            assert.ok(lazyNotesMotion.duration >= 420, `Notes transition is too brief: ${lazyNotesMotion.duration}ms`);
            await page.locator('.bottom-nav').getByRole('button', { name: 'Сегодня' }).click();
            await page.locator('.today-view').waitFor();
          }
          const commandTrigger = page.getByRole('button', { name: 'Быстрый переход' });
          await commandTrigger.waitFor({ state: 'visible' });
          await page.keyboard.press('Control+k');
          const palette = page.getByRole('dialog', { name: 'Быстрый переход' });
          await palette.waitFor();
          await page.waitForTimeout(240);
          await palette.getByRole('combobox', { name: 'Найти команду' }).fill('неделя');
          await page.screenshot({ path: `artifacts/qa/desktop-layout/commands-${viewport.width}x${viewport.height}.png` });
          await page.keyboard.press('Enter');
          await page.locator('.week-view').waitFor();
          await page.keyboard.press('Control+k');
          await palette.waitFor();
          await palette.getByRole('combobox', { name: 'Найти команду' }).fill('команды которой нет');
          await page.getByText('Команда не найдена').waitFor();
          await page.keyboard.press('Escape');
          await palette.waitFor({ state: 'hidden' });
          await commandTrigger.click();
          await palette.waitFor();
          await palette.getByRole('option', { name: /Сменить группу/ }).waitFor();
          await page.keyboard.press('Escape');
          await palette.waitFor({ state: 'hidden' });
          await page.keyboard.press('Control+k');
          await palette.waitFor();
          await palette.getByRole('combobox', { name: 'Найти команду' }).fill('завтра');
          await page.keyboard.press('Enter');
          const tomorrowDay = await page.evaluate(() => { const date = new Date(); date.setDate(date.getDate() + 1); return String(date.getDate()); });
          await page.waitForFunction((day) => document.querySelector('.today-date-tile strong')?.textContent?.trim() === day, tomorrowDay);
          await page.keyboard.press('Control+k');
          await palette.waitFor();
          await palette.getByRole('combobox', { name: 'Найти команду' }).fill('сегодня');
          await page.keyboard.press('Enter');
          const currentDay = await page.evaluate(() => String(new Date().getDate()));
          await page.waitForFunction((day) => document.querySelector('.today-date-tile strong')?.textContent?.trim() === day, currentDay);
          if (viewport.width === 1440 || viewport.width === 1920) {
            await page.keyboard.press('Control+k');
            await palette.waitFor();
            await palette.getByRole('combobox', { name: 'Найти команду' }).fill('создать запись');
            await palette.getByRole('option', { name: /Создать запись/ }).waitFor();
            await page.keyboard.press('Enter');
            const composer = page.locator('.note-composer');
            await composer.waitFor();
            assert.equal(await page.locator('.content-scroll').getAttribute('data-active-tab'), 'notes');
            await page.getByRole('button', { name: 'Закрыть запись' }).click();
            await composer.waitFor({ state: 'detached' });
          }
        } else {
          await page.getByRole('button', { name: 'Быстрый переход' }).waitFor({ state: 'hidden' });
        }
        await page.locator('.bottom-nav').getByRole('button', { name: 'Неделя' }).click();
        await page.locator('.week-view').waitFor();
        const weekMotion = await page.evaluate(() => window.__readTabMotion('.week-view:not(.session-view)'));
        assert.ok(weekMotion, 'Week tab should animate into view');
        assert.ok(weekMotion.duration >= (desktop ? 450 : 420), `Week transition is too brief: ${weekMotion.duration}ms`);
        const weekDirection = await page.locator('.content-scroll').getAttribute('data-tab-motion-direction');
        assertVisibleTabMotion(weekMotion, 'Week tab', weekDirection);
        if (desktop) {
          const weekColumns = await page.locator('.week-view:not(.session-view) > .week-list').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
          const expectedColumns = viewport.width >= 2200 ? 6 : viewport.width >= 1280 ? 3 : 2;
          assert.equal(weekColumns, expectedColumns, `Unexpected desktop week density at ${viewport.width}px`);
          if (viewport.width >= 2200) {
            const daysShareRow = await page.locator('.week-view:not(.session-view) > .week-list').evaluate((element) => {
              const grid = element.getBoundingClientRect();
              const items = [...element.children].map((item) => item.getBoundingClientRect());
              return items.length === 6
                && items.every((item) => Math.abs(item.top - items[0].top) < 1)
                && items.every((item) => item.left >= grid.left && item.right <= grid.right + 1);
            });
            assert.equal(daysShareRow, true, 'All six week days should fit in one visible ultrawide row');
          }
        }
        if (viewport.width === 1440) await page.screenshot({ path: 'artifacts/qa/desktop-layout/week-tab-transition-1440x900.png' });
        if (viewport.width === 2560) await page.screenshot({ path: 'artifacts/qa/desktop-layout/week-grid-2560x1440.png' });
        await page.waitForTimeout(450);
        const disclosure = page.locator('.week-map-disclosure');
        await page.waitForFunction((expected) => Boolean(document.querySelector('.week-map-disclosure')?.open) === expected, desktop);

        const geometry = await page.evaluate(() => {
          const frame = document.querySelector('.phone-frame').getBoundingClientRect();
          const view = document.querySelector('.week-view');
          const content = document.querySelector('.content-scroll');
          const nav = document.querySelector('.bottom-nav').getBoundingClientRect();
          return {
            frameLeft: frame.left,
            frameBottom: frame.bottom,
            frameWidth: frame.width,
            navLeft: nav.left,
            navRight: nav.right,
            navBottom: nav.bottom,
            horizontalOverflow: view.scrollWidth > view.clientWidth
              || content.scrollWidth > content.clientWidth
              || document.documentElement.scrollWidth > innerWidth
          };
        });
        assert.equal(geometry.horizontalOverflow, false);
        if (desktop) {
          assert.ok(geometry.frameWidth > 800);
          assert.ok(Math.abs(geometry.navBottom - geometry.frameBottom) <= 2);
          assert.ok(Math.abs(geometry.navLeft - geometry.frameLeft) <= 2);
          assert.ok(geometry.navRight - geometry.navLeft <= 220);
          if (viewport.width >= 1800) {
            assert.ok(Math.abs(geometry.frameLeft) <= 1);
            assert.ok(Math.abs(geometry.frameWidth - viewport.width) <= 1);
          }
        }
        if (viewport.width === 402 || viewport.height < 600) {
          assert.ok(Math.abs(geometry.navBottom - viewport.height) <= 2);
        }
        if (desktop) await page.screenshot({ path: `artifacts/qa/desktop-layout/shell-${viewport.width}x${viewport.height}.png` });

        await page.locator('.bottom-nav').getByRole('button', { name: 'Записи' }).click();
        await page.locator('.notes-view').waitFor();
        const forwardNotesMotion = await page.evaluate(() => window.__readTabMotion('.notes-view'));
        const forwardNotesDirection = await page.locator('.content-scroll').getAttribute('data-tab-motion-direction');
        assertVisibleTabMotion(forwardNotesMotion, 'Notes tab after Week', forwardNotesDirection);
        await page.waitForTimeout(430);
        await page.locator('.bottom-nav').getByRole('button', { name: 'Настройки' }).click();
        await page.locator('.settings-view').waitFor();
        const repeatedForwardMotion = await page.evaluate(() => window.__readTabMotion('.settings-view'));
        const repeatedForwardDirection = await page.locator('.content-scroll').getAttribute('data-tab-motion-direction');
        assertVisibleTabMotion(repeatedForwardMotion, 'Repeated forward tab transition', repeatedForwardDirection);
        await page.waitForTimeout(430);
        await page.locator('.bottom-nav').getByRole('button', { name: 'Неделя' }).click();
        await page.locator('.week-view').waitFor();
        const backwardWeekMotion = await page.evaluate(() => window.__readTabMotion('.week-view:not(.session-view)'));
        const backwardWeekDirection = await page.locator('.content-scroll').getAttribute('data-tab-motion-direction');
        assertVisibleTabMotion(backwardWeekMotion, 'Week tab in reverse direction', backwardWeekDirection);
        await page.waitForTimeout(430);

        if (viewport.width === 1440 || viewport.width === 1920) {
          await page.locator('.week-compare-button').click();
          const comparison = page.locator('.comparison-sheet');
          await comparison.waitFor();
          await page.locator('.comparison-controls').waitFor();
          await page.waitForTimeout(220);
          const comparisonLayout = await page.evaluate(() => {
            const bounds = document.querySelector('.comparison-sheet').getBoundingClientRect();
            const alpha = (color) => {
              const value = color.match(/rgba?\([^,]+,[^,]+,[^,]+,\s*([^)]+)\)/)?.[1];
              return value === undefined ? 1 : Number(value);
            };
            const sheet = document.querySelector('.comparison-sheet');
            const backdrop = document.querySelector('.comparison-backdrop');
            const surfaceAlpha = alpha(getComputedStyle(sheet).backgroundColor);
            const lightOverlay = alpha(getComputedStyle(backdrop).backgroundColor);
            const emptyStart = Boolean(sheet.querySelector('.comparison-start'));
            document.documentElement.dataset.themeMode = 'dark';
            const darkOverlay = alpha(getComputedStyle(backdrop).backgroundColor);
            document.documentElement.dataset.themeMode = 'light';
            return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, surfaceAlpha, lightOverlay, darkOverlay, emptyStart };
          });
          assert.ok(comparisonLayout.width >= Math.min(viewport.width - 48, 1480) - 1, JSON.stringify(comparisonLayout));
          assert.ok(comparisonLayout.surfaceAlpha >= 0.999, JSON.stringify(comparisonLayout));
          if (comparisonLayout.emptyStart) assert.ok(comparisonLayout.height <= 600, JSON.stringify(comparisonLayout));
          assert.ok(comparisonLayout.lightOverlay > 0.2 && comparisonLayout.lightOverlay < 0.4, JSON.stringify(comparisonLayout));
          assert.ok(comparisonLayout.darkOverlay > 0.5, JSON.stringify(comparisonLayout));
          await page.screenshot({ path: `artifacts/qa/desktop-layout/comparison-${viewport.width}x${viewport.height}.png` });
          await page.keyboard.press('Escape');
          await comparison.waitFor({ state: 'detached' });
        }

        if (viewport.width >= 1800 && viewport.height >= 600) {
          await page.locator('.bottom-nav').getByRole('button', { name: 'Сегодня' }).click();
          const weekPreview = page.locator('.today-week-preview');
          await weekPreview.waitFor();
          const dayButtons = weekPreview.locator('.today-week-day');
          assert.equal(await dayButtons.count(), 6);
          assert.ok(await page.locator('.today-week-lesson-meta').count() > 0, 'Wide Today preview should include classroom and instructor metadata');
          const todayLayout = await page.evaluate(() => {
            const bounds = (selector) => {
              const rect = document.querySelector(selector).getBoundingClientRect();
              return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
            };
            const weekDayBottom = Math.max(...[...document.querySelectorAll('.today-week-day')].map((day) => day.getBoundingClientRect().bottom));
            const weekSummaryTop = document.querySelector('.today-week-summary').getBoundingClientRect().top;
            return {
              frame: bounds('.phone-frame'),
              content: bounds('.content-scroll'),
              primary: bounds('.today-primary'),
              hero: bounds('.today-primary > .hero-card'),
              daySummary: bounds('.today-day-summary'),
              timeline: bounds('.today-detail-scroll'),
              week: bounds('.today-week-preview'),
              weekDays: bounds('.today-week-days'),
              weekSummary: bounds('.today-week-summary'),
              weekDayBottom,
              weekSeparation: weekSummaryTop - weekDayBottom,
              weekDayOverflow: [...document.querySelectorAll('.today-week-day')].some((day) => day.scrollHeight > day.clientHeight + 1),
              overflow: document.documentElement.scrollWidth > innerWidth
            };
          });
          assert.equal(todayLayout.overflow, false);
          assert.ok(todayLayout.primary.width >= 320 && todayLayout.timeline.width >= 460 && todayLayout.week.width >= 320);
          assert.ok(todayLayout.primary.right <= todayLayout.timeline.x + 1);
          assert.ok(Math.abs(todayLayout.primary.bottom - todayLayout.timeline.bottom) <= 2, JSON.stringify(todayLayout));
          assert.ok(todayLayout.hero.height >= 320 && todayLayout.hero.height < todayLayout.primary.height - 70, JSON.stringify(todayLayout));
          assert.ok(todayLayout.daySummary.height >= 80 && todayLayout.hero.bottom < todayLayout.daySummary.y, JSON.stringify(todayLayout));
          assert.ok(todayLayout.daySummary.bottom <= todayLayout.primary.bottom + 1, JSON.stringify(todayLayout));
          assert.ok(todayLayout.week.x <= todayLayout.primary.x + 1);
          assert.ok(todayLayout.week.right >= todayLayout.timeline.right - 1);
          assert.ok(todayLayout.weekSeparation >= -1, `Week summary overlaps day cards by ${Math.abs(todayLayout.weekSeparation)}px: ${JSON.stringify(todayLayout)}`);
          assert.equal(todayLayout.weekDayOverflow, false, JSON.stringify(todayLayout));
          assert.ok(todayLayout.week.y >= Math.max(todayLayout.primary.bottom, todayLayout.timeline.bottom) - 1);
          assert.ok(todayLayout.week.y >= todayLayout.primary.bottom + 17, JSON.stringify(todayLayout));
          assert.ok(todayLayout.week.y - Math.max(todayLayout.primary.bottom, todayLayout.timeline.bottom) <= 24);
          assert.ok(todayLayout.week.bottom >= todayLayout.content.bottom - 42, JSON.stringify(todayLayout));
          await page.screenshot({ path: `artifacts/qa/desktop-layout/today-workspace-${viewport.width}x${viewport.height}.png` });
          if (viewport.width === 1920) {
            await weekPreview.scrollIntoViewIfNeeded();
            const scrolledToday = await page.evaluate(() => {
              const primary = document.querySelector('.today-primary').getBoundingClientRect();
              const preview = document.querySelector('.today-week-preview').getBoundingClientRect();
              return { primary: { top: primary.top, bottom: primary.bottom }, preview: { top: preview.top, bottom: preview.bottom } };
            });
            assert.ok(scrolledToday.primary.bottom <= scrolledToday.preview.top || scrolledToday.preview.bottom <= scrolledToday.primary.top, JSON.stringify(scrolledToday));
            await page.screenshot({ path: 'artifacts/qa/desktop-layout/today-scrolled-1920x1080.png' });
          }
          const targetDay = dayButtons.nth(1);
          const targetDate = await targetDay.getAttribute('data-date');
          await targetDay.click();
          await page.waitForFunction((expected) => document.querySelector('.today-week-day[aria-pressed="true"]')?.getAttribute('data-date') === expected, targetDate);
          assert.equal(await page.locator('.today-week-day[aria-pressed="true"]').getAttribute('data-date'), targetDate);
        }

        await page.evaluate(() => {
          window.__sawTransientNotesEmpty = false;
          window.__notesMotionObserved = false;
          const root = document.querySelector('.content-scroll');
          const observer = new MutationObserver(() => {
            if (document.querySelector('.notes-empty h3')?.textContent?.trim() === 'Здесь пока тихо') window.__sawTransientNotesEmpty = true;
            if (document.querySelector('.notes-view .notes-loading')) window.__sawNotesSkeleton = true;
          });
          observer.observe(root, { childList: true, subtree: true });
          window.__notesEmptyObserver = observer;
          let frames = 0;
          const sampleMotion = () => {
            const view = document.querySelector('.notes-view');
            if (view?.getAnimations().some((animation) => animation.id?.startsWith('tab-view-enter-') && animation.playState === 'running')) window.__notesMotionObserved = true;
            if (frames++ < 40) requestAnimationFrame(sampleMotion);
          };
          requestAnimationFrame(sampleMotion);
        });
        await page.locator('.bottom-nav').getByRole('button', { name: 'Записи' }).click();
        if (viewport.width >= 1280 && viewport.height >= 600) {
          const notesMotion = await page.evaluate(() => window.__readTabMotion('.notes-view'));
          assert.ok(notesMotion, 'Notes tab should animate into view');
          assert.ok(notesMotion.duration >= 450, `Notes transition is too brief: ${notesMotion.duration}ms`);
          const notesDirection = await page.locator('.content-scroll').getAttribute('data-tab-motion-direction');
          assert.equal(notesMotion.name, `tab-view-enter-${notesDirection}`);
          assert.match(notesMotion.keyframes[0].transform, /translate3d\(/);
          if (viewport.width === 1440) await page.screenshot({ path: 'artifacts/qa/desktop-layout/notes-tab-transition-1440x900.png' });
        }
        if (viewport.width === 402) {
          await page.locator('.notes-empty').waitFor();
          await page.locator('.bottom-nav').getByRole('button', { name: 'Сегодня' }).click();
          await page.locator('.today-view').waitFor();
          await page.evaluate(() => { window.__sawNotesSkeleton = false; });
          await page.locator('.bottom-nav').getByRole('button', { name: 'Записи' }).click();
          const notesMotion = await page.evaluate(() => window.__readTabMotion('.notes-view'));
          assert.ok(notesMotion, 'Notes tab should animate into view');
          assert.ok(notesMotion.duration >= 420, `Mobile notes transition is too brief: ${notesMotion.duration}ms`);
          const notesDirection = await page.locator('.content-scroll').getAttribute('data-tab-motion-direction');
          assert.equal(notesMotion.name, `tab-view-enter-${notesDirection}`);
          assert.match(notesMotion.keyframes[0].transform, /translate3d\(/);
          await page.locator('.notes-empty').waitFor();
          await page.waitForTimeout(220);
          assert.equal(await page.evaluate(() => window.__sawNotesSkeleton), false, 'Empty notes tab must not flash skeleton cards after storage is ready');
          assert.equal(await page.locator('.notes-view .notes-loading').count(), 0);
          await page.screenshot({ path: 'artifacts/qa/desktop-layout/notes-empty-mobile-402x874.png' });
        }
        if (viewport.width >= 1280 && viewport.height >= 600) {
          await page.locator('.notes-list').waitFor();
          assert.equal(await page.locator('.notes-view').evaluate((view) => view.classList.contains('wide-note-workspace')), true);
          await page.waitForTimeout(500);
          assert.equal(await page.evaluate(() => window.__sawTransientNotesEmpty), false);
          assert.equal(await page.evaluate(() => window.__notesMotionObserved), true, 'Notes transition should run without a flash of the previous screen');
          const settledNotesMotion = await page.locator('.notes-view').evaluate((view) => ({
            running: view.getAnimations().some((animation) => animation.id?.startsWith('tab-view-enter-') && animation.playState === 'running'),
            opacity: getComputedStyle(view).opacity,
            transform: getComputedStyle(view).transform
          }));
          assert.equal(settledNotesMotion.running, false);
          assert.equal(settledNotesMotion.opacity, '1');
          assert.ok(['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(settledNotesMotion.transform), JSON.stringify(settledNotesMotion));
          await page.evaluate(() => window.__notesEmptyObserver?.disconnect());
        }
        if (viewport.width >= 1280 && viewport.height >= 600) {
          const list = page.locator('.notes-list');
          const detail = page.locator('.note-detail-pane');
          await list.waitFor();
          await detail.waitFor();
          await page.locator('.note-card-main').first().click();
          const selectedTitle = await page.locator('.note-card-main > strong').first().innerText();
          await page.waitForFunction((title) => document.querySelector('.note-detail-content > h3')?.textContent?.trim() === title, selectedTitle);
          const workspace = await page.evaluate(() => {
            const rect = (selector) => {
              const value = document.querySelector(selector).getBoundingClientRect();
              return { x: value.x, y: value.y, width: value.width, height: value.height };
            };
            const dashboard = document.querySelector('.notes-dashboard').getBoundingClientRect();
            const firstFolder = document.querySelector('.space-rail > button:first-child').getBoundingClientRect();
            const lastFolder = document.querySelector('.space-rail > button:last-child').getBoundingClientRect();
            const dashboardFlow = ['.notes-heading', '.notes-pulse', '.quick-capture', '.calendar-launch-card', '.notes-search', '.space-rail', '.recoverable-drafts']
              .map((selector) => document.querySelector(`.notes-dashboard ${selector}`))
              .filter(Boolean)
              .map((element) => ({ className: element.className, top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom }));
            return {
              dashboard: rect('.notes-dashboard'), list: rect('.notes-list'), detail: rect('.note-detail-pane'),
              firstFolderVisible: firstFolder.left >= dashboard.left - 1 && firstFolder.right <= dashboard.right + 1,
              lastFolderVisible: lastFolder.bottom <= dashboard.bottom + 1,
              dashboardFlow,
              overflow: document.querySelector('.content-scroll').scrollHeight > document.querySelector('.content-scroll').clientHeight + 1
            };
          });
          assert.ok(workspace.list.width >= 300 && workspace.detail.width >= 360);
          assert.ok(workspace.list.height >= 500 && workspace.detail.height >= 500);
          assert.equal(workspace.firstFolderVisible, true);
          assert.equal(workspace.lastFolderVisible, true);
          for (let index = 1; index < workspace.dashboardFlow.length; index += 1) {
            assert.ok(workspace.dashboardFlow[index - 1].bottom <= workspace.dashboardFlow[index].top + 1, JSON.stringify(workspace.dashboardFlow));
          }
          await page.screenshot({ path: `artifacts/qa/desktop-layout/notes-workspace-${viewport.width}x${viewport.height}.png` });
          await page.getByRole('button', { name: 'Отметить выполненной' }).click();
          await page.getByRole('button', { name: 'Вернуть в дела' }).waitFor();
          await page.getByRole('button', { name: 'Вернуть в дела' }).click();
          await page.getByRole('button', { name: 'Отметить выполненной' }).waitFor();
          await page.getByRole('button', { name: 'Редактировать' }).click();
          await page.locator('.note-composer').waitFor();
          await page.getByRole('button', { name: 'Закрыть запись' }).click();
          await page.locator('.note-composer').waitFor({ state: 'detached' });
          await page.waitForTimeout(550);
          await page.locator('.recoverable-drafts').waitFor({ state: 'detached' });
          if (viewport.width === 1400) {
            await page.getByRole('button', { name: 'Сменить тему' }).click();
            const themeDialog = page.getByRole('dialog', { name: 'Характер интерфейса' });
            await themeDialog.waitFor();
            await themeDialog.getByRole('group', { name: 'Режим оформления' }).getByRole('button', { name: 'Тёмная' }).click();
            await page.waitForFunction(() => document.documentElement.getAttribute('data-theme-mode') === 'dark');
            const themeBox = await page.locator('.theme-sheet').boundingBox();
            assert.ok(themeBox.width <= 760 && themeBox.height < viewport.height - 48);
            assert.ok(Math.abs(themeBox.x + themeBox.width / 2 - viewport.width / 2) <= 2);
            await themeDialog.getByRole('button', { name: 'Закрыть выбор темы' }).click();
            await themeDialog.waitFor({ state: 'detached' });
            const darkFlow = await page.evaluate(() => ['.notes-heading', '.notes-pulse', '.quick-capture', '.calendar-launch-card', '.notes-search', '.space-rail']
              .map((selector) => document.querySelector(`.notes-dashboard ${selector}`))
              .filter(Boolean)
              .map((element) => ({ className: element.className, top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom })));
            for (let index = 1; index < darkFlow.length; index += 1) assert.ok(darkFlow[index - 1].bottom <= darkFlow[index].top + 1, JSON.stringify(darkFlow));
            await page.screenshot({ path: 'artifacts/qa/desktop-layout/notes-workspace-dark-1400x900.png' });
          }
          console.log(JSON.stringify({ viewport, notesWorkspace: workspace }));
        } else if (desktop) {
          await page.locator('.note-detail-pane').waitFor({ state: 'detached' });
        }
        if (desktop) {
          await page.locator('.bottom-nav').getByRole('button', { name: 'Настройки' }).click();
          await page.locator('.settings-view').waitFor();
          if (viewport.width >= 1280) {
            const overview = page.locator('.settings-overview');
            await overview.waitFor();
            assert.equal(await overview.locator(':scope > div').count(), 3);
            const hero = await page.locator('.settings-hero').boundingBox();
            const summary = await overview.boundingBox();
            assert.ok(summary.x >= hero.x && summary.x + summary.width <= hero.x + hero.width + 1);
            assert.ok(summary.y >= hero.y && summary.y + summary.height <= hero.y + hero.height + 1);
            await page.screenshot({ path: `artifacts/qa/desktop-layout/settings-${viewport.width}x${viewport.height}.png` });
          }
          await page.locator('.bottom-nav').getByRole('button', { name: 'Записи' }).click();
          await page.locator('.notes-view').waitFor();
        }
        await page.getByRole('button', { name: /Создать запись/ }).first().click();
        const editor = page.locator('.note-composer');
        await editor.waitFor();
        await page.waitForTimeout(450);
        const editorBox = await editor.boundingBox();
        assert.ok(editorBox.x >= 0 && editorBox.y >= 0);
        assert.ok(editorBox.x + editorBox.width <= viewport.width + 1);
        assert.ok(editorBox.y + editorBox.height <= viewport.height + 1);
        if (desktop) assert.ok(editorBox.width >= 650);
        assert.deepEqual(errors, []);
        await page.screenshot({ path: `artifacts/qa/desktop-layout/${viewport.width}x${viewport.height}.png` });
        console.log(JSON.stringify({ viewport, desktop, editorWidth: editorBox.width, ...geometry }));
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
