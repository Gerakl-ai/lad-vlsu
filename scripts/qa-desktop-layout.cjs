const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

const viewports = [
  { width: 402, height: 874 },
  { width: 932, height: 430 },
  { width: 960, height: 600 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
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
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      try {
        await page.goto(qaUrl, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: 'Добавить событие' }).waitFor();
        await page.locator('.bottom-nav').getByRole('button', { name: 'Неделя' }).click();
        await page.locator('.week-view').waitFor();
        await page.waitForTimeout(450);
        const disclosure = page.locator('.week-map-disclosure');
        const desktop = viewport.width >= 960 && viewport.height >= 600;
        await page.waitForFunction((expected) => Boolean(document.querySelector('.week-map-disclosure')?.open) === expected, desktop);

        const geometry = await page.evaluate(() => {
          const frame = document.querySelector('.phone-frame').getBoundingClientRect();
          const view = document.querySelector('.week-view');
          const content = document.querySelector('.content-scroll');
          const nav = document.querySelector('.bottom-nav').getBoundingClientRect();
          return {
            frameWidth: frame.width,
            navBottom: nav.bottom,
            horizontalOverflow: view.scrollWidth > view.clientWidth
              || content.scrollWidth > content.clientWidth
              || document.documentElement.scrollWidth > innerWidth
          };
        });
        assert.equal(geometry.horizontalOverflow, false);
        if (desktop) assert.ok(geometry.frameWidth > 800);
        if (viewport.width === 402 || viewport.height < 600) {
          assert.ok(Math.abs(geometry.navBottom - viewport.height) <= 2);
        }

        await page.locator('.bottom-nav').getByRole('button', { name: 'Записи' }).click();
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
