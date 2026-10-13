const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

const root = process.env.QA_URL || 'http://127.0.0.1:4173/';
const output = 'artifacts/qa/dated-ibie-choices';
const snapshot = JSON.parse(fs.readFileSync('public/data/reviewed-schedule/758863665d107b41173fa4cb6ea3d1c2.json', 'utf8'));
const long = JSON.parse(fs.readFileSync('public/data/reviewed-schedule/1e53b2d5dc0e111e5f8fdc99404be601.json', 'utf8'));
const urlFor = (snapshot) => new URL(`?group=${snapshot.group.nrec}&institute=${snapshot.group.instituteId}`, root).href;
fs.mkdirSync(output, { recursive: true });

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
            Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
          }, theme);
          await page.route('https://**/*', (route) => new URL(route.request().url()).origin === new URL(root).origin ? route.continue() : route.abort());
          await page.clock.setFixedTime(new Date('2026-01-21T15:55:00+03:00'));
          await page.goto(urlFor(snapshot), { waitUntil: 'domcontentloaded' });
          const row = page.locator('.lesson-row').filter({ has: page.locator('.lesson-title', { hasText: 'Электротехника' }) }).first();
          await row.locator('.lesson-row-button').click();
          await row.getByRole('group', { name: 'Выбрать свою пару' }).getByRole('button', { name: /Электротехника/ }).click();
          assert.equal(await row.locator('.lesson-title').innerText(), 'Электротехника и промышленная электроника');
          assert.doesNotMatch(await row.locator('.lesson-row-button').innerText(), /101-СК1|Стародубцева/);
          await page.locator('.today-date-launch').click();
          const calendar = page.getByRole('dialog', { name: 'Календарь', exact: true });
          const event = calendar.locator('.calendar-event.lesson').filter({ hasText: 'Электротехника' });
          await event.waitFor();
          assert.doesNotMatch(await event.innerText(), /101-СК1|Стародубцева|Физическая культура/);
          const [download] = await Promise.all([page.waitForEvent('download'), calendar.locator('.calendar-export-primary').click()]);
          const rawIcs = fs.readFileSync(await download.path(), 'utf8');
          assert(rawIcs.split('\r\n').every((line) => Buffer.byteLength(line, 'utf8') <= 75));
          const ics = rawIcs.replace(/\r\n[ \t]/g, '');
          const record = ics.split('BEGIN:VEVENT').find((part) => part.includes('DTSTART:20260121T125000Z'));
          assert(record, 'chosen incomplete event missing from month export');
          assert.match(record, /DTEND:20260121T142000Z/);
          const visibleFields = record.split(/\r?\n/).filter((line) => !line.startsWith('UID:')).join('\n');
          assert.match(visibleFields, /SUMMARY:Электротехника и промышленная электроника/);
          assert.doesNotMatch(visibleFields, /101-СК1|Стародубцева|Физическая культура|LOCATION:/);
          await calendar.getByRole('button', { name: 'Закрыть календарь' }).click();
          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.locator('.bottom-nav').getByRole('button', { name: 'Неделя', exact: true }).click();
          const mini = page.locator('.mini-lesson').filter({ hasText: 'Электротехника' }).first();
          await mini.locator('.mini-lesson-main').waitFor();
          assert.doesNotMatch(await mini.locator('.mini-lesson-main').innerText(), /101-СК1|Стародубцева|Физическая культура/);
          await mini.scrollIntoViewIfNeeded();
          await page.screenshot({ path: `${output}/incomplete-${theme}-${viewport.width}.png` });

          await page.clock.setFixedTime(new Date('2026-01-19T14:05:00+03:00'));
          await page.goto(urlFor(long), { waitUntil: 'domcontentloaded' });
          await page.locator('.bottom-nav').getByRole('button', { name: 'Неделя', exact: true }).click();
          const title = page.locator('.mini-lesson-main > strong').filter({ hasText: 'Технологические добавки' }).first();
          await title.waitFor();
          const dateTimes = page.locator('.session-date-card time');
          assert(await dateTimes.count() > 0);
          assert(await dateTimes.evaluateAll((nodes) => nodes.every((node) => node.scrollWidth <= node.clientWidth + 1)));
          assert(await page.locator('.session-date-card small').evaluateAll((nodes) => nodes.every((node) => node.scrollWidth <= node.clientWidth + 1)));
          if (viewport.width === 874) {
            assert.equal(await page.locator('.week-toolbar h2').evaluate((node) => node.clientHeight <= parseFloat(getComputedStyle(node).lineHeight) + 1), true,
              'landscape heading breaks inside a word');
          }
          assert.equal(await title.innerText(), 'Технологические добавки и улучшители для производства продуктов питания из растительного сырья');
          assert.equal(await title.evaluate((node) => node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1), true);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
          assert.deepEqual(errors, []);
          await title.scrollIntoViewIfNeeded();
          await page.screenshot({ path: `${output}/long-${theme}-${viewport.width}.png` });
          console.log(JSON.stringify({ theme, viewport, missingMetadataNotInvented: true, choiceAcrossViews: true, calendarExport: true,
            reload: true, longSubjectNotClipped: true, errors }));
        } finally { await context.close(); }
      }
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
