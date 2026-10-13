const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

const root = process.env.QA_URL || 'http://127.0.0.1:4173/';
const output = 'artifacts/qa/dated-january-choices';
fs.mkdirSync(output, { recursive: true });
const snapshotFor = (id) => JSON.parse(fs.readFileSync(`public/data/reviewed-schedule/${id}.json`, 'utf8'));
const physics = snapshotFor('eb1699068dc6d88fc95596b8f623256d');
const sport = snapshotFor('1592481ca414e1cd9785c448151b7b81');
const urlFor = (snapshot) => new URL(`?group=${snapshot.group.nrec}&institute=${snapshot.group.instituteId}`, root).href;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    for (const theme of ['ember', 'obsidian']) {
      for (const viewport of [{ width: 375, height: 812 }, { width: 874, height: 402 }, { width: 1440, height: 900 }]) {
        const context = await browser.newContext({ viewport, hasTouch: viewport.width < 960, isMobile: viewport.width < 960,
          serviceWorkers: 'block', timezoneId: 'Europe/Moscow' });
        try {
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', (error) => errors.push(error.message));
          await page.addInitScript((theme) => {
            localStorage.setItem('lad.theme-schema', '2026-08-ember');
            localStorage.setItem('lad.theme', theme);
            // Exercise the download fallback without invoking a native share dialog.
            Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
          }, theme);
          await page.route('https://**/*', (route) => new URL(route.request().url()).origin === new URL(root).origin ? route.continue() : route.abort());
          await page.clock.setFixedTime(new Date('2026-01-29T12:20:00+03:00'));
          await page.goto(urlFor(physics), { waitUntil: 'domcontentloaded' });
          const row = page.locator('.lesson-row').filter({ has: page.locator('.lesson-title', { hasText: 'Физика' }) }).first();
          await row.locator('.lesson-row-button').click();
          await row.getByRole('group', { name: 'Выбрать свою пару' }).getByRole('button', { name: /425-3/ }).click();
          await page.locator('.today-date-launch').click();
          const calendar = page.getByRole('dialog', { name: 'Календарь', exact: true });
          const event = calendar.locator('.calendar-event.lesson').filter({ hasText: 'Физика' }).first();
          await event.waitFor();
          assert.match(await event.innerText(), /425-3/);
          assert.doesNotMatch(await event.innerText(), /424-3/);
          const [download] = await Promise.all([page.waitForEvent('download'), calendar.locator('.calendar-export-primary').click()]);
          const ics = fs.readFileSync(await download.path(), 'utf8');
          const record = ics.split('BEGIN:VEVENT').find((part) => part.includes('DTSTART:20260129T091000Z'));
          assert(record, 'chosen dated event missing from month export');
          assert.match(record, /LOCATION:425-3\r?\n/);
          assert.match(record, /DTEND:20260129T104000Z/);
          await calendar.getByRole('button', { name: 'Закрыть календарь' }).click();
          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.locator('.bottom-nav').getByRole('button', { name: 'Неделя', exact: true }).click();
          const mini = page.locator('.mini-lesson').filter({ hasText: 'Физика' }).first();
          await mini.locator('.mini-lesson-main').waitFor();
          assert.match(await mini.locator('.mini-lesson-main').innerText(), /425-3/);
          assert.doesNotMatch(await mini.locator('.mini-lesson-main').innerText(), /424-3/);
          await mini.scrollIntoViewIfNeeded();
          await page.screenshot({ path: `${output}/physics-${theme}-${viewport.width}.png` });

          await page.clock.setFixedTime(new Date('2026-01-27T08:40:00+03:00'));
          await page.goto(urlFor(sport), { waitUntil: 'domcontentloaded' });
          const sportsRow = page.locator('.lesson-row').first();
          await sportsRow.waitFor();
          assert.match(await sportsRow.locator('.lesson-title').innerText(), /Физическая культура и спорт.*Элективные/s);
          await page.locator('.bottom-nav').getByRole('button', { name: 'Неделя', exact: true }).click();
          const sportsMini = page.locator('.mini-lesson').filter({ hasText: 'Физическая культура и спорт' }).first();
          await sportsMini.locator('.mini-lesson-main').waitFor();
          assert.match(await sportsMini.locator('.mini-lesson-main').innerText(), /101-СК1/);
          const title = sportsMini.locator('.mini-lesson-main > strong');
          assert.match(await title.innerText(), /для инвалидов и лиц с ОВЗ/);
          assert.equal(await title.evaluate((node) => node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1), true, 'long printed subject is clipped');
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
          assert.deepEqual(errors, []);
          await sportsMini.scrollIntoViewIfNeeded();
          await page.screenshot({ path: `${output}/sport-${theme}-${viewport.width}.png` });
          console.log(JSON.stringify({ theme, viewport, roomChoiceAcrossViews: true, calendarExport: true, reload: true, longSubjectNotClipped: true, errors }));
        } finally { await context.close(); }
      }
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
