const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

const tabs = ['Сегодня', 'Неделя', 'Записи', 'Настройки'];
const sizes = [{ width: 402, height: 874 }, { width: 932, height: 430 }, { width: 960, height: 600 }, { width: 1280, height: 800 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }];
const root = process.env.QA_URL || 'http://127.0.0.1:4173/';
const url = new URL('?group=7936a2a43b11b20b01d30f5b00c73166&institute=5b42fa53ec1dd1892e5ec44a3a60a896', root).href;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  fs.mkdirSync('artifacts/qa/desktop-surfaces', { recursive: true });
  try {
    for (const viewport of sizes) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(() => {
        localStorage.setItem('lad.subgroup.v1:7936a2a43b11b20b01d30f5b00c73166', '0');
        if (innerWidth === 1366 || innerWidth === 402) {
          localStorage.setItem('lad.theme-schema', '2026-08-ember');
          localStorage.setItem('lad.theme', 'obsidian');
        }
      });
      await page.clock.install({ time: new Date('2026-10-05T16:00:00Z') });
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.locator('.bottom-nav').waitFor();
      for (const tab of tabs) {
        await page.locator('.bottom-nav').getByRole('button', { name: tab }).click();
        await page.waitForTimeout(250);
        if (tab === 'Сегодня') {
          if (viewport.width >= 1280 && viewport.width < 1800 && viewport.height >= 600) {
            const weekPreview = page.locator('.today-week-preview');
            await weekPreview.waitFor();
            assert.ok(await weekPreview.evaluate((element) => element.getBoundingClientRect().height >= 230));
            assert.equal(await page.locator('.today-week-day').count(), 6);
            assert.equal(await page.locator('.today-week-days').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length), 6);
            const nextDay = page.locator('.today-week-day[data-date="2026-10-06"]');
            assert.match(await nextDay.innerText(), /6.*Основы искусственного интеллекта/is);
          } else {
            await page.locator('.upcoming-study').waitFor();
            assert.match(await page.locator('.upcoming-study').innerText(), /6 октября/);
            const upcomingSubject = await page.locator('.upcoming-lesson strong').first().innerText();
            assert.match(upcomingSubject, /искусственного интеллекта/i);
            assert.doesNotMatch(upcomingSubject, /архитектуры/i);
          }
        }
        if (tab === 'Неделя') {
          await page.locator('.week-list .lesson-choice-hint').first().waitFor();
          assert.match(await page.locator('.week-list .lesson-choice-hint').first().innerText(), /2 варианта · выбрать/);
        }
        if (viewport.width === 1366 && tab === 'Сегодня') {
          const theme = await page.evaluate(() => {
            const style = getComputedStyle(document.documentElement);
            return {
              id: document.documentElement.dataset.theme,
              background: style.getPropertyValue('--bg').trim(),
              surface: style.getPropertyValue('--surface').trim(),
              text: style.getPropertyValue('--text').trim(),
              muted: style.getPropertyValue('--muted').trim(),
              accent: style.getPropertyValue('--accent-rgb').trim(),
              signal: style.getPropertyValue('--signal-rgb').trim(),
              success: style.getPropertyValue('--success-rgb').trim()
            };
          });
          assert.deepEqual(theme, {
            id: 'obsidian',
            background: '#080b12',
            surface: 'rgba(19, 28, 42, .86)',
            text: '#f7f9fc',
            muted: '#94a2b5',
            accent: '114, 184, 255',
            signal: '255, 107, 114',
            success: '97, 223, 189'
          });
        }
        if (tab === 'Записи' && viewport.width >= 960) {
          const empty = page.locator('.notes-empty');
          await empty.waitFor();
          assert.ok((await empty.boundingBox()).height >= 320);
          assert.equal(await empty.evaluate((element) => element.classList.contains('desktop-first-run')), true);
          assert.equal(await empty.getByRole('button', { name: 'Создать запись' }).isVisible(), true);
          assert.equal(await empty.getByRole('button', { name: 'Надиктовать' }).isVisible(), true);
        }
        if (tab === 'Записи' && viewport.width < 960) {
          assert.equal(await page.locator('.notes-empty-create').isVisible(), false);
        }
        const metrics = await page.evaluate(() => {
          const rect = (selector) => {
            const element = document.querySelector(selector);
            if (!element) return null;
            const box = element.getBoundingClientRect();
            return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height), right: Math.round(box.right) };
          };
          return { viewport: innerWidth, frame: rect('.phone-frame'), topbar: rect('.topbar'), nav: rect('.bottom-nav'), content: rect('.content-scroll'),
            primary: rect('.today-primary, .week-overview, .notes-dashboard, .settings-view'),
            secondary: rect('.today-detail-scroll, .week-list, .notes-list'),
            weekColumns: document.querySelector('.week-list') ? getComputedStyle(document.querySelector('.week-list')).gridTemplateColumns.split(' ').length : null,
            overflow: document.documentElement.scrollWidth > innerWidth };
        });
        assert.equal(metrics.overflow, false);
        assert.ok(metrics.frame?.right <= viewport.width + 1);
        if (viewport.width >= 1280) {
          assert.ok(metrics.nav.right <= metrics.content.x + 1);
          assert.ok(Math.abs(metrics.nav.y - metrics.content.y) <= 1);
          assert.ok(metrics.content.y < 120);
        }
        if (viewport.width === 402 || viewport.height < 600) {
          const navBottom = await page.locator('.bottom-nav').evaluate((element) => element.getBoundingClientRect().bottom);
          assert.ok(Math.abs(navBottom - viewport.height) <= 2);
        }
        if (viewport.width === 2560) {
          assert.ok(metrics.frame.width >= 1700);
          if (tab === 'Неделя') assert.equal(metrics.weekColumns, 6);
        }
        await page.screenshot({ path: `artifacts/qa/desktop-surfaces/${viewport.width}-${tab}.png` });
        console.log(JSON.stringify({ tab, ...viewport, ...metrics }));
        if (tab === 'Неделя' && [402, 1280].includes(viewport.width)) {
          const alternative = page.locator('.week-list .mini-lesson').filter({ has: page.locator('.lesson-choice-hint') }).first();
          await alternative.locator('.mini-lesson-main').click();
          const first = alternative.locator('.lesson-variant').first();
          const subject = await first.locator('strong').innerText();
          await first.click();
          assert.equal(await first.getAttribute('aria-pressed'), 'true');
          assert.equal(await alternative.locator('.mini-lesson-main > strong').innerText(), subject);
          const otherWeek = page.getByRole('radiogroup', { name: 'Тип недели' }).getByRole('radio', { name: 'Числитель' });
          await otherWeek.click();
          const alternatingLesson = page.locator('.week-list .mini-lesson').filter({ has: page.locator('.lesson-choice-hint') }).first();
          await alternatingLesson.locator('.mini-lesson-main').click();
          assert.notEqual(await alternatingLesson.locator('.mini-lesson-main > strong').innerText(), subject);
          await page.getByRole('radiogroup', { name: 'Тип недели' }).getByRole('radio', { name: 'Знаменатель' }).click();
          assert.equal(await page.locator('.week-list .mini-lesson').filter({ has: page.locator('.lesson-choice-hint') }).first().locator('.mini-lesson-main > strong').innerText(), subject);
        }
      }
      if (viewport.width === 1440) {
        const brand = page.locator('.brand-button');
        await brand.click();
        await page.locator('.group-picker-search input').waitFor();
        assert.equal(await page.locator('.group-picker-search input').evaluate((element) => document.activeElement === element), true);
        await page.locator('.group-share-button').focus();
        await page.keyboard.press('Tab');
        assert.equal(await page.locator('.group-picker-sheet').evaluate((element) => element.contains(document.activeElement)), true);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.group-picker-sheet').count(), 0);
        assert.equal(await brand.evaluate((element) => document.activeElement === element), true);
      }
      assert.deepEqual(errors, []);
      await page.close();
    }

    const notePage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await notePage.addInitScript(() => {
      localStorage.setItem('lad.notes.fallback', JSON.stringify([{
        id: 'desktop-delete-qa', text: 'Проверка удаления', title: 'Проверка удаления', kind: 'task', space: 'Дела',
        confidence: 1, status: 'open', pinned: false, createdAt: '2026-11-06T10:00:00.000Z',
        updatedAt: '2026-11-06T10:00:00.000Z', classificationSource: 'local'
      }]));
    });
    await notePage.goto(url, { waitUntil: 'domcontentloaded' });
    await notePage.locator('.bottom-nav').getByRole('button', { name: 'Записи' }).click();
    const deleteButton = notePage.getByRole('button', { name: 'Удалить запись «Проверка удаления»' });
    await deleteButton.waitFor({ state: 'visible' });
    await deleteButton.click();
    await notePage.locator('[data-note-id="desktop-delete-qa"]').waitFor({ state: 'detached' });
    assert.deepEqual(await notePage.evaluate(() => JSON.parse(localStorage.getItem('lad.notes.deleted.v1') || '[]')), ['desktop-delete-qa']);
    await notePage.close();
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
