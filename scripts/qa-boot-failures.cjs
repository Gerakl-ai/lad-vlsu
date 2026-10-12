const { chromium } = require('playwright');
const { mkdirSync, readFileSync } = require('node:fs');
const { Script } = require('node:vm');
const assert = require('node:assert/strict');
const { waitForAsyncCondition } = require('./qa-async-condition.cjs');

const url = process.env.QA_URL || 'http://127.0.0.1:5182/';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const html = readFileSync('dist/index.html', 'utf8');
for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Script(match[1]);
assert(html.indexOf('window.__ladBootComplete = false') < html.indexOf('rel="stylesheet"'));
assert(!readFileSync('dist/sw.js', 'utf8').includes('/* __BUILD_ASSETS__ */ null'));

(async () => {
  const browser = await chromium.launch({ executablePath });
  const results = [];
  mkdirSync('artifacts/qa/boot-failures', { recursive: true });
  try {
    for (const extension of ['css', 'js']) {
      const context = await browser.newContext({ viewport: { width: 402, height: 874 }, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      // Keep the request pending, as happens with a stalled connection, not a fast 404.
      await page.route(`**/assets/*.${extension}`, () => new Promise(() => {}));
      await page.goto(url, { waitUntil: 'commit' });
      await page.waitForFunction(() => Boolean(document.querySelector('.launch-recovery')), null, { timeout: 9000, polling: 100 }).catch(async (error) => {
        console.log(extension, await page.evaluate(() => ({ boot: window.__ladBootComplete, html: document.body?.innerHTML.slice(0, 500), state: document.readyState })), errors);
        throw error;
      });
      const label = await page.locator('.launch-recovery').textContent();
      assert.equal(label, 'Восстановить приложение');
      assert.deepEqual(errors, []);
      results.push({ stalled: extension, recoveryAvailable: true, errors });
      await context.close();
    }
    const context = await browser.newContext({ viewport: { width: 402, height: 874 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ladBootComplete);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.evaluate(() => localStorage.setItem('lad.qa-preserved-note', 'offline note'));
    // A legacy release query must not define the installed cache version.
    const release = await page.locator('meta[name="lad-release"]').getAttribute('content');
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.register('sw.js?release=legacy-broken', { updateViaCache: 'none' });
      await registration.update();
    });
    await waitForAsyncCondition(page, async (expected) => (await caches.keys()).some((name) => name.endsWith(':' + expected)), release);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.phone-frame').waitFor();
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.phone-frame').waitFor();
    assert.equal(await page.locator('.launch-screen').count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem('lad.qa-preserved-note')), 'offline note');
    assert.deepEqual(errors, []);
    await page.screenshot({ path: 'artifacts/qa/boot-failures/offline-402.png' });
    results.push({ legacyWorkerUpdate: true, offlineBoot: true, release, errors });
    await context.close();
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
