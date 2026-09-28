const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const nrec = 'e12504d70871167f6033e411be4ad503';
const outputDir = 'artifacts/qa/document-locator';
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
      await page.goto(process.env.QA_URL || 'http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
      await page.getByText('PDF №1 в архиве').waitFor({ timeout: 10000 });
      const archive = page.getByRole('link', { name: 'Открыть архив ВлГУ' });
      assert.match(await archive.getAttribute('href'), /^https:\/\/www\.vlsu\.ru\/fileadmin\/class-schedule\//);
      assert.equal(await page.getByText('Расписание не получено').count(), 1);
      assert.equal(await page.getByText('Сегодня без пар').count(), 0);
      const metrics = await page.evaluate(() => {
        const nav = document.querySelector('.bottom-nav').getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth - innerWidth, navBottomGap: Math.round(innerHeight - nav.bottom) };
      });
      assert.equal(metrics.overflow, 0);
      assert.equal(metrics.navBottomGap, 0);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `${outputDir}/${viewport.width}.png` });
      await page.getByRole('button', { name: 'Выбрать другую группу' }).click();
      await page.getByRole('button', { name: 'Гуманитарный институт' }).click();
      await page.getByText('Есть официальный документ').first().waitFor();
      await page.screenshot({ path: `${outputDir}/picker-${viewport.width}.png` });
      console.log(JSON.stringify({ viewport, ...metrics, errors }));
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
