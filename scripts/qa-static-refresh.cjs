const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const dist = path.resolve('dist');
const nrec = 'e12504d70871167f6033e411be4ad503';
const original = JSON.parse(fs.readFileSync(path.join(dist, `data/ocr-schedule/${nrec}.json`)));
const changed = structuredClone(original);
const subject = 'Проверка фонового обновления';
for (const slot of ['n3', 'z3']) changed.schedule[1][slot] = `409-1, пр, Авдеева Н.А., ${subject}`;
changed.capturedAt = '2026-10-13T08:00:00Z';
changed.scheduleHash = crypto.createHash('sha256').update(JSON.stringify(changed.schedule)).digest('hex');
let phase = 'original';
let completedUpdates = 0;
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = path.resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404); response.end(); return;
  }
  const selected = pathname === `/data/ocr-schedule/${nrec}.json`;
  const send = () => {
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[path.extname(file)] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    response.end(selected && phase !== 'original'
      ? JSON.stringify(phase === 'invalid' ? { ...changed, schedule: [] } : changed) : fs.readFileSync(file));
    if (selected && phase !== 'original') completedUpdates++;
  };
  if (selected && phase !== 'original') setTimeout(send, 1500);
  else send();
});

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  fs.mkdirSync('artifacts/qa/static-refresh', { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
  try {
    for (const viewport of [{ width: 402, height: 874 }, { width: 430, height: 932 }]) {
      phase = 'original'; completedUpdates = 0;
      const context = await browser.newContext({ viewport, timezoneId: 'Europe/Moscow' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.clock.setFixedTime(new Date('2026-10-13T12:00:00+03:00'));
      await page.addInitScript((group) => {
        localStorage.setItem('lad.selected-group.v2', JSON.stringify({ ...group, id: group.nrec, visualKey: 'humanities' }));
        window.__qaBoot = crypto.randomUUID();
        window.__qaUpdates = 0;
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data?.type === 'static-schedule-updated') window.__qaUpdates++;
        });
      }, original.group);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.locator('.lesson-row').first().waitFor();
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
      });
      // Populate the worker cache, even if the first render preceded control.
      await page.evaluate(async (nrec) => { await (await fetch(`/data/ocr-schedule/${nrec}.json`)).arrayBuffer(); }, nrec);
      await page.locator('.bottom-nav').getByRole('button', { name: 'Неделя', exact: true }).click();
      const before = await page.evaluate(() => {
        const scroll = document.querySelector('.content-scroll');
        scroll.scrollTop = 140;
        return { boot: window.__qaBoot, scrollTop: scroll.scrollTop };
      });
      phase = 'changed';
      await page.getByRole('button', { name: 'Обновить расписание', exact: true }).click();
      assert.equal(await page.getByText(subject, { exact: true }).count(), 0, 'Cached UI should appear before delayed response');
      await page.getByText(subject, { exact: true }).first().waitFor({ timeout: 15000 });
      const after = await page.evaluate(() => ({ boot: window.__qaBoot, scrollTop: document.querySelector('.content-scroll').scrollTop, updates: window.__qaUpdates }));
      assert.equal(after.boot, before.boot, 'Data refresh must not reload the app');
      assert.equal(after.scrollTop, before.scrollTop, 'Data refresh reset scroll');
      assert(after.updates >= 1);
      assert.equal(await page.locator('.bottom-nav').getByRole('button', { name: 'Неделя', exact: true }).getAttribute('aria-current'), 'page');
      await page.screenshot({ path: `artifacts/qa/static-refresh/${viewport.width}.png` });
      phase = 'invalid';
      const completedBefore = completedUpdates;
      await page.evaluate(async (nrec) => { await (await fetch(`/data/ocr-schedule/${nrec}.json`)).arrayBuffer(); }, nrec);
      for (let i = 0; i < 40 && completedUpdates === completedBefore; i++) await new Promise((resolve) => setTimeout(resolve, 100));
      assert(completedUpdates > completedBefore, 'Bad response was not exercised');
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(await page.evaluate(() => window.__qaUpdates), after.updates, 'Bad or identical payload caused an update loop');
      assert(await page.getByText(subject, { exact: true }).count());
      await context.setOffline(true);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('.lesson-row').first().waitFor();
      await page.locator('.bottom-nav').getByRole('button', { name: 'Неделя', exact: true }).click();
      await page.getByText(subject, { exact: true }).first().waitFor();
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ viewport, before, after, retainedAfterInvalid: true, offlineUpdatedSchedule: true, errors }));
      await context.close();
    }
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { server.close(); console.error(error); process.exitCode = 1; });
