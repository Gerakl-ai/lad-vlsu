const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

const root = process.env.QA_URL || 'http://127.0.0.1:4173/';
const snapshot = JSON.parse(fs.readFileSync('public/data/reviewed-schedule/878b392229b6d070fc63567a83d2a4cb.json', 'utf8'));
const output = 'artifacts/qa/dated-pdf-choices';
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    for (const { theme, viewport } of ['ember', 'obsidian'].flatMap((theme) =>
      [{ width: 375, height: 812 }, { width: 1440, height: 900 }].map((viewport) => ({ theme, viewport })))) {
      const context = await browser.newContext({ viewport, hasTouch: viewport.width < 960, isMobile: viewport.width < 960,
        serviceWorkers: 'block', timezoneId: 'Europe/Moscow' });
      try {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.addInitScript((theme) => {
          localStorage.setItem('lad.theme-schema', '2026-08-ember');
          localStorage.setItem('lad.theme', theme);
        }, theme);
        await page.route('https://**/*', (route) => new URL(route.request().url()).origin === new URL(root).origin ? route.continue() : route.abort());
        await page.clock.setFixedTime(new Date('2025-12-03T14:20:00+03:00'));
        await page.goto(new URL(`?group=${snapshot.group.nrec}&institute=${snapshot.group.instituteId}`, root).href, { waitUntil: 'domcontentloaded' });
        const row = page.locator('.lesson-row').filter({ has: page.locator('.lesson-title', { hasText: 'Иностранный язык' }) }).first();
        await row.locator('.lesson-row-button').click();
        const picker = row.getByRole('group', { name: 'Выбрать свою пару' });
        assert.equal(await picker.locator('.lesson-variant').count(), 3);
        await picker.getByRole('button', { name: /Морохова/ }).click();
        assert.equal(await row.locator('.lesson-title').innerText(), 'Иностранный язык (англ.)');
        assert.match(await row.innerText(), /418-1/);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await row.locator('.lesson-title').waitFor();
        assert.equal(await row.locator('.lesson-title').innerText(), 'Иностранный язык (англ.)');
        await page.locator('.bottom-nav').getByRole('button', { name: 'Неделя', exact: true }).click();
        const mini = page.locator('.mini-lesson').filter({ hasText: 'Иностранный язык' }).first();
        await mini.locator('.mini-lesson-main').waitFor();
        assert.equal(await mini.locator('.mini-lesson-main > strong').innerText(), 'Иностранный язык (англ.)');
        await mini.locator('.mini-lesson-main').click();
        const weekPicker = mini.getByRole('group', { name: 'Выбрать свою пару' });
        await weekPicker.getByRole('button', { name: /Михалева/ }).click();
        assert.equal(await mini.locator('.mini-lesson-main > strong').innerText(), 'Иностранный язык (нем.)');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('.bottom-nav').getByRole('button', { name: 'Неделя', exact: true }).click();
        await mini.locator('.mini-lesson-main').waitFor();
        assert.equal(await mini.locator('.mini-lesson-main > strong').innerText(), 'Иностранный язык (нем.)');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
        assert.deepEqual(errors, []);
        await mini.scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${output}/${theme}-${viewport.width}.png` });
        console.log(JSON.stringify({ theme, viewport, datedChoiceAcrossViews: true, reload: true, errors }));
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
