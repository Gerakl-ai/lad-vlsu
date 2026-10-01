const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');

const dist = path.resolve('dist');
const data = path.resolve('artifacts/live-snapshot-20261001');
const bundle = JSON.parse(fs.readFileSync(path.join(data, 'university-schedule.json')));
const apiOnly = Object.values(bundle.groups).find((item) => !fs.existsSync(path.join(dist, `data/ocr-schedule/${item.group.nrec}.json`)));
assert(apiOnly, 'Need an API-only group to prove general bundle coverage');
const initial = bundle.groups['7936a2a43b11b20b01d30f5b00c73166'];
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  let file = path.resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (['/data/university-schedule.json', '/data/catalog.json'].includes(pathname)) file = path.join(data, path.basename(pathname));
  // Individual files must be unavailable: the complete offline package is under test.
  if (/\/data\/(?:schedule|ocr-schedule)\//.test(pathname) || !file.startsWith(dist + path.sep) && !file.startsWith(data + path.sep)
    || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404); response.end(); return;
  }
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' }[path.extname(file)] || 'application/octet-stream';
  response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  response.end(fs.readFileSync(file));
});

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  fs.mkdirSync('artifacts/qa/university-package', { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
  try {
    for (const viewport of [{ width: 402, height: 874 }, { width: 430, height: 932 }]) {
      const context = await browser.newContext({ viewport, timezoneId: 'Europe/Moscow' });
      try {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.clock.setFixedTime(new Date('2026-10-01T12:00:00+03:00'));
        await page.addInitScript((group) => {
          if (!localStorage.getItem('lad.selected-group.v2')) localStorage.setItem('lad.selected-group.v2', JSON.stringify({ ...group, id: group.nrec, visualKey: 'institute-2' }));
        }, initial.group);
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.locator('.bottom-nav').getByRole('button', { name: 'Неделя', exact: true }).click();
        await page.locator('.mini-lesson-main').first().waitFor({ timeout: 15000 });
        await page.evaluate(async () => {
          await navigator.serviceWorker.ready;
          if (!navigator.serviceWorker.controller) await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
          await (await fetch('./data/university-schedule.json')).arrayBuffer();
        });
        await page.waitForFunction(async () => Boolean(await caches.match('./data/university-schedule.json')));
        await context.setOffline(true);
        await page.evaluate((group) => {
          for (const key of Object.keys(localStorage)) if (key.startsWith('lad.schedule.v2')) localStorage.removeItem(key);
          localStorage.setItem('lad.selected-group.v2', JSON.stringify({ ...group, id: group.nrec, visualKey: 'institute-2' }));
        }, apiOnly.group);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('.bottom-nav').getByRole('button', { name: 'Неделя', exact: true }).click();
        try { await page.locator('.mini-lesson-main').first().waitFor({ timeout: 15000 }); }
        catch (error) {
          await page.screenshot({ path: 'artifacts/qa/university-package/failure.png' });
          console.log(await page.evaluate(() => ({ text: document.body.innerText, group: localStorage.getItem('lad.selected-group.v2') })));
          throw error;
        }
        assert((await page.locator('.phone-frame').getAttribute('aria-label')).includes(apiOnly.group.name));
        assert.equal(await page.locator('.bottom-nav').getByRole('button', { name: 'Неделя', exact: true }).getAttribute('aria-current'), 'page');
        await page.waitForTimeout(350);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
        const metrics = await page.evaluate(() => {
          const rect = document.querySelector('.bottom-nav').getBoundingClientRect();
          return { viewport: innerHeight, navBottom: rect.bottom, bottomGap: innerHeight - rect.bottom };
        });
        await page.screenshot({ path: `artifacts/qa/university-package/offline-${viewport.width}.png` });
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ viewport, unvisitedOfflineGroup: apiOnly.group.name, packageGroups: Object.keys(bundle.groups).length, metrics, errors }));
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); server.close(); process.exitCode = 1; });
