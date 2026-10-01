const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const nrec = '04bd2331c4bbfdbd408a52e99d336ff6';
const snapshot = JSON.parse(fs.readFileSync(`public/data/ocr-schedule/${nrec}.json`, 'utf8'));
const output = 'artifacts/qa/teaching-weeks';
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
  try {
    for (const viewport of [{ width: 402, height: 874 }, { width: 430, height: 932 }]) {
      for (const [date, expected] of [['2026-10-23', 1], ['2026-11-06', 0]]) {
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
        const lesson = page.locator('.lesson-row').filter({ hasText: 'Теоретические основы создания микроклимата' });
        const found = await lesson.count();
        assert.equal(found, expected);
        const todayCount = await page.locator('.lesson-row').count();
        await page.getByRole('button', { name: 'Неделя', exact: true }).click();
        await page.locator('.week-list .mini-lesson').first().waitFor();
        const friday = page.locator('.day-block').filter({ has: page.getByRole('button', { name: 'Открыть расписание: Пятница', exact: true }) });
        const weekFound = await friday.locator('.mini-lesson').filter({ hasText: 'Теоретические основы создания микроклимата' }).count();
        assert.equal(weekFound, expected);
        await friday.scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${output}/week-${date}-${viewport.width}.png` });
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ viewport, date, expected, found, weekFound, todayCount, errors }));
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
