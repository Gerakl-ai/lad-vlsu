const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

const catalog = JSON.parse(fs.readFileSync('public/data/catalog.json', 'utf8'));
const root = process.env.QA_URL || 'http://127.0.0.1:4173/';
const origin = new URL(root).origin;
const names = ['ПИ-124', 'ЗАФКд-126', 'ЗМНммрд-124'];
const viewports = [
  { width: 320, height: 740 }, { width: 402, height: 874 },
  { width: 430, height: 932 }, { width: 874, height: 402 },
  { width: 960, height: 600 }, { width: 1440, height: 900 },
  { width: 2560, height: 1440 }
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  fs.mkdirSync('artifacts/qa/group-header', { recursive: true });
  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block', timezoneId: 'Europe/Moscow' });
      try {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('https://**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
        for (const name of names) {
          const institute = catalog.institutes.find((item) => item.groups.some((group) => group.name === name));
          const group = institute?.groups.find((item) => item.name === name);
          assert(group && institute, name);
          const url = new URL(`?group=${group.nrec}&institute=${institute.id}`, root).href;
          await page.goto(url, { waitUntil: 'domcontentloaded' });
          await page.waitForFunction((expected) => document.querySelector('.brand h1')?.textContent === expected, name);
          const metrics = await page.evaluate(() => {
            const title = document.querySelector('.brand h1');
            const brand = document.querySelector('.brand-button').getBoundingClientRect();
            const header = document.querySelector('.topbar').getBoundingClientRect();
            const actions = document.querySelector('.header-actions').getBoundingClientRect();
            const style = getComputedStyle(title);
            const range = document.createRange();
            range.selectNodeContents(title);
            const text = range.getBoundingClientRect();
            const skeleton = document.querySelector('.skeleton-hero');
            return {
              text: title.textContent,
              titleWidth: title.clientWidth,
              titleHeight: title.clientHeight,
              scrollWidth: title.scrollWidth,
              scrollHeight: title.scrollHeight,
              overflowX: style.overflowX,
              overflowY: style.overflowY,
              clipped: text.left < header.left - 1 || text.right > header.right + 1
                || text.top < header.top - 1 || text.bottom > header.bottom + 1
                || style.overflowX !== 'visible' && title.scrollWidth > title.clientWidth + 1
                || style.overflowY !== 'visible' && title.scrollHeight > title.clientHeight + 1,
              actionsOverlap: brand.right > actions.left + 1 && brand.left < actions.right - 1
                && brand.bottom > actions.top + 1 && brand.top < actions.bottom - 1,
              textOverlapsControls: text.right > actions.left + 1 && text.left < actions.right - 1
                && text.bottom > actions.top + 1 && text.top < actions.bottom - 1,
              viewportOverflow: document.documentElement.scrollWidth > innerWidth,
              skeletonThemeCorrect: !skeleton || skeleton.classList.contains('light-hero')
                === (document.documentElement.dataset.themeMode === 'light'),
              actionGap: Math.round(actions.left - brand.right)
            };
          });
          await page.screenshot({ path: `artifacts/qa/group-header/${group.nrec}-${viewport.width}.png` });
          console.log(JSON.stringify({ viewport, ...metrics }));
          assert.equal(metrics.text, name);
          assert.equal(metrics.clipped, false, `${name} clipped at ${viewport.width}`);
          assert.equal(metrics.actionsOverlap, false, `${name} overlaps controls at ${viewport.width}`);
          assert.equal(metrics.textOverlapsControls, false);
          assert.equal(metrics.viewportOverflow, false);
          assert.equal(metrics.skeletonThemeCorrect, true);
          assert.deepEqual(errors, []);
        }
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
