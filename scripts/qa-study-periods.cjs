const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const reviewed = JSON.parse(fs.readFileSync('src/data/studyPeriods.json', 'utf8'));
const catalog = JSON.parse(fs.readFileSync('public/data/catalog.json', 'utf8'));
const root = process.env.QA_URL || 'http://127.0.0.1:4173/';
const appOrigin = new URL(root).origin;
const groupUrl = (nrec) => {
  const institute = catalog.institutes.find((entry) => entry.groups.some((group) => group.nrec === nrec));
  assert(institute, nrec);
  return new URL(`?group=${nrec}&institute=${institute.id}`, root).href;
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  fs.mkdirSync('artifacts/qa/study-periods', { recursive: true });
  try {
    const context = await browser.newContext({ viewport: { width: 402, height: 874 }, serviceWorkers: 'block', timezoneId: 'Europe/Moscow' });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('https://**/*', (route) => new URL(route.request().url()).origin === appOrigin ? route.continue() : route.abort());
      await page.clock.setFixedTime(new Date('2026-10-09T12:00:00+03:00'));
      for (const group of reviewed.groups) {
        await page.goto(groupUrl(group.nrec), { waitUntil: 'domcontentloaded' });
        const panel = page.getByRole('region', { name: 'Учебный календарь' });
        await panel.waitFor({ timeout: 15000 });
        assert.equal(await page.getByText('Сегодня без пар').count(), 0);
        await panel.locator('.study-period-list button').first().click();
        const calendar = page.getByRole('dialog', { name: 'Календарь', exact: true });
        await calendar.waitFor();
        await calendar.locator('.calendar-study-period').first().waitFor();
        assert.match(await calendar.locator('.calendar-empty-day').innerText(), /пока не получено/);
        assert.equal(await calendar.getByText('Свободный день', { exact: true }).count(), 0);
        const selectedDay = calendar.locator('.calendar-grid > button.selected');
        const date = (await selectedDay.getAttribute('aria-label')).split(':')[0];
        const first = group.periods.find((period) => period.end >= '2026-10-09');
        assert.equal(date, first.start.split('-').reverse().join('.'));
        await calendar.getByRole('button', { name: 'Закрыть календарь' }).click();
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ group: group.name, openedDate: date, errors }));
      }
      await page.clock.setFixedTime(new Date('2027-01-11T12:00:00+03:00'));
      await page.goto(groupUrl('7936a2a43b11b20b01d30f5b00c73166'), { waitUntil: 'domcontentloaded' });
      await page.locator('.bottom-nav').getByRole('button', { name: 'Неделя', exact: true }).click();
      await page.getByRole('button', { name: 'Открыть календарь расписания' }).click();
      const archivedCalendar = page.getByRole('dialog', { name: 'Календарь', exact: true });
      await archivedCalendar.waitFor();
      assert.match(await archivedCalendar.locator('.calendar-empty-day').innerText(), /пока не получено/);
      assert.equal(await archivedCalendar.getByText('Свободный день', { exact: true }).count(), 0);
      console.log(JSON.stringify({ group: 'ПИ-124', outsideSemester: 'not reported as a free day' }));
    } finally { await context.close(); }

    for (const viewport of [{ width: 402, height: 874 }, { width: 430, height: 932 }, { width: 874, height: 402 }, { width: 1440, height: 900 }]) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block', timezoneId: 'Europe/Moscow' });
      try {
        const page = await context.newPage();
        await page.route('https://**/*', (route) => new URL(route.request().url()).origin === appOrigin ? route.continue() : route.abort());
        await page.clock.setFixedTime(new Date('2026-10-09T12:00:00+03:00'));
        await page.goto(groupUrl('751fe4ad3947f2ea2f0a8ea1e54f3357'), { waitUntil: 'domcontentloaded' });
        const panel = page.getByRole('region', { name: 'Учебный календарь' });
        await panel.waitFor({ timeout: 15000 });
        await panel.locator('.study-period-list button').first().scrollIntoViewIfNeeded();
        await page.screenshot({ path: `artifacts/qa/study-periods/periods-${viewport.width}.png` });
        await panel.locator('.study-period-list button').first().click();
        const calendar = page.getByRole('dialog', { name: 'Календарь', exact: true });
        await calendar.waitFor();
        await page.waitForTimeout(400);
        const box = await calendar.boundingBox();
        assert(box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: `artifacts/qa/study-periods/calendar-${viewport.width}.png` });
        await calendar.getByRole('button', { name: 'Следующий месяц', exact: true }).click();
        await page.waitForTimeout(400);
        assert.equal(await calendar.locator('.calendar-study-period').count(), 0);
        assert.match(await calendar.locator('.calendar-agenda > header > div').innerText(), /Пары не загружены/);
        console.log(JSON.stringify({ viewport, calendarRect: box, nextMonth: 'unknown lessons remain unknown' }));
      } finally { await context.close(); }
    }
    if (process.env.QA_OFFLINE_CHECK === '1') {
      const context = await browser.newContext({ viewport: { width: 402, height: 874 }, timezoneId: 'Europe/Moscow' });
      try {
        const page = await context.newPage();
        await page.clock.setFixedTime(new Date('2026-10-09T12:00:00+03:00'));
        await page.goto(groupUrl('b7348799e3b73ea57b363d1edcf9a30a'), { waitUntil: 'domcontentloaded' });
        await page.getByRole('region', { name: 'Учебный календарь' }).waitFor({ timeout: 15000 });
        await page.waitForFunction(async () => Boolean(navigator.serviceWorker.controller
          && await caches.match(new URL('./data/university-schedule.json', location.href).href)), null, { timeout: 30000 });
        await context.setOffline(true);
        await page.reload({ waitUntil: 'domcontentloaded' });
        const panel = page.getByRole('region', { name: 'Учебный календарь' });
        await panel.waitFor({ timeout: 15000 });
        await panel.locator('.study-period-list button').first().click();
        await page.getByRole('dialog', { name: 'Календарь', exact: true }).waitFor();
        assert.match(await page.locator('.calendar-study-period').first().innerText(), /Практика/);
        await page.screenshot({ path: 'artifacts/qa/study-periods/offline-402.png' });
        console.log(JSON.stringify({ offline: true, group: 'ЗМТИ-122', calendarOpened: true }));
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
