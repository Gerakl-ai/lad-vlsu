const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { waitForAsyncCondition } = require('./qa-async-condition.cjs');

const root = process.env.QA_URL || 'http://127.0.0.1:4173/';
const reviews = JSON.parse(fs.readFileSync('scripts/spreadsheet/reviewed-spring-2026.json', 'utf8')).groups;
const snapshots = reviews.map((group) => JSON.parse(fs.readFileSync(`public/data/reviewed-schedule/${group.groupNrec}.json`, 'utf8')));
const output = 'artifacts/qa/dated-archives';
fs.mkdirSync(output, { recursive: true });
const urlFor = (snapshot) => new URL(`?group=${snapshot.group.nrec}&institute=${snapshot.group.instituteId}`, root).href;
const subject = (entry) => entry.name.split(',').slice(3).map((part) => part.trim()).join(', ');
const metrics = [];

async function geometry(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const value = document.querySelector(selector)?.getBoundingClientRect();
      return value && { x: value.x, y: value.y, width: value.width, height: value.height, bottom: value.bottom, right: value.right };
    };
    return { viewport: { width: innerWidth, height: innerHeight }, shell: rect('.phone-frame'), nav: rect('.bottom-nav'),
      documentOverflow: document.documentElement.scrollWidth - innerWidth };
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    for (const viewport of process.env.QA_OFFLINE_ONLY === '1' ? [] : [{ width: 402, height: 874 }, { width: 430, height: 932 }, { width: 874, height: 402 }, { width: 1440, height: 900 }]) {
      const context = await browser.newContext({ viewport, isMobile: viewport.width < 960, hasTouch: viewport.width < 960,
        serviceWorkers: 'block', timezoneId: 'Europe/Moscow' });
      try {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.clock.setFixedTime(new Date('2026-10-12T12:00:00+03:00'));
        await page.route('https://**/*', (route) => new URL(route.request().url()).origin === new URL(root).origin ? route.continue() : route.abort());
        const selected = viewport.width === 402 ? snapshots : [snapshots[0], snapshots[2]];
        for (const snapshot of selected) {
          await page.goto(urlFor(snapshot), { waitUntil: 'domcontentloaded' });
          await page.getByRole('button', { name: 'Открыть сохранённые занятия', exact: true }).waitFor();
          assert.equal(await page.locator('.hero-card').count(), 0, 'old dated timetable cannot describe the present day');
          await page.getByRole('button', { name: 'Открыть сохранённые занятия', exact: true }).click();
          const lastDate = snapshot.schedule.at(-1).date;
          const expected = snapshot.schedule.filter((entry) => entry.date === lastDate);
          await page.locator('.lesson-row-button').first().waitFor();
          assert.equal(await page.locator('.lesson-row-button').count(), expected.length);
          assert.equal(await page.locator('.lesson-title').first().innerText(), subject(expected[0]));
          assert.match(await page.locator('.lesson-row').first().innerText(), new RegExp(expected[0].end));
          await page.locator('.today-date-launch').click();
          const calendar = page.getByRole('dialog', { name: 'Календарь', exact: true });
          await calendar.waitFor();
          assert.equal(await calendar.locator('.calendar-event.lesson').count(), expected.length);
          await calendar.getByRole('button', { name: 'Закрыть календарь' }).click();
          if (viewport.width === 402 && snapshot === snapshots[0]) {
            await page.locator('.lesson-row-button').first().click();
            await page.locator('.lesson-note-actions').first().getByRole('button', { name: 'Записка', exact: true }).click();
            const composer = page.locator('.note-composer');
            await composer.waitFor();
            assert.match(await composer.locator('.composer-lesson-context').innerText(), new RegExp(subject(expected[0]).slice(0, 20)));
            await composer.getByRole('button', { name: 'Закрыть запись' }).click();
          }
          await page.locator('.bottom-nav').getByRole('button', { name: 'Неделя', exact: true }).click();
          await page.getByRole('heading', { name: 'Занятия', exact: true }).waitFor();
          assert.equal(await page.locator('.mini-lesson-main').count(), snapshot.schedule.length);
          assert.match(await page.locator('.week-toolbar-copy').innerText(), /Архив/);
          assert.match(await page.locator('.week-toolbar-copy').innerText(), /2026/);
          assert.equal(await page.locator('.week-chip > span').first().innerText(), 'Даты');
          assert.equal(await page.locator('.session-period-label').evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true, 'archive period is truncated');
          await page.screenshot({ path: `${output}/week-${snapshot.group.nrec}-${viewport.width}.png` });
          const result = await geometry(page);
          assert(result.documentOverflow <= 1, JSON.stringify(result));
          const firstDate = snapshot.schedule[0].date;
          await page.locator('.session-date-card').first().click();
          await page.locator('.lesson-title').first().waitFor();
          assert.equal(await page.locator('.lesson-title').first().innerText(), subject(snapshot.schedule[0]));
          assert.equal(await page.locator('.lesson-row-button').count(), snapshot.schedule.filter((entry) => entry.date === firstDate).length);
          await page.screenshot({ path: `${output}/today-${snapshot.group.nrec}-${viewport.width}.png` });
          assert.deepEqual(errors, []);
          metrics.push({ group: snapshot.group.name, lessons: snapshot.schedule.length, ...result, errors });
          console.log(JSON.stringify(metrics.at(-1)));
        }
      } finally { await context.close(); }
    }

    if (process.env.QA_OFFLINE_CHECK === '1') {
      const context = await browser.newContext({ viewport: { width: 402, height: 874 }, timezoneId: 'Europe/Moscow' });
      try {
        const page = await context.newPage();
        await page.clock.setFixedTime(new Date('2026-10-12T12:00:00+03:00'));
        const initialGroup = JSON.parse(fs.readFileSync('public/data/schedule/7936a2a43b11b20b01d30f5b00c73166.json', 'utf8')).group;
        await page.goto(new URL(`?group=${initialGroup.nrec}&institute=${initialGroup.instituteId}`, root).href, { waitUntil: 'domcontentloaded' });
        await page.locator('.bottom-nav').waitFor();
        await waitForAsyncCondition(page, async () => {
          if (navigator.serviceWorker.controller?.state !== 'activated') return false;
          const response = await caches.match(new URL('./data/university-schedule.json', location.href).href);
          const data = response && await response.json();
          return data?.groups?.['049227b532f4bc9f256eaae4281a099f']?.schedule?.some((entry) => entry.type === 'DatedLesson');
        });
        await context.setOffline(true);
        for (const snapshot of snapshots) {
          await page.locator('.brand-button').click();
          await page.locator('.group-picker-search input').fill(snapshot.group.name);
          await page.getByRole('button', { name: new RegExp(`${snapshot.group.name}.*курс`) }).click();
          await page.locator('.bottom-nav').getByRole('button', { name: 'Неделя', exact: true }).click();
          await page.getByRole('heading', { name: 'Занятия', exact: true }).waitFor();
          assert.equal(await page.locator('.mini-lesson-main').count(), snapshot.schedule.length);
          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.locator('.bottom-nav').getByRole('button', { name: 'Неделя', exact: true }).click();
          await page.getByRole('heading', { name: 'Занятия', exact: true }).waitFor();
          assert.equal(await page.locator('.mini-lesson-main').count(), snapshot.schedule.length);
          console.log(JSON.stringify({ offline: true, group: snapshot.group.name, selectedThroughUI: true, reload: true }));
        }
        await page.screenshot({ path: `${output}/offline.png` });
      } finally { await context.close(); }
    }
    fs.writeFileSync(`${output}/metrics.json`, JSON.stringify(metrics, null, 2));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
