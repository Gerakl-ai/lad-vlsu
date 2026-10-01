const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const nrec = '04bd2331c4bbfdbd408a52e99d336ff6';
const snapshot = JSON.parse(fs.readFileSync(`public/data/ocr-schedule/${nrec}.json`, 'utf8'));
const output = 'artifacts/qa/reviewed-periods';
fs.mkdirSync(output, { recursive: true });
const cases = [
  ['2026-09-29', 'Строительная механика (по 6 нед)', 'Маврина С.А.'],
  ['2026-10-13', 'Строительные машины и оборудование (с 7 по 10 нед)', 'Опарин Е.М.'],
  ['2026-11-10', 'Строительные машины и оборудование (с 11 по 14 нед)', 'Опарин Е.М.'],
  ['2026-12-08', null, null]
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
  try {
    for (const viewport of [{ width: 402, height: 874 }, { width: 430, height: 932 }, { width: 874, height: 402 }]) {
      for (const [date, subject, teacher] of cases) {
        const context = await browser.newContext({ viewport, serviceWorkers: 'block', timezoneId: 'Europe/Moscow' });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.clock.setFixedTime(new Date(`${date}T12:00:00+03:00`));
        await page.addInitScript((group) => localStorage.setItem('lad.selected-group.v2', JSON.stringify({ ...group, id: group.nrec, visualKey: 'institute-2' })), snapshot.group);
        await page.route('**/data/schedule/**', (route) => route.fulfill({ status: 404, body: '{}' }));
        await page.route('**/vlsu-api/**', (route) => route.fulfill({ status: 503, body: '{}' }));
        await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
        await page.locator('.lesson-row').first().waitFor({ timeout: 12000 });
        const seventh = page.locator('.lesson-row').filter({ hasText: '19:20' });
        assert.equal(await seventh.count(), subject ? 1 : 0);
        if (subject) {
          assert((await seventh.innerText()).includes(subject));
          await seventh.locator('.lesson-row-button').click();
          assert((await seventh.innerText()).includes(teacher));
          await seventh.scrollIntoViewIfNeeded();
        }
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${output}/${date}-${viewport.width}.png` });
        const metrics = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - innerWidth,
          navBottomGap: innerHeight - document.querySelector('.bottom-nav').getBoundingClientRect().bottom,
          titleBadgeGap: document.querySelector('.hero-sigil').getBoundingClientRect().left
            - document.querySelector('.hero-card h2').getBoundingClientRect().right
        }));
        assert.equal(metrics.overflow, 0);
        if (viewport.height > viewport.width) assert.equal(metrics.navBottomGap, 0);
        assert(metrics.titleBadgeGap >= 8, `Title overlaps timer: ${JSON.stringify(metrics)}`);
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ viewport, date, subject, teacher, ...metrics, errors }));
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
