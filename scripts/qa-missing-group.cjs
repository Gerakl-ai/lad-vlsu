const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

const catalog = JSON.parse(fs.readFileSync('public/data/catalog.json', 'utf8'));
const coverage = JSON.parse(fs.readFileSync('public/data/coverage.json', 'utf8'));
const missing = catalog.institutes.flatMap((institute) => (institute.groups || []).map((group) => ({ ...group, instituteId: institute.id })))
  .find((group) => !coverage.groups[group.nrec]);
const url = missing ? new URL(`?group=${missing.nrec}&institute=${missing.instituteId}`, process.env.QA_URL || 'http://127.0.0.1:4173/').href : null;

(async () => {
  if (!url) {
    console.log('All catalog groups have a bundled schedule; missing-group QA is not applicable.');
    return;
  }
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    for (const viewport of [{ width: 402, height: 874 }, { width: 1280, height: 800 }]) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('https://**/*', (route) => route.abort());
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      const unavailable = page.locator('.schedule-unavailable');
      await unavailable.waitFor({ timeout: 20000 });
      assert.match(await unavailable.innerText(), /Расписание не получено/);
      assert.equal(await page.getByText('Сегодня без пар').count(), 0);
      await unavailable.getByRole('button', { name: 'Повторить' }).click();
      await unavailable.waitFor({ timeout: 20000 });
      await page.locator('.bottom-nav').getByRole('button', { name: 'Неделя' }).click();
      assert.equal(await unavailable.isVisible(), true);
      await page.locator('.bottom-nav').getByRole('button', { name: 'Настройки' }).click();
      assert.equal(await page.locator('.settings-view').isVisible(), true);
      const geometry = await page.evaluate(() => {
        const nav = document.querySelector('.bottom-nav').getBoundingClientRect();
        const content = document.querySelector('.content-scroll').getBoundingClientRect();
        return { navBottom: Math.round(nav.bottom), navRight: Math.round(nav.right), contentLeft: Math.round(content.left), overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.equal(geometry.overflow, false);
      if (viewport.width < 500) assert.equal(geometry.navBottom, viewport.height);
      else assert.ok(geometry.navRight <= geometry.contentLeft + 1);
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ viewport, group: missing.name, geometry, errors }));
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
