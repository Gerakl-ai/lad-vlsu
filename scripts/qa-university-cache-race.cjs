const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

const root = process.env.QA_URL || 'http://127.0.0.1:4173/';
const catalog = JSON.parse(fs.readFileSync('public/data/catalog.json', 'utf8'));
const institute = catalog.institutes.find((item) => item.groups.some((group) => group.name === 'ЗМТИ-122'));
const group = institute.groups.find((item) => item.name === 'ЗМТИ-122');
const profile = { ...group, id: group.nrec, instituteId: institute.id, instituteName: institute.name,
  instituteShortName: institute.shortName, visualKey: 'institute-12' };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const context = await browser.newContext({ viewport: { width: 402, height: 874 } });
  try {
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date('2026-10-01T12:00:00+03:00'));
    await page.addInitScript((group) => localStorage.setItem('lad.selected-group.v2', JSON.stringify(group)), profile);
    await page.goto(root, { waitUntil: 'domcontentloaded' });
    await page.getByRole('region', { name: 'Учебный календарь' }).waitFor();
    await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated', null, { timeout: 30000 });
    await page.waitForTimeout(4500);
    const before = await page.evaluate(async () => {
      const url = new URL('./data/university-schedule.json', location.href);
      return { online: navigator.onLine, cached: Boolean(await caches.match(url.href)),
        catalogCached: Boolean(await caches.match(new URL('./data/catalog.json', location.href).href)),
        requests: performance.getEntriesByType('resource').filter((entry) => entry.name === url.href)
          .map((entry) => ({ startTime: entry.startTime, workerStart: entry.workerStart, responseEnd: entry.responseEnd })) };
    });
    fs.mkdirSync('artifacts/qa/university-cache-race', { recursive: true });
    fs.writeFileSync('artifacts/qa/university-cache-race/result.json', JSON.stringify({ before }, null, 2));
    const forced = before.cached ? null : await page.evaluate(async () => {
      const url = new URL('./data/university-schedule.json', location.href);
      const response = await fetch(url);
      const bytes = await response.arrayBuffer();
      return { status: response.status, size: bytes.byteLength, cached: Boolean(await caches.match(url.href)) };
    });
    fs.writeFileSync('artifacts/qa/university-cache-race/result.json', JSON.stringify({ before, forced }, null, 2));
    console.log(JSON.stringify({ before, forced }));
    assert.equal(before.cached, true, 'automatic warmup left the university package outside the offline cache');
    assert.equal(before.catalogCached, true, 'group selection needs the full offline catalog');
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('region', { name: 'Учебный календарь' }).waitFor();
    await page.locator('.brand-button').click();
    await page.locator('.group-picker-search input').fill('ЗФСд-122');
    await page.getByRole('button', { name: /ЗФСд-122.*курс/ }).click();
    await page.locator('.bottom-nav').getByRole('button', { name: 'Неделя', exact: true }).click();
    await page.locator('.mini-lesson-main').first().waitFor();
    await page.screenshot({ path: 'artifacts/qa/university-cache-race/unvisited-group-offline.png' });
    console.log(JSON.stringify({ unvisitedOfflineGroup: 'ЗФСд-122', selectedThroughUI: true }));
  } finally { await context.close(); await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
