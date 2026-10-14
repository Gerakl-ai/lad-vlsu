const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

// Compiled browser fixture, not a replacement for physical iOS or SW install QA.
const base = process.env.QA_BASE || '/';
const root = new URL(base, 'https://lad-qa.test').href;
const dist = path.resolve('dist');
const output = 'artifacts/qa/schedule-comparison';
const catalog = JSON.parse(fs.readFileSync(path.join(dist, 'data/catalog.json'), 'utf8'));
const bundle = JSON.parse(fs.readFileSync(path.join(dist, 'data/university-schedule.json'), 'utf8'));
const firstId = '7936a2a43b11b20b01d30f5b00c73166';
const secondId = '0107a80d5bdd182f4b2609a637266fb7';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
const fixture = JSON.parse(JSON.stringify(bundle.groups[secondId]));
fixture.semester = 5;
fixture.validFrom = '2026-09-01';
fixture.validThrough = '2026-12-31';
fixture.capturedAt = '2026-10-06T08:00:00Z';
fixture.schedule = [
  { type: 'DatedLesson', date: '2026-10-06', start: '10:20', end: '11:50', name: '101-3, лб, Примеров А.А., Длинное название предмета для проверки сравнения расписаний' },
  { type: 'DatedLesson', date: '2026-10-06', start: '15:50', end: '17:20', name: '103-3, лк, Примеров Б.Б., Второй предмет' }
];
delete fixture.sourceDocument;
fs.mkdirSync(output, { recursive: true });

function profile(nrec) {
  const institute = catalog.institutes.find((item) => item.groups.some((group) => group.nrec === nrec));
  const group = institute.groups.find((item) => item.nrec === nrec);
  return { ...group, id: nrec, instituteId: institute.id, instituteName: institute.name, instituteShortName: institute.shortName, visualKey: 'institute-1' };
}

(async () => {
  const { scheduleQuality, sha256 } = await import('./snapshot/buildSnapshot.mjs');
  function sign(snapshot) {
    snapshot.quality = scheduleQuality(snapshot.schedule);
    snapshot.scheduleHash = sha256({ semester: snapshot.semester, schedule: snapshot.schedule });
    return snapshot;
  }
  sign(fixture);
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    for (const theme of ['ember', 'obsidian']) {
      for (const viewport of [{ width: 402, height: 874 }, { width: 430, height: 932 }, { width: 874, height: 402 }, { width: 1440, height: 900 }]) {
        const context = await browser.newContext({ viewport, hasTouch: viewport.width < 960, isMobile: viewport.width < 960, serviceWorkers: 'block', timezoneId: 'Europe/Moscow' });
        try {
          let blocked = false;
          let secondary = fixture;
          let secondaryGate = null;
          await context.route('**/*', async (route) => {
            const url = new URL(route.request().url());
            if (url.origin !== new URL(root).origin || /\/(app-api|vlsu-api)\//.test(url.pathname)) return route.abort();
            if (!url.pathname.startsWith(base)) return route.abort();
            const pathname = url.pathname.slice(base.length - 1);
            if (blocked && pathname.startsWith('/data/')) return route.abort();
            if (pathname === `/data/schedule/${secondId}.json`) {
              if (secondaryGate) await secondaryGate;
              return route.fulfill({ json: secondary });
            }
            if (pathname === '/data/university-schedule.json') return route.fulfill({ json: { ...bundle, groups: { ...bundle.groups, [secondId]: secondary } } });
            const file = path.resolve(dist, `.${decodeURIComponent(pathname === '/' ? '/index.html' : pathname)}`);
            if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.abort();
            return route.fulfill({ body: fs.readFileSync(file), contentType: mime[path.extname(file)] || 'application/octet-stream' });
          });
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', (error) => errors.push(error.message));
          await page.addInitScript(({ group, theme }) => {
            if (!localStorage.getItem('lad.selected-group.v2')) localStorage.setItem('lad.selected-group.v2', JSON.stringify(group));
            localStorage.setItem('lad.theme-schema', '2026-08-ember');
            localStorage.setItem('lad.theme', theme);
          }, { group: profile(firstId), theme });
          await page.clock.setFixedTime(new Date('2026-10-06T09:40:00+03:00'));
          await page.goto(root, { waitUntil: 'domcontentloaded' });
          await page.locator('.lesson-row').first().waitFor();
          const initialSelection = await page.evaluate(() => localStorage.getItem('lad.selected-group.v2'));
          const originalChoice = await page.evaluate((nrec) => localStorage.getItem(`lad.lesson-selection.v1:${nrec}:5`), firstId);
          const nav = (label) => page.locator('.bottom-nav').getByRole('button', { name: label, exact: true });
          await nav('Неделя').click();
          await page.getByRole('button', { name: 'Сравнить группы', exact: true }).click();
          const sheet = page.getByRole('dialog', { name: 'Сравнить группы', exact: true });
          await sheet.waitFor();
          await sheet.locator('.comparison-groups button').click();
          const picker = page.getByRole('dialog', { name: 'Вторая группа', exact: true });
          await picker.getByRole('textbox').fill(profile(secondId).name);
          await picker.locator('.group-picker-row.group-row').filter({ hasText: profile(secondId).name }).first().click();
          await sheet.locator('.comparison-column:nth-child(2) .comparison-lesson').first().waitFor();
          assert.equal(await sheet.locator('.comparison-column:nth-child(2) .comparison-lesson').count(), 2);
          assert.match(await sheet.locator('.comparison-column:first-child').innerText(), /искусственного интеллекта/i);
          assert.equal(await page.evaluate(() => localStorage.getItem('lad.selected-group.v2')), initialSelection);
          assert.equal(await page.evaluate((nrec) => localStorage.getItem(`lad.lesson-selection.v1:${nrec}:5`), firstId), originalChoice);
          assert.match(await sheet.locator('.comparison-windows').innerText(), /08:00-08:30/);
          assert.match(await sheet.locator('.comparison-windows').innerText(), /11:50-15:50/);
          assert.equal(await sheet.locator('.comparison-overlap-label').count(), 2);
          const metrics = await sheet.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const scroll = element.querySelector('.comparison-scroll');
            return { width: innerWidth, height: innerHeight, top: rect.top, bottom: rect.bottom, sheetOverflow: element.scrollWidth - element.clientWidth,
              scrollOverflow: scroll.scrollWidth - scroll.clientWidth, documentOverflow: document.documentElement.scrollWidth - innerWidth };
          });
          assert.equal(metrics.documentOverflow, 0);
          assert.equal(metrics.sheetOverflow, 0);
          assert.equal(metrics.scrollOverflow, 0);
          assert(metrics.top >= 0 && metrics.bottom <= viewport.height);
          await page.screenshot({ path: `${output}/compare-${theme}-${viewport.width}.png` });

          await sheet.getByLabel('Дата сравнения').fill('2026-10-13');
          await page.waitForFunction(() => document.querySelector('.comparison-column:first-child')?.innerText.includes('Основы архитектуры'));
          assert.match(await sheet.locator('.comparison-column:first-child').innerText(), /архитектуры/i);
          assert.doesNotMatch(await sheet.locator('.comparison-column:first-child').innerText(), /Основы искусственного интеллекта/);
          await sheet.getByLabel('Дата сравнения').fill('2027-01-01');
          await sheet.getByRole('status').waitFor();
          assert.match(await sheet.getByRole('status').innerText(), /нужны данные/);
          assert.equal(await sheet.locator('.comparison-windows li').count(), 0);
          await sheet.getByLabel('Дата сравнения').fill('2026-10-06');
          await sheet.getByRole('button', { name: 'Закрыть сравнение' }).click();
          assert.equal(await page.locator('.phone-frame').getAttribute('inert'), null);
          await page.waitForFunction(() => document.activeElement?.textContent === 'Сравнить группы');

          if (viewport.width === 402 && theme === 'ember') {
            // A slow response must not hide the saved copy or win after switching groups.
            let release;
            secondaryGate = new Promise((resolve) => { release = resolve; });
            await page.getByRole('button', { name: 'Сравнить группы', exact: true }).click();
            await sheet.locator('.comparison-column:nth-child(2) .comparison-lesson').first().waitFor();
            assert.match(await sheet.locator('.comparison-windows').innerText(), /11:50-15:50/);
            await sheet.locator('.comparison-groups button').click();
            await picker.getByRole('textbox').fill('ПИ-123');
            await picker.locator('.group-picker-row.group-row').filter({ hasText: 'ПИ-123' }).first().click();
            await page.waitForFunction(() => document.querySelector('.comparison-column:nth-child(2) h3')?.textContent === 'ПИ-123');
            release();
            secondaryGate = null;
            await sheet.getByRole('button', { name: 'Обновить вторую группу' }).waitFor();
            await page.waitForFunction(() => document.querySelector('.comparison-footer button')?.disabled === false);
            assert.equal(await sheet.locator('.comparison-column:nth-child(2) h3').innerText(), 'ПИ-123');
            assert.equal(await page.evaluate(() => localStorage.getItem('lad.selected-group.v2')), initialSelection);
            await sheet.locator('.comparison-groups button').click();
            await picker.getByRole('textbox').fill(profile(secondId).name);
            await picker.locator('.group-picker-row.group-row').filter({ hasText: profile(secondId).name }).first().click();
            await sheet.locator('.comparison-column:nth-child(2) .comparison-lesson').first().waitFor();
            for (let index = 0; index < 12; index++) {
              await page.keyboard.press('Tab');
              assert(await sheet.evaluate((element) => element.contains(document.activeElement)));
            }
            await page.keyboard.press('Escape');
          }

          // A reload with all data requests blocked still opens both device snapshots.
          blocked = true;
          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.locator('.lesson-row').first().waitFor();
          await nav('Неделя').click();
          await page.getByRole('button', { name: 'Сравнить группы', exact: true }).click();
          await sheet.locator('.comparison-column:nth-child(2) .comparison-lesson').first().waitFor();
          assert.equal(await sheet.locator('.comparison-column:nth-child(2) .comparison-lesson').count(), 2);
          assert.match(await sheet.locator('.comparison-windows').innerText(), /11:50-15:50/);
          assert.equal(await page.evaluate(() => localStorage.getItem('lad.selected-group.v2')), initialSelection);
          await page.keyboard.press('Escape');
          await sheet.waitFor({ state: 'hidden' });

          if (viewport.width === 402 && theme === 'ember') {
            // A later valid source with no end cannot produce an apparent free interval.
            blocked = false;
            secondary = sign({ ...fixture, capturedAt: '2026-10-06T09:00:00Z', schedule: [...fixture.schedule,
              { type: 'DatedLesson', date: '2026-10-06', start: '16:00', timeStatus: 'unconfirmed', name: '104-3, экз, Примеров В.В., Время нужно уточнить' }] });
            await page.getByRole('button', { name: 'Сравнить группы', exact: true }).click();
            await sheet.getByRole('button', { name: 'Обновить вторую группу' }).click();
            await page.waitForFunction(() => document.querySelector('.comparison-column:nth-child(2)')?.innerText.includes('Время нужно уточнить'));
            assert.match(await sheet.getByRole('status').innerText(), /Время некоторых занятий уточняется/);
            assert.equal(await sheet.locator('.comparison-windows li').count(), 0);
            await page.screenshot({ path: `${output}/uncertain-${theme}-${viewport.width}.png` });
            await page.keyboard.press('Escape');
            // Removing only this synthetic secondary cache is QA isolation, never user data cleanup.
            await page.evaluate((nrec) => { localStorage.removeItem(`lad.schedule.v2:${nrec}`); }, secondId);
            blocked = true;
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.locator('.lesson-row').first().waitFor();
            await nav('Неделя').click();
            await page.getByRole('button', { name: 'Сравнить группы', exact: true }).click();
            await sheet.getByRole('status').waitFor();
            assert.match(await sheet.getByRole('status').innerText(), /нужны данные|Проверяем/);
            assert.equal(await sheet.locator('.comparison-windows li').count(), 0);
            await page.keyboard.press('Escape');
          }
          assert.deepEqual(errors, []);
          console.log(JSON.stringify({ base, theme, viewport, metrics, cachedDataReload: true, primaryUnchanged: true, weeksSwap: true, errors }));
        } finally { await context.close(); }
      }
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
