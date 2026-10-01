const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const base = '/lad-vlsu/';
const dist = path.resolve('dist');
const catalog = JSON.parse(fs.readFileSync(path.join(dist, 'data/catalog.json')));
const group = catalog.institutes.flatMap((institute) => institute.groups.map((item) => ({
  ...item, instituteId: institute.id, instituteName: institute.name, instituteShortName: institute.shortName
}))).find((item) => item.name === 'ПИ-124');
const unvisitedGroup = catalog.institutes.flatMap((institute) => institute.groups.map((item) => ({
  ...item, instituteId: institute.id, instituteName: institute.name, instituteShortName: institute.shortName
}))).find((item) => item.name === 'ЗФСд-122');
assert(group);
assert(unvisitedGroup);
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (!pathname.startsWith(base)) { response.writeHead(404); response.end(); return; }
  const relative = pathname.slice(base.length) || 'index.html';
  const file = path.resolve(dist, relative);
  if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404); response.end(); return;
  }
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }[path.extname(file)] || 'application/octet-stream';
  response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  response.end(fs.readFileSync(file));
});

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}${base}`;
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
  try {
    fs.mkdirSync('artifacts/qa/release-preview', { recursive: true });
    for (const viewport of [{ width: 402, height: 874 }, { width: 430, height: 932 }, { width: 874, height: 402 }]) {
      const context = await browser.newContext({ viewport, timezoneId: 'Europe/Moscow' });
      try {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.clock.setFixedTime(new Date('2026-10-01T12:00:00+03:00'));
        await page.addInitScript((selected) => {
          if (!localStorage.getItem('lad.selected-group.v2')) {
            localStorage.setItem('lad.selected-group.v2', JSON.stringify({ ...selected, id: selected.nrec, visualKey: 'institute-2' }));
          }
        }, group);
        const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
        assert.equal(response.status(), 200);
        await page.locator('.bottom-nav').getByRole('button', { name: 'Настройки', exact: true }).click();
        await page.getByText('Расписание без интернета').waitFor();
        await page.waitForTimeout(350);
        const settingsText = await page.locator('.settings-view').innerText();
        assert(!/Offline-кэш|Edge-кэш|Push API|Service Worker|Отпечаток|Последний обход|Журнал получения/.test(settingsText));
        assert(settingsText.includes('Экспорт') && settingsText.includes('Импорт'));
        await page.screenshot({ path: `artifacts/qa/release-preview/settings-${viewport.width}x${viewport.height}.png` });
        await page.locator('.bottom-nav').getByRole('button', { name: 'Неделя', exact: true }).click();
        try { await page.locator('.mini-lesson-main').first().waitFor({ timeout: 15000 }); }
        catch (error) {
          await page.screenshot({ path: `artifacts/qa/release-preview/failure-${viewport.width}.png` });
          console.log(await page.evaluate(async () => ({ text: document.body.innerText,
            selected: localStorage.getItem('lad.selected-group.v2'), caches: await caches.keys() })));
          throw error;
        }
        assert.equal(await page.locator('.bottom-nav').getByRole('button', { name: 'Неделя', exact: true }).getAttribute('aria-current'), 'page');
        await page.waitForTimeout(350);
        await page.screenshot({ path: `artifacts/qa/release-preview/week-${viewport.width}x${viewport.height}.png` });
        let packageCached = false;
        for (let attempt = 0; attempt < 60 && !packageCached; attempt++) {
          packageCached = await page.evaluate(async () => Boolean(navigator.serviceWorker.controller
            && await caches.match(new URL('./data/university-schedule.json', location.href).href)));
          if (!packageCached) await page.waitForTimeout(250);
        }
        assert(packageCached, 'University package was not saved by service worker');
        await context.setOffline(true);
        await page.evaluate((selected) => {
          localStorage.setItem('lad.selected-group.v2', JSON.stringify({ ...selected, id: selected.nrec, visualKey: 'institute-2' }));
        }, unvisitedGroup);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('.bottom-nav').getByRole('button', { name: 'Неделя', exact: true }).click();
        try { await page.locator('.mini-lesson-main').first().waitFor({ timeout: 15000 }); }
        catch (error) {
          await page.screenshot({ path: `artifacts/qa/release-preview/failure-${viewport.width}.png` });
          console.log(await page.evaluate(async () => ({ text: document.body.innerText,
            selected: localStorage.getItem('lad.selected-group.v2'), caches: await caches.keys(),
            href: location.href, entries: await Promise.all((await caches.keys()).map(async (name) => ({ name, files: (await (await caches.open(name)).keys()).filter((entry) => entry.url.includes('university-schedule')).map((entry) => entry.url) }))),
            packageCached: Boolean(await caches.match(new URL('./data/university-schedule.json', location.href).href)) })));
          throw error;
        }
        assert((await page.locator('.phone-frame').getAttribute('aria-label')).includes(unvisitedGroup.name));
        const metrics = await page.evaluate(() => {
          const rect = document.querySelector('.bottom-nav').getBoundingClientRect();
          return { viewportHeight: innerHeight, navBottom: rect.bottom, bottomGap: innerHeight - rect.bottom,
            overflowX: document.documentElement.scrollWidth - innerWidth, scope: navigator.serviceWorker.controller?.scriptURL ?? null };
        });
        assert.equal(metrics.overflowX, 0);
        await page.screenshot({ path: `artifacts/qa/release-preview/offline-${viewport.width}x${viewport.height}.png` });
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ viewport, catalogGroups: catalog.institutes.reduce((sum, item) => sum + item.groups.length, 0), unvisitedOfflineGroup: unvisitedGroup.name, metrics, errors }));
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); server.close(); process.exitCode = 1; });
