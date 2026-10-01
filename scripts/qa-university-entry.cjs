const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const catalog = execFileSync('git', ['show', 'origin/data:data/catalog.json'], { encoding: 'utf8' });
const output = 'artifacts/qa/university-entry';
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
  try {
    for (const viewport of [{ width: 402, height: 874 }, { width: 430, height: 932 }, { width: 874, height: 402 }]) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block', timezoneId: 'Europe/Moscow' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/data/catalog.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: catalog }));
      await page.route('**/data/coverage.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ schemaVersion: 1, checkedAt: new Date().toISOString(), catalogGroups: 965, groups: {} }) }));
      await page.route('**/data/schedule/**', (route) => route.fulfill({ status: 404, body: '{}' }));
      await page.route('**/vlsu-api/**', (route) => route.fulfill({ status: 503, body: '{}' }));
      await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Найдите свою группу', exact: true }).waitFor();
      const search = page.getByPlaceholder('Группа или институт, например ПИ-124');
      await search.fill('лг126');
      const group = page.getByRole('button', { name: /ГИ ЛГ-126/ });
      await group.waitFor();
      await page.locator('.group-picker-sheet').evaluate(async (element) => {
        await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
      });
      const metrics = await page.evaluate(() => {
        const sheet = document.querySelector('.group-picker-sheet').getBoundingClientRect();
        const list = document.querySelector('.group-picker-list').getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth - innerWidth, sheetBottom: sheet.bottom, viewportBottom: innerHeight, listHeight: list.height };
      });
      assert.equal(metrics.overflow, 0);
      assert(metrics.sheetBottom <= viewport.height + 1, JSON.stringify(metrics));
      assert(metrics.listHeight > 0);
      await page.screenshot({ path: `${output}/search-${viewport.width}.png` });
      await group.click();
      await page.locator('.lesson-row').first().waitFor({ timeout: 12000 });
      assert.match(await page.locator('.brand h1').innerText(), /ЛГ-126/);
      await page.getByRole('button', { name: 'Неделя', exact: true }).click();
      await page.locator('.week-list .mini-lesson').first().waitFor();
      await page.screenshot({ path: `${output}/week-${viewport.width}.png` });
      await page.getByRole('button', { name: /Сменить группу/ }).click();
      await page.route('**/data/catalog.json', (route) => route.abort('internetdisconnected'));
      await page.route('**/vlsu-api/**', (route) => route.abort('internetdisconnected'));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: /Сменить группу/ }).click();
      await search.fill('пи124');
      await page.getByRole('button', { name: /ИИТЭ ПИ-124/ }).first().waitFor();
      const cachedGroups = await page.evaluate(() => Object.keys(localStorage)
        .filter((key) => key.startsWith('lad.catalog.groups.v1:'))
        .reduce((count, key) => count + JSON.parse(localStorage.getItem(key)).items.length, 0));
      assert.equal(cachedGroups, 965);
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ viewport, ...metrics, cachedGroups, cachedInstitutes: await page.evaluate(() => JSON.parse(localStorage.getItem('lad.catalog.institutes.v1')).items.length), errors }));
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
