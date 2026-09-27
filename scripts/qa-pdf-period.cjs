const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
  fs.mkdirSync('artifacts/qa/pdf-period', { recursive: true });
  try {
    for (const scenario of [
      { name: 'inside', date: '2026-09-23T06:00:00Z', outside: false },
      { name: 'expired', date: '2027-02-03T06:00:00Z', outside: true }
    ]) {
      const page = await browser.newPage({ viewport: { width: 402, height: 874 }, serviceWorkers: 'block', timezoneId: 'Europe/Moscow' });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.clock.setFixedTime(new Date(scenario.date));
      await page.route('**/data/schedule/**', (route) => route.fulfill({ status: 404, body: '' }));
      await page.addInitScript(() => {
        const nrec = 'a'.repeat(32);
        const rawText = '111-3, лб, Пример П.П., Базы данных';
        localStorage.setItem('lad.selected-group.v2', JSON.stringify({ id: nrec, nrec, name: 'QA', instituteId: 'qa', instituteName: 'QA', instituteShortName: 'QA', visualKey: 'iite' }));
        localStorage.setItem(`lad.schedule.v2:${nrec}`, JSON.stringify({
          groupNrec: nrec,
          currentInfo: { currentLesson: '', currentWeekType: 1, name: 'QA', semester: 5 },
          allLessons: [{ id: 'qa-1', dayIndex: 3, dayName: 'Среда', pairIndex: 1, start: '08:30', end: '10:00', subject: 'Базы данных', rawText, room: '111-3', weekMode: 'all', validFrom: '2026-09-01', validThrough: '2026-12-30' }],
          fetchedAt: '2026-09-27T12:00:00Z', validFrom: '2026-09-01', validThrough: '2026-12-30',
          sourceDocument: { title: 'Расписание ИИТЭ', url: 'https://www.vlsu.ru/example.zip', sha256: 'b'.repeat(64), reviewedAt: '2026-09-27T12:00:00Z' }
        }));
      });
      await page.goto(process.env.QA_URL || 'http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
      await page.locator('.today-view').waitFor();
      if (scenario.outside) {
        await page.getByText('На эту дату расписание не подтверждено').waitFor();
        assert.equal(await page.getByText('Сегодня без пар').count(), 0);
      } else {
        await page.getByRole('heading', { name: 'Базы данных' }).waitFor();
      }
      await page.screenshot({ path: `artifacts/qa/pdf-period/${scenario.name}-today-402.png` });
      await page.getByRole('button', { name: 'Неделя', exact: true }).last().click();
      await page.locator('.week-view').waitFor();
      if (scenario.outside) await page.getByText('Проверенный документ не действует на эту дату.').first().waitFor();
      await page.screenshot({ path: `artifacts/qa/pdf-period/${scenario.name}-week-402.png` });
      await page.getByRole('button', { name: 'Настройки', exact: true }).last().click();
      await page.getByRole('button', { name: /Откуда данные/ }).click();
      await page.getByRole('link', { name: 'Расписание ИИТЭ' }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
      assert.deepEqual(errors, []);
      console.log(`${scenario.name}: today/week rendered, no overflow or JS errors`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
