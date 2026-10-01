const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const nrec = 'e12504d70871167f6033e411be4ad503';
const url = process.env.QA_URL || 'http://127.0.0.1:4173/';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
  const context = await browser.newContext({ viewport: { width: 402, height: 874 }, timezoneId: 'Europe/Moscow' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.addInitScript(({ nrec }) => {
      localStorage.setItem('lad.selected-group.v2', JSON.stringify({
        id: nrec, nrec, name: 'ЛГ-126',
        instituteId: 'c22ac11fe7a7799355b1b90ba6957321',
        instituteName: 'Гуманитарный институт', instituteShortName: 'ГИ', visualKey: 'humanities'
      }));
    }, { nrec });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator('.lesson-row').first().waitFor({ timeout: 12000 });
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    });
    await page.evaluate(async (nrec) => {
      const response = await fetch(`./data/ocr-schedule/${nrec}.json`);
      if (!response.ok) throw new Error(`Cannot cache structured schedule: ${response.status}`);
      await response.json();
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('lad.schedule.v2')) localStorage.removeItem(key);
      }
    }, nrec);
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.lesson-row').first().waitFor({ timeout: 12000 });
    assert((await page.locator('.lesson-row').count()) > 0);
    assert.equal(await page.getByText('Расписание не получено').count(), 0);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: 'artifacts/qa/ocr-schedule/offline-402.png' });
    console.log(JSON.stringify({ offline: true, lessons: await page.locator('.lesson-row').count(), errors }));
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
