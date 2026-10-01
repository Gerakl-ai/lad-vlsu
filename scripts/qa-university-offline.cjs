const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ids = ['7936a2a43b11b20b01d30f5b00c73166', 'e12504d70871167f6033e411be4ad503', '04bd2331c4bbfdbd408a52e99d336ff6'];
const profiles = ids.map((id) => JSON.parse(fs.readFileSync(`public/data/ocr-schedule/${id}.json`, 'utf8')).group);
fs.mkdirSync('artifacts/qa/university-offline', { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
  const width = Number(process.env.QA_WIDTH || 402);
  const context = await browser.newContext({ viewport: { width, height: width === 430 ? 932 : 874 }, timezoneId: 'Europe/Moscow' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.clock.setFixedTime(new Date('2026-10-13T12:00:00+03:00'));
    await page.addInitScript((group) => {
      if (!localStorage.getItem('lad.selected-group.v2')) localStorage.setItem('lad.selected-group.v2', JSON.stringify({ ...group, id: group.nrec, visualKey: 'institute-2' }));
    }, profiles[0]);
    await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
    await page.locator('.lesson-row').first().waitFor({ timeout: 15000 });
    let bundled = false;
    for (let attempt = 0; attempt < 80 && !bundled; attempt++) {
      bundled = await page.evaluate(async () => Boolean(navigator.serviceWorker.controller
        && await caches.match(new URL('./data/ocr-schedule/bundle.json', location.href).href)));
      if (!bundled) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert(bundled, 'Background bundle was not persisted');
    for (const group of profiles.slice(1)) {
      assert.equal(await page.evaluate(async (nrec) => Boolean(await caches.match(`./data/ocr-schedule/${nrec}.json`)), group.nrec), false);
    }
    await context.setOffline(true);
    for (const group of profiles.slice(1)) {
      await page.evaluate((group) => {
        for (const key of Object.keys(localStorage)) if (key.startsWith('lad.schedule.v2')) localStorage.removeItem(key);
        localStorage.setItem('lad.selected-group.v2', JSON.stringify({ ...group, id: group.nrec, visualKey: 'institute-2' }));
      }, group);
      await page.reload({ waitUntil: 'domcontentloaded' });
      try {
        await page.locator('.lesson-row').first().waitFor({ timeout: 15000 });
      } catch (error) {
        await page.screenshot({ path: 'artifacts/qa/university-offline/failure.png' });
        console.log(await page.evaluate(async () => ({ text: document.body.innerText, caches: await caches.keys(), date: new Date().toISOString(), bundleStatus: (await caches.match('./data/ocr-schedule/bundle.json'))?.status })));
        throw error;
      }
      assert.equal(await page.getByText('Расписание не получено').count(), 0);
      assert((await page.locator('.phone-frame').getAttribute('aria-label')).includes(group.name));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
      await page.screenshot({ path: `artifacts/qa/university-offline/${group.nrec}-${width}.png` });
      console.log(JSON.stringify({ group: group.name, previouslyVisited: false, offline: true, lessons: await page.locator('.lesson-row').count() }));
    }
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
