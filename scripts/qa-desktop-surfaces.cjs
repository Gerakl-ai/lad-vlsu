const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

const tabs = ['Сегодня', 'Неделя', 'Записи', 'Настройки'];
const sizes = [{ width: 402, height: 874 }, { width: 932, height: 430 }, { width: 960, height: 600 }, { width: 1440, height: 900 }, { width: 2560, height: 1440 }];
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
      await page.clock.install({ time: new Date('2026-10-05T16:00:00Z') });
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.locator('.bottom-nav').waitFor();
      for (const tab of tabs) {
        await page.locator('.bottom-nav').getByRole('button', { name: tab }).click();
        await page.waitForTimeout(250);
        if (tab === 'Сегодня') {
          await page.locator('.upcoming-study').waitFor();
          assert.match(await page.locator('.upcoming-study').innerText(), /6 октября/);
        }
        if (tab === 'Записи' && viewport.width >= 960) {
          const empty = page.locator('.notes-empty');
          await empty.waitFor();
          assert.ok((await empty.boundingBox()).height >= 320);
          assert.equal(await empty.getByRole('button', { name: 'Создать запись' }).isVisible(), true);
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
          return { viewport: innerWidth, frame: rect('.phone-frame'), content: rect('.content-scroll'),
            primary: rect('.today-primary, .week-overview, .notes-dashboard, .settings-view'),
            secondary: rect('.today-detail-scroll, .week-list, .notes-list'),
            weekColumns: document.querySelector('.week-list') ? getComputedStyle(document.querySelector('.week-list')).gridTemplateColumns.split(' ').length : null,
            overflow: document.documentElement.scrollWidth > innerWidth };
        });
        assert.equal(metrics.overflow, false);
        assert.ok(metrics.frame?.right <= viewport.width + 1);
        if (viewport.width === 402 || viewport.height < 600) {
          const navBottom = await page.locator('.bottom-nav').evaluate((element) => element.getBoundingClientRect().bottom);
          assert.ok(Math.abs(navBottom - viewport.height) <= 2);
        }
        if (viewport.width === 2560) {
          assert.ok(metrics.frame.width >= 1700);
          if (tab === 'Неделя') assert.equal(metrics.weekColumns, 2);
        }
        await page.screenshot({ path: `artifacts/qa/desktop-surfaces/${viewport.width}-${tab}.png` });
        console.log(JSON.stringify({ tab, ...viewport, ...metrics }));
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
