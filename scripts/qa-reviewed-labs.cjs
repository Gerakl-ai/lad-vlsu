const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const snapshot = JSON.parse(fs.readFileSync('public/data/ocr-schedule/7936a2a43b11b20b01d30f5b00c73166.json', 'utf8'));
fs.mkdirSync('artifacts/qa/reviewed-labs', { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
  try {
    for (const viewport of [{ width: 402, height: 874 }, { width: 874, height: 402 }]) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block', timezoneId: 'Europe/Moscow' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.clock.setFixedTime(new Date('2026-11-03T12:00:00+03:00'));
      await page.addInitScript((group) => localStorage.setItem('lad.selected-group.v2', JSON.stringify({ ...group, id: group.nrec, visualKey: 'institute-2' })), snapshot.group);
      await page.route('**/data/schedule/**', (route) => route.fulfill({ status: 404, body: '{}' }));
      await page.route('**/vlsu-api/**', (route) => route.fulfill({ status: 503, body: '{}' }));
      await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
      const testing = page.locator('.lesson-row').filter({ hasText: 'Тестирование информационных систем' });
      await testing.first().waitFor({ timeout: 12000 });
      assert.equal(await testing.count(), 2);
      for (const row of await testing.all()) {
        await row.locator('.lesson-row-button').click();
        const text = await row.innerText();
        assert(text.includes('лб') && text.includes('Градусов Д.А.'));
        assert(!text.includes(', 16,'));
      }
      await testing.first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `artifacts/qa/reviewed-labs/pi124-${viewport.width}.png` });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ viewport, laboratories: 2, errors }));
      await context.close();
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
