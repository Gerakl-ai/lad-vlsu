const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
  fs.mkdirSync('artifacts/qa/today-layout', { recursive: true });
  try {
    for (const viewport of [{ width: 402, height: 874 }, { width: 874, height: 402 }, { width: 1440, height: 900 }]) {
      for (const empty of [false, true]) {
        const page = await browser.newPage({ viewport, serviceWorkers: 'block', timezoneId: 'Europe/Moscow' });
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.clock.setFixedTime(new Date('2026-09-23T06:00:00Z'));
        await page.addInitScript((empty) => {
          const lessons = empty ? [] : [
            { id: '1', dayIndex: 3, dayName: 'Среда', pairIndex: 1, start: '08:30', end: '10:00', subject: 'Алгоритмизация и программирование', rawText: 'Алгоритмизация и программирование', room: '111-3', weekMode: 'all' },
            { id: '2', dayIndex: 3, dayName: 'Среда', pairIndex: 2, start: '10:20', end: '11:50', subject: 'Базы данных', rawText: 'Базы данных', room: '120-3', weekMode: 'all' }
          ];
          localStorage.setItem('lad.selected-group.v2', JSON.stringify({ id: 'qa', nrec: 'qa', name: 'QA', instituteId: 'qa', instituteName: 'QA', instituteShortName: 'QA', visualKey: 'iite' }));
          localStorage.setItem('lad.schedule.v2:qa', JSON.stringify({ groupNrec: 'qa', currentInfo: { currentLesson: '', currentWeekType: 1, name: 'QA', semester: 1 }, allLessons: lessons, fetchedAt: new Date().toISOString() }));
        }, empty);
        await page.goto(process.env.QA_URL || 'http://127.0.0.1:5182/', { waitUntil: 'domcontentloaded' });
        await page.locator('.today-view').waitFor();
        if (empty) {
          assert.equal(await page.locator('.today-view .empty-state').count(), 0);
          await page.getByTestId('today-calendar-launch').click();
          await page.getByRole('dialog', { name: 'Календарь', exact: true }).waitFor();
          await page.getByRole('button', { name: 'Закрыть календарь', exact: true }).click();
        } else {
          assert.equal(await page.locator('.lesson-row').count(), 2);
          assert.match(await page.locator('.next-card').innerText(), /10:20–11:50/);
        }
        await page.screenshot({ path: `artifacts/qa/today-layout/${empty ? 'free' : 'lessons'}-${viewport.width}.png` });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        assert.equal(overflow, 0);
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ viewport, empty, overflow, errors }));
        await page.close();
      }
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
