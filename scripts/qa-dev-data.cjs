const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const { createServer } = await import('vite');
  const { sha256 } = await import('./snapshot/buildSnapshot.mjs');
  const output = path.resolve('artifacts/qa/dev-data');
  await fs.mkdir(output, { recursive: true });
  const fixture = await fs.mkdtemp(path.join(output, 'fixture-'));
  const publicDir = path.join(fixture, 'public');
  await fs.cp('public', publicDir, { recursive: true });
  const snapshotPath = path.join(publicDir, 'data', 'reviewed-schedule', '049227b532f4bc9f256eaae4281a099f.json');
  const original = JSON.parse(await fs.readFile(snapshotPath, 'utf8'));
  const server = await createServer({ root: process.cwd(), configFile: path.resolve('vite.config.ts'), publicDir,
    server: { host: '127.0.0.1', port: 0 }, logLevel: 'warn' });
  await server.listen();
  const root = server.resolvedUrls.local[0];
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const results = [];
  try {
    for (const theme of ['ember', 'obsidian']) {
      const context = await browser.newContext({ viewport: { width: 375, height: 812 }, timezoneId: 'Europe/Moscow', serviceWorkers: 'block' });
      try {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.addInitScript((theme) => {
          localStorage.setItem('lad.theme-schema', '2026-08-ember');
          localStorage.setItem('lad.theme', theme);
        }, theme);
        await page.clock.setFixedTime(new Date('2026-10-12T12:00:00+03:00'));
        await page.route('**/vlsu-api/**', (route) => route.abort());
        await page.goto(new URL(`?group=${original.group.nrec}&institute=${original.group.instituteId}`, root).href, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: 'Открыть сохранённые занятия', exact: true }).waitFor();
        assert.equal(await page.locator('.group-picker-backdrop').count(), 0, 'StrictMode discarded the group link');
        await page.locator('.bottom-nav').getByRole('button', { name: 'Записи', exact: true }).click();
        await page.getByTestId('open-note-composer').click();
        const surface = page.locator('.rich-note-surface');
        await surface.waitFor();
        const text = `Проверка редактора ${theme}. `.repeat(240);
        await surface.fill(text);
        const editorBefore = await surface.innerText();
        assert.equal(editorBefore.trim(), text.trim());
        await page.locator('.rich-editor-content').evaluate((node) => { node.scrollTop = node.scrollHeight / 2; });
        const scrollBefore = await page.locator('.rich-editor-content').evaluate((node) => node.scrollTop);
        const documentToken = await page.evaluate(() => { window.__qaDocument = crypto.randomUUID(); return window.__qaDocument; });
        const schedule = original.schedule.map((entry, index) => index === 0 ? { ...entry, name: `111-3, лк, QA T.T., Updated ${theme} subject` } : entry);
        const updated = { ...original, schedule, scheduleHash: sha256({ semester: null, schedule }),
          capturedAt: theme === 'ember' ? '2026-10-13T12:00:00Z' : '2026-10-13T13:00:00Z' };
        await fs.writeFile(snapshotPath, JSON.stringify(updated));
        await page.waitForFunction(({ nrec, hash }) => JSON.parse(localStorage.getItem(`lad.schedule.v2:${nrec}`) || '{}').contentHash === hash,
          { nrec: original.group.nrec, hash: updated.scheduleHash });
        assert.equal(await page.evaluate(() => window.__qaDocument), documentToken, 'data change reloaded the whole page');
        assert.equal((await surface.innerText()) === editorBefore, true, 'data update changed editor text');
        assert.equal(await page.locator('.note-composer').isVisible(), true);
        assert.equal(await page.locator('.bottom-nav').getByRole('button', { name: 'Записи', exact: true }).getAttribute('aria-current'), 'page');
        const scrollAfter = await page.locator('.rich-editor-content').evaluate((node) => node.scrollTop);
        assert(Math.abs(scrollAfter - scrollBefore) <= 1, `editor scroll jumped: ${scrollBefore} -> ${scrollAfter}`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: path.join(output, `hmr-${theme}-375.png`) });
        assert.deepEqual(errors, []);
        results.push({ theme, viewport: '375x812', groupLinkResolved: true, documentPreserved: true, editorTextPreserved: true,
          scrollBefore, scrollAfter, errors });
        console.log(JSON.stringify(results.at(-1)));
      } finally { await context.close(); }
    }
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(results, null, 2));
  } finally { await browser.close(); await server.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
