const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const dist = path.resolve('dist');
const compiledWorker = fs.readFileSync(path.join(dist, 'sw.js'), 'utf8');
const release = compiledWorker.match(/const BUILD_RELEASE = "([^"]+)"/)[1];
let stage = 'first';
let unavailableData = false;
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (unavailableData && pathname.startsWith('/data/')) { response.writeHead(503); response.end('Unavailable'); return; }
  const file = path.resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end(); return; }
  const ext = path.extname(file);
  let content = fs.readFileSync(file);
  const version = stage === 'first' ? release : `${release}-update-qa`;
  if (pathname === '/sw.js') content = Buffer.from(content.toString().replace(`const BUILD_RELEASE = "${release}"`, `const BUILD_RELEASE = "${version}"`));
  if (file.endsWith('index.html')) content = Buffer.from(content.toString().replace(`name="lad-release" content="${release}"`, `name="lad-release" content="${version}"`));
  response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' })[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  response.end(content);
});
const group = JSON.parse(fs.readFileSync('public/data/ocr-schedule/e12504d70871167f6033e411be4ad503.json', 'utf8')).group;
const liveUpdate = process.env.QA_LIVE_UPDATE === '1';
fs.mkdirSync('artifacts/qa/data-release-update', { recursive: true });

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
  try {
    for (const viewport of [{ width: 402, height: 874 }, { width: 430, height: 932 }]) {
      stage = 'first'; unavailableData = false;
      const context = await browser.newContext({ viewport, timezoneId: 'Europe/Moscow' });
      let page = await context.newPage();
      const errors = [];
      const pendingRequests = new Set();
      context.on('request', (request) => pendingRequests.add(request));
      context.on('requestfinished', (request) => pendingRequests.delete(request));
      context.on('requestfailed', (request) => pendingRequests.delete(request));
      context.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('Failed to load resource')) console.log('QA console:', message.text()); });
      page.on('pageerror', (error) => errors.push(error.message));
      await page.clock.setFixedTime(new Date('2026-10-13T12:00:00+03:00'));
      await page.addInitScript((group) => localStorage.setItem('lad.selected-group.v2', JSON.stringify({ ...group, id: group.nrec, visualKey: 'humanities' })), group);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.locator('.lesson-row').first().waitFor({ timeout: 15000 });
      let ready = false;
      for (let i = 0; i < 80 && !ready; i++) {
        ready = await page.evaluate(async () => Boolean(await caches.match(new URL('./data/ocr-schedule/bundle.json', location.href).href)));
        if (!ready) await new Promise((resolve) => setTimeout(resolve, 250));
      }
      assert(ready, 'Missing initial bundle');
      for (let i = 0; i < 40 && [...pendingRequests].some((request) => request.url().includes('/images/hero-')); i++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      assert(![...pendingRequests].some((request) => request.url().includes('/images/hero-')), 'Unread warmup image response');
      console.log(JSON.stringify({ phase: 'initial-bundle', viewport }));
      const noteText = 'Проверка сохранения заметки во время обновления ЛАД';
      let originalBoot;
      if (liveUpdate) {
        await page.locator('.bottom-nav').getByRole('button', { name: 'Записи', exact: true }).click();
        await page.getByTestId('open-note-composer').click();
        await page.locator('[contenteditable="true"]').fill(noteText);
        originalBoot = await page.evaluate(() => { window.__qaBoot = crypto.randomUUID(); return window.__qaBoot; });
      }
      // Reproduce a legacy release where data was inside the release cache.
      await page.evaluate(async (release) => {
        const data = await caches.open('lad-vlsu-data:%2F:v1');
        const legacy = await caches.open(`lad-vlsu-scope:%2F:${release}`);
        for (const request of await data.keys()) await legacy.put(request, await data.match(request));
        await caches.delete('lad-vlsu-data:%2F:v1');
      }, release);
      stage = 'second'; unavailableData = true;
      try { await Promise.race([page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        await registration.update();
      }), new Promise((_, reject) => setTimeout(() => reject(new Error('Worker update timed out')), 20000))]); }
      catch (error) {
        console.log(await page.evaluate(async () => {
          const r = await navigator.serviceWorker.getRegistration();
          return { active: r.active?.state, installing: r.installing?.state, waiting: r.waiting?.state, caches: await caches.keys() };
        }));
        throw error;
      }
      if (liveUpdate) {
        let waiting = false;
        for (let i = 0; i < 80 && !waiting; i++) {
          waiting = await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting));
          if (!waiting) await new Promise((resolve) => setTimeout(resolve, 250));
        }
        assert(waiting, 'Update did not wait for the editor');
        assert.equal(await page.evaluate(() => window.__qaBoot), originalBoot);
        assert.equal(await page.locator('[contenteditable="true"]').innerText(), noteText);
        await page.screenshot({ path: `artifacts/qa/data-release-update/editor-waiting-${viewport.width}.png` });
        await page.getByRole('button', { name: 'Сохранить запись', exact: true }).click();
        let reloaded = false;
        for (let i = 0; i < 80 && !reloaded; i++) {
          try { reloaded = await page.evaluate((boot) => window.__qaBoot !== boot && window.__ladBootComplete === true, originalBoot); } catch {}
          if (!reloaded) await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (!reloaded) {
          console.log('Pending requests', [...pendingRequests].map((request) => request.url()));
          console.log(await page.evaluate(async () => ({ hidden: document.hidden, dialog: Boolean(document.querySelector('[role="dialog"], .note-composer')), active: document.activeElement?.tagName, controller: navigator.serviceWorker.controller?.state, waiting: (await navigator.serviceWorker.getRegistration())?.waiting?.state, caches: await caches.keys() })));
        }
        assert(reloaded, 'Update did not apply after saving');
        await page.locator('.bottom-nav').getByRole('button', { name: 'Записи', exact: true }).click();
        await page.getByText(noteText, { exact: true }).first().waitFor();
        await page.locator('.bottom-nav').getByRole('button', { name: 'Сегодня', exact: true }).click();
      } else {
        await page.close();
        page = await context.newPage();
        page.on('pageerror', (error) => errors.push(error.message));
        await page.clock.setFixedTime(new Date('2026-10-13T12:00:00+03:00'));
        await page.goto(url, { waitUntil: 'domcontentloaded' });
      }
      let migrated = false;
      for (let i = 0; i < 80 && !migrated; i++) {
        migrated = await page.evaluate(async (release) => !(await caches.keys()).includes(`lad-vlsu-scope:%2F:${release}`), release);
        if (!migrated) await new Promise((resolve) => setTimeout(resolve, 250));
      }
      assert(migrated, 'New worker did not finish activation');
      const migration = await page.evaluate(async (release) => ({
        caches: await caches.keys(),
        bundle: Boolean(await (await caches.open('lad-vlsu-data:%2F:v1')).match(new URL('./data/ocr-schedule/bundle.json', location.href).href)),
        oldRemoved: !(await caches.keys()).includes(`lad-vlsu-scope:%2F:${release}`)
      }), release);
      assert(migration.bundle && migration.oldRemoved);
      await context.setOffline(true);
      await page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.startsWith('lad.schedule.v2')) localStorage.removeItem(key); });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('.lesson-row').first().waitFor({ timeout: 15000 });
      assert.equal(await page.getByText('Расписание не получено').count(), 0);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `artifacts/qa/data-release-update/${viewport.width}.png` });
      console.log(JSON.stringify({ viewport, liveUpdate, notePreserved: liveUpdate || undefined, ...migration, offlineLessons: await page.locator('.lesson-row').count(), errors }));
      await context.close();
    }
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { server.close(); console.error(error); process.exitCode = 1; });
