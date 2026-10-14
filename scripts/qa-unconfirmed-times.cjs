const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = 'https://lad-qa.test/';
const dist = path.resolve('dist');
const output = 'artifacts/qa/unconfirmed-times';
const nrec = '7936a2a43b11b20b01d30f5b00c73166';
const snapshot = JSON.parse(fs.readFileSync(path.join(dist, `data/schedule/${nrec}.json`), 'utf8'));
const bundle = JSON.parse(fs.readFileSync(path.join(dist, 'data/university-schedule.json'), 'utf8'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
fs.mkdirSync(output, { recursive: true });

(async () => {
  const { scheduleQuality, sha256 } = await import('./snapshot/buildSnapshot.mjs');
  snapshot.schedule = [
    { type: 'DatedLesson', date: '2026-01-21', start: '08:30', end: '10:00', name: '101-6, лб, Примеров А.А., Подтверждённый предмет А' },
    { type: 'DatedLesson', date: '2026-01-21', start: '10:20', end: '11:50', name: '102-6, лб, Примеров Б.Б., Подтверждённый предмет Б' },
    { type: 'DatedLesson', date: '2026-01-21', start: '16:00', timeStatus: 'unconfirmed', name: '306-6, экз, Примеров В.В., Предмет с конфликтом времени А' },
    { type: 'DatedLesson', date: '2026-01-21', start: '16:00', timeStatus: 'unconfirmed', name: '201-6, зач, Примеров Г.Г., Предмет с конфликтом времени Б' }
  ];
  snapshot.semester = null;
  snapshot.capturedAt = '2026-01-21T08:00:00Z';
  snapshot.validFrom = snapshot.validThrough = '2026-01-21';
  snapshot.quality = scheduleQuality(snapshot.schedule);
  snapshot.scheduleHash = sha256({ semester: null, schedule: snapshot.schedule });
  delete snapshot.sourceDocument;
  bundle.groups[nrec] = snapshot;

  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    for (const theme of ['ember', 'obsidian']) {
      for (const viewport of [{ width: 402, height: 874 }, { width: 430, height: 932 }, { width: 874, height: 402 }, { width: 1440, height: 900 }]) {
        const context = await browser.newContext({ viewport, hasTouch: viewport.width < 960, isMobile: viewport.width < 960,
          serviceWorkers: 'block', timezoneId: 'Europe/Moscow' });
        try {
          let dataBlocked = false;
          await context.route('**/*', async (route) => {
            const url = new URL(route.request().url());
            if (url.origin !== new URL(root).origin || url.pathname.includes('vlsu-api')) return route.abort();
            if (dataBlocked && url.pathname.startsWith('/data/')) return route.abort();
            if (url.pathname === `/data/schedule/${nrec}.json`) return route.fulfill({ json: snapshot });
            if (url.pathname === '/data/university-schedule.json') return route.fulfill({ json: bundle });
            const file = path.resolve(dist, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
            if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.abort();
            return route.fulfill({ body: fs.readFileSync(file), contentType: mime[path.extname(file)] || 'application/octet-stream' });
          });
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', (error) => errors.push(error.message));
          await page.addInitScript((theme) => {
            localStorage.setItem('lad.theme-schema', '2026-08-ember');
            localStorage.setItem('lad.theme', theme);
            Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
          }, theme);
          await page.clock.setFixedTime(new Date('2026-01-21T18:00:00+03:00'));
          await page.goto(new URL(`?group=${nrec}&institute=${snapshot.group.instituteId}`, root).href, { waitUntil: 'domcontentloaded' });
          await page.locator('.hero-card.mode-unconfirmed').waitFor();
          assert.match(await page.locator('.hero-meta').innerText(), /Время уточняется/);
          assert.doesNotMatch(await page.locator('.hero-card').innerText(), /Все пары пройдены|Пара идёт|мин осталось|undefined|NaN/);
          assert.match(await page.locator('.timeline-summary').innerText(), /2\/4 пройдено/);
          const pending = page.locator('.lesson-row').filter({ has: page.locator('.lesson-title', { hasText: 'Предмет с конфликтом' }) });
          assert.equal(await pending.count(), 2);
          assert(await pending.evaluateAll((nodes) => nodes.every((node) => !node.classList.contains('past') && !node.classList.contains('current'))));
          await page.screenshot({ path: `${output}/today-${theme}-${viewport.width}.png` });
          await pending.first().locator('.lesson-row-button').click();
          await pending.first().getByRole('button', { name: 'Записка', exact: true }).click();
          const composer = page.locator('.note-composer');
          await composer.waitFor();
          assert.match(await composer.locator('.composer-lesson-context').innerText(), /Предмет с конфликтом/);
          await composer.locator('[contenteditable="true"]').first().fill('Уточнить время занятия у преподавателя');
          await composer.getByRole('button', { name: 'Сохранить запись' }).click();
          await composer.waitFor({ state: 'hidden' });
          await page.locator('.bottom-nav').getByRole('button', { name: 'Сегодня', exact: true }).click();

          await page.locator('.today-date-launch').click();
          const calendar = page.getByRole('dialog', { name: 'Календарь', exact: true });
          await calendar.locator('.calendar-event.lesson').first().waitFor();
          assert.equal(await calendar.locator('.calendar-event.lesson').count(), 4);
          assert.equal(await calendar.locator('.calendar-event.lesson').filter({ hasText: 'Время уточняется' }).count(), 2);
          const [download] = await Promise.all([page.waitForEvent('download'), calendar.locator('.calendar-export-primary').click()]);
          const ics = fs.readFileSync(await download.path(), 'utf8').replace(/\r\n[ \t]/g, '');
          assert.equal(ics.split('BEGIN:VEVENT').length - 1, 2);
          assert.doesNotMatch(ics, /Предмет с конфликтом/);
          assert.match(await calendar.getByRole('status').innerText(), /3 события: время уточняется/);
          assert.equal(await calendar.locator('.calendar-event.note').filter({ hasText: 'Время уточняется' }).count(), 1);
          await page.screenshot({ path: `${output}/calendar-${theme}-${viewport.width}.png` });
          await calendar.getByRole('button', { name: 'Закрыть календарь' }).click();
          await page.locator('.bottom-nav').getByRole('button', { name: 'Неделя', exact: true }).click();
          await page.locator('.mini-lesson-main').first().waitFor();
          assert.equal(await page.locator('.mini-lesson-main').count(), 4);
          assert.equal(await page.locator('.mini-lesson-main').filter({ hasText: 'Время уточняется' }).count(), 2);
          await page.screenshot({ path: `${output}/week-${theme}-${viewport.width}.png` });
          dataBlocked = true;
          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.locator('.bottom-nav').getByRole('button', { name: 'Сегодня', exact: true }).click();
          await page.locator('.hero-card.mode-unconfirmed').waitFor();
          assert.equal(await page.locator('.lesson-row').count(), 4);
          await page.locator('.bottom-nav').getByRole('button', { name: 'Записи', exact: true }).click();
          await page.locator('.note-card').filter({ hasText: 'Уточнить время занятия у преподавателя' }).first().waitFor();
          await page.locator('.bottom-nav').getByRole('button', { name: 'Сегодня', exact: true }).click();
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
          assert.deepEqual(errors, []);
          console.log(JSON.stringify({ theme, viewport, endNotInvented: true, exportCount: 2, visibleCount: 4,
            cachedReloadWithDataNetworkBlocked: true, savedLinkedNoteReload: true, noteContext: true, errors }));
        } finally { await context.close(); }
      }
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
