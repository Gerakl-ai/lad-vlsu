const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

const viewports = [
  { width: 402, height: 874 },
  { width: 932, height: 430 },
  { width: 960, height: 600 },
  { width: 1024, height: 768 },
  { width: 1400, height: 900 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 }
];
const groupQuery = '?group=7936a2a43b11b20b01d30f5b00c73166&institute=5b42fa53ec1dd1892e5ec44a3a60a896';
const qaUrl = new URL(groupQuery, process.env.QA_URL || 'http://127.0.0.1:4173/').href;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
  fs.mkdirSync('artifacts/qa/desktop-layout', { recursive: true });
  try {
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport });
      const savedAt = '2026-11-04T14:20:00.000Z';
      await page.addInitScript((timestamp) => {
        localStorage.setItem('lad.notes.fallback', JSON.stringify([
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
      }, savedAt);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      try {
        await page.goto(qaUrl, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: 'Добавить событие' }).waitFor();
        const desktop = viewport.width >= 960 && viewport.height >= 600;
        if (desktop) {
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
        } else {
          await page.getByRole('button', { name: 'Быстрый переход' }).waitFor({ state: 'hidden' });
        }
        await page.locator('.bottom-nav').getByRole('button', { name: 'Неделя' }).click();
        await page.locator('.week-view').waitFor();
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
        }
        if (viewport.width === 402 || viewport.height < 600) {
          assert.ok(Math.abs(geometry.navBottom - viewport.height) <= 2);
        }
        if (desktop) await page.screenshot({ path: `artifacts/qa/desktop-layout/shell-${viewport.width}x${viewport.height}.png` });

        await page.locator('.bottom-nav').getByRole('button', { name: 'Записи' }).click();
        if (viewport.width >= 1400 && viewport.height >= 600) {
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
