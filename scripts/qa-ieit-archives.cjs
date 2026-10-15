const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const base = process.env.QA_BASE || '/';
const root = new URL(base, 'https://lad-qa.test/').href;
const dist = path.resolve('dist');
const dataRoot = path.resolve(process.env.QA_DATA_DIR || 'dist/data');
const output = process.env.QA_OUTPUT || 'artifacts/qa/ieit-archives';
const reviews = JSON.parse(fs.readFileSync('scripts/pdf/reviewed-dated-ieit-january-2026.json', 'utf8')).groups;
const snapshots = reviews.map((group) => JSON.parse(fs.readFileSync(path.join(dataRoot, `schedule/${group.groupNrec}.json`), 'utf8')));
const catalog = JSON.parse(fs.readFileSync(path.join(dataRoot, 'catalog.json'), 'utf8'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    for (const theme of ['ember', 'obsidian']) {
      for (const viewport of [{ width: 402, height: 874 }, { width: 430, height: 932 }, { width: 874, height: 402 }, { width: 1440, height: 900 }]) {
        const context = await browser.newContext({ viewport, hasTouch: viewport.width < 960, isMobile: viewport.width < 960,
          serviceWorkers: 'block', timezoneId: 'Europe/Moscow' });
        try {
          // The general package is the saved-bundle fixture. Individual groups and APIs never respond.
          await context.route('**/*', async (route) => {
            const url = new URL(route.request().url());
            if (url.origin !== new URL(root).origin || /\/(?:vlsu-api|app-api)\//.test(url.pathname)
              || /\/data\/(?:schedule|ocr-schedule)\//.test(url.pathname)) return route.abort();
            if (!url.pathname.startsWith(base)) return route.abort();
            const resource = url.pathname.slice(base.length - 1);
            const directory = resource.startsWith('/data/') ? dataRoot : dist;
            const pathname = resource.startsWith('/data/') ? resource.slice(5) : resource;
            const file = path.resolve(directory, `.${decodeURIComponent(pathname === '/' ? '/index.html' : pathname)}`);
            if (!file.startsWith(directory + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.abort();
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
          await page.clock.setFixedTime(new Date('2026-10-15T12:00:00+03:00'));
          await page.goto(root, { waitUntil: 'domcontentloaded' });
          const selected = viewport.width === 402 && theme === 'ember' ? snapshots
            : snapshots.filter((snapshot) => ['ЗГМУмд-125', 'ЗГДуд-125'].includes(snapshot.group.name));
          for (const snapshot of selected) {
            const firstRun = await page.locator('.group-picker-sheet').count();
            if (!firstRun) await page.locator('.brand-button').click();
            await page.locator('.group-picker-search input').fill(snapshot.group.name);
            await page.locator('.group-picker-row.group-row').filter({ hasText: snapshot.group.name }).first().click();
            await page.locator('.bottom-nav').getByRole('button', { name: 'Сегодня', exact: true }).click();
            await page.getByRole('button', { name: 'Открыть сохранённые занятия', exact: true }).waitFor();
            assert.equal(await page.locator('.hero-card').count(), 0);
            await page.locator('.bottom-nav').getByRole('button', { name: 'Неделя', exact: true }).click();
            await page.locator('.session-view .mini-lesson-main').first().waitFor();
            assert.equal(await page.locator('.mini-lesson-main').count(), snapshot.schedule.length);
            assert.match(await page.locator('.week-toolbar-copy').innerText(), /Архив/);
            assert.doesNotMatch(await page.locator('.session-view').innerText(), /M\d{8,}|undefined|NaN|17:30/);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
            assert.equal(await page.locator('.bottom-nav').evaluate((node) => Math.round(node.getBoundingClientRect().bottom)), viewport.height);
            await page.screenshot({ path: `${output}/week-${snapshot.group.nrec}-${theme}-${viewport.width}.png` });
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.locator('.bottom-nav').getByRole('button', { name: 'Неделя', exact: true }).click();
            await page.locator('.mini-lesson-main').first().waitFor();
            assert.equal(await page.locator('.mini-lesson-main').count(), snapshot.schedule.length);
            console.log(JSON.stringify({ group: snapshot.group.name, theme, viewport, intervals: snapshot.schedule.length,
              individualAndApiDenied: true, savedBundleFixture: true, reload: true, overflow: 0 }));
          }

          const restoredId = '0107a80d5bdd182f4b2609a637266fb7';
          if (catalog.recovery?.restoredGroupIds.includes(restoredId)) {
            await page.locator('.brand-button').click();
            await page.locator('.group-picker-search input').fill('С-424');
            await page.locator('.group-picker-row.group-row').filter({ has: page.locator('.group-picker-copy strong', { hasText: /^С-424$/ }) }).click();
            await page.locator('.bottom-nav').getByRole('button', { name: 'Неделя', exact: true }).click();
            await page.locator('.mini-lesson-main').first().waitFor();
            assert(await page.locator('.mini-lesson-main').count() > 0);
            assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('lad.selected-group.v2')).nrec), restoredId);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
            await page.screenshot({ path: `${output}/restored-s424-${theme}-${viewport.width}.png` });
            console.log(JSON.stringify({ restoredCatalogGroup: 'С-424', catalogCount: catalog.groupCount, recoveredGroups: catalog.recovery.restoredGroupIds.length, theme, viewport }));
          }

          // Actual ambiguous cells: both subjects remain visible in Today, Calendar and comparison.
          const target = snapshots.find((snapshot) => snapshot.group.name === 'ЗГМУмд-125');
          await page.clock.setFixedTime(new Date('2026-01-21T18:00:00+03:00'));
          await page.goto(new URL(`?group=${target.group.nrec}&institute=${target.group.instituteId}`, root).href, { waitUntil: 'domcontentloaded' });
          await page.locator('.hero-card.mode-unconfirmed').waitFor();
          assert.equal(await page.locator('.lesson-row').count(), 3);
          assert.equal(await page.locator('.lesson-row .lesson-row-change').filter({ hasText: 'Время уточняется' }).count(), 2);
          assert.doesNotMatch(await page.locator('.hero-card').innerText(), /Все пары пройдены|мин осталось|Пара идёт/);
          await page.locator('.today-date-launch').click();
          const calendar = page.getByRole('dialog', { name: 'Календарь', exact: true });
          await calendar.locator('.calendar-event.lesson').first().waitFor();
          assert.equal(await calendar.locator('.calendar-event.lesson').count(), 3);
          assert.equal(await calendar.locator('.calendar-event.lesson').filter({ hasText: 'Время уточняется' }).count(), 2);
          const [download] = await Promise.all([page.waitForEvent('download'), calendar.locator('.calendar-export-primary').click()]);
          const raw = fs.readFileSync(await download.path(), 'utf8');
          const ics = raw.replace(/\r\n[ \t]/g, '');
          assert.equal(ics.split('BEGIN:VEVENT').length - 1, target.schedule.length - 2);
          assert.doesNotMatch(ics, /SUMMARY:Теория и механизмы|SUMMARY:Организация и управление проектной деятельностью/);
          assert(raw.split('\r\n').every((line) => Buffer.byteLength(line, 'utf8') <= 75));
          assert.match(await calendar.getByRole('status').innerText(), /2 события: время уточняется/);
          await page.screenshot({ path: `${output}/uncertain-calendar-${theme}-${viewport.width}.png` });
          await calendar.getByRole('button', { name: 'Закрыть календарь' }).click();
          await page.screenshot({ path: `${output}/uncertain-today-${theme}-${viewport.width}.png` });
          assert.deepEqual(errors, []);
        } finally { await context.close(); }
      }
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
