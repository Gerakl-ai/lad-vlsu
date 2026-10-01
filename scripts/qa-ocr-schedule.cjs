const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const nrec = 'e12504d70871167f6033e411be4ad503';
const outputDir = 'artifacts/qa/ocr-schedule';
const catalog = execFileSync('git', ['show', 'origin/data:data/catalog.json'], { encoding: 'utf8' });
fs.mkdirSync(outputDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
  try {
    for (const viewport of [{ width: 402, height: 874 }, { width: 430, height: 932 }, { width: 874, height: 402 }]) {
      const page = await browser.newPage({ viewport, serviceWorkers: 'block', timezoneId: 'Europe/Moscow' });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(({ nrec }) => {
        localStorage.setItem('lad.selected-group.v2', JSON.stringify({
          id: nrec, nrec, name: 'ЛГ-126',
          instituteId: 'c22ac11fe7a7799355b1b90ba6957321',
          instituteName: 'Гуманитарный институт', instituteShortName: 'ГИ', visualKey: 'humanities'
        }));
      }, { nrec });
      await page.route('**/data/schedule/**', (route) => route.fulfill({ status: 404, body: '{}' }));
      await page.route('**/data/catalog.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: catalog }));
      await page.route('**/app-api/schedule/**', (route) => route.fulfill({ status: 503, body: '{}' }));
      await page.route('**/vlsu-api/**', (route) => route.fulfill({ status: 503, body: '{}' }));
      await page.goto(process.env.QA_URL || 'http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
      await page.locator('.hero-card:not(.skeleton-hero)').waitFor({ timeout: 12000 });
      assert.equal(await page.getByText('Расписание не получено').count(), 0);
      assert.equal(await page.locator('.pdf-fallback-viewer').count(), 0);
      const todayLessons = await page.locator('.lesson-row').count();
      assert(todayLessons > 0, 'Today must contain structured lessons');
      const metrics = await page.evaluate(() => {
        const nav = document.querySelector('.bottom-nav').getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth - innerWidth,
          navBottomGap: Math.round(innerHeight - nav.bottom)
        };
      });
      assert.equal(metrics.overflow, 0);
      if (viewport.height > viewport.width) assert.equal(metrics.navBottomGap, 0);
      await page.screenshot({ path: `${outputDir}/today-${viewport.width}.png` });

      await page.getByRole('button', { name: 'Неделя', exact: true }).click();
      await page.locator('.week-list .mini-lesson').first().waitFor();
      await page.waitForTimeout(450);
      const weekLessons = await page.locator('.week-list .mini-lesson').count();
      assert(weekLessons > 0, 'Week must contain structured lessons');
      await page.screenshot({ path: `${outputDir}/week-${viewport.width}.png` });
      await page.getByRole('button', { name: 'Настройки', exact: true }).click();
      await page.getByText('Предварительное расписание').first().waitFor();
      await page.waitForTimeout(450);
      await page.screenshot({ path: `${outputDir}/settings-${viewport.width}.png` });
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ viewport, todayLessons, weekLessons, ...metrics, errors }));
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
