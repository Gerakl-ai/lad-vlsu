const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const nrec = '7936a2a43b11b20b01d30f5b00c73166';
const snapshot = JSON.parse(execFileSync('git', ['show', `origin/data:data/schedule/${nrec}.json`], { encoding: 'utf8' }));
const outputDir = 'artifacts/qa/visual-baseline';
fs.mkdirSync(outputDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
  try {
    for (const viewport of [{ width: 402, height: 874 }, { width: 430, height: 932 }, { width: 874, height: 402 }, { width: 1280, height: 800 }]) {
      const page = await browser.newPage({ viewport, serviceWorkers: 'block', timezoneId: 'Europe/Moscow' });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.clock.setFixedTime(new Date('2026-09-23T08:00:00Z'));
      await page.addInitScript(({ nrec }) => {
        localStorage.setItem('lad.selected-group.v2', JSON.stringify({ id: nrec, nrec, name: 'ПИ-124', instituteId: '5b42fa53ec1dd1892e5ec44a3a60a896', instituteName: 'Институт информационных технологий и электроники', instituteShortName: 'ИИТЭ', visualKey: 'iite' }));
      }, { nrec });
      await page.route('**/data/schedule/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snapshot) }));
      await page.goto(process.env.QA_URL || 'http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
      await page.getByText('ПИ-124', { exact: true }).first().waitFor();
      await page.locator('.today-view .timeline-card').waitFor();
      await page.screenshot({ path: `${outputDir}/today-${viewport.width}.png` });
      await page.getByRole('button', { name: 'Неделя', exact: true }).last().click();
      await page.locator('.week-view .day-block').first().waitFor();
      await page.waitForTimeout(650);
      await page.screenshot({ path: `${outputDir}/week-${viewport.width}.png` });
      const metrics = await page.evaluate(() => {
        const overview = document.querySelector('.week-overview').getBoundingClientRect();
        const firstDay = document.querySelector('.week-list .day-block').getBoundingClientRect();
        const nav = document.querySelector('.bottom-nav').getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth - innerWidth,
          overviewHeight: Math.round(overview.height),
          firstDayTop: Math.round(firstDay.top),
          navBottomGap: Math.round(innerHeight - nav.bottom)
        };
      });
      assert.equal(metrics.overflow, 0, 'Week view must not overflow horizontally');
      if (viewport.width < 1000) {
        assert.equal(metrics.navBottomGap, 0, 'Phone navigation must reach the viewport bottom');
      }
      assert.deepEqual(errors, [], 'Week view must have no runtime errors');
      assert.equal(await page.locator('.bottom-nav button[aria-current="page"]').innerText(), 'Неделя');
      await page.getByRole('radio', { name: 'Числитель' }).click();
      assert.equal(await page.getByRole('radio', { name: 'Числитель' }).getAttribute('aria-checked'), 'true');
      await page.getByRole('radio', { name: 'Знаменатель' }).click();
      assert.equal(await page.getByRole('radio', { name: 'Знаменатель' }).getAttribute('aria-checked'), 'true');
      await page.locator('.week-map-disclosure summary').click();
      await page.locator('.week-rhythm-day').first().click();
      await page.locator('.today-view').waitFor();
      assert.equal(await page.locator('.bottom-nav button[aria-current="page"]').innerText(), 'Сегодня');
      console.log(JSON.stringify({ viewport, ...metrics, errors }));
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
