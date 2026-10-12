const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

const root = process.env.QA_URL || 'http://127.0.0.1:4173/';
const catalog = JSON.parse(fs.readFileSync('public/data/catalog.json', 'utf8'));
const snapshot = JSON.parse(fs.readFileSync('public/data/schedule/7936a2a43b11b20b01d30f5b00c73166.json', 'utf8'));
const output = 'artifacts/qa/group-startup';
const viewports = [{ width: 402, height: 874 }, { width: 430, height: 932 }, { width: 874, height: 402 }, { width: 1440, height: 900 }];

function profile(name) {
  const institute = catalog.institutes.find((entry) => entry.groups.some((group) => group.name === name));
  const group = institute?.groups.find((entry) => entry.name === name);
  assert(group && institute, name);
  return { ...group, id: group.nrec, instituteId: institute.id, instituteName: institute.name,
    instituteShortName: institute.shortName, visualKey: 'institute-1' };
}

async function prepare(page, group, cache) {
  await page.clock.setFixedTime(new Date('2026-10-12T09:40:00+03:00'));
  await page.addInitScript(({ group, cache }) => {
    localStorage.setItem('lad.selected-group.v2', JSON.stringify(group));
    if (cache) localStorage.setItem(`lad.schedule.v2:${group.nrec}`, JSON.stringify(cache));
    let complete = false;
    Object.defineProperty(window, '__ladBootComplete', {
      configurable: true,
      get: () => complete,
      set: (value) => { complete = value; if (value) window.__qaBootAt = performance.now(); }
    });
  }, { group, cache });
}

async function controlledPage(browser, viewport, group, cache) {
  const context = await browser.newContext({ viewport, timezoneId: 'Europe/Moscow', serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await prepare(page, group, cache);
  let release;
  let mode = 'error';
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!/\/(?:data|app-api|vlsu-api)\//.test(url.pathname)) return route.continue();
    await gate;
    if (mode === 'success' && url.pathname.endsWith(`/schedule/${snapshot.group.nrec}.json`)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snapshot) });
    }
    return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
  });
  return { context, page, errors, release: (nextMode = 'error') => { mode = nextMode; release(); } };
}

const sinceBoot = (page) => page.evaluate(() => Math.round(performance.now() - window.__qaBootAt));
const nav = (page, label) => page.locator('.bottom-nav').getByRole('button', { name: label, exact: true });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  fs.mkdirSync(output, { recursive: true });
  try {
    for (const viewport of viewports) {
      const metadata = await controlledPage(browser, viewport, profile('ЗАФКд-126'));
      try {
        const { page } = metadata;
        await page.goto(root, { waitUntil: 'domcontentloaded' });
        const panel = page.getByRole('region', { name: 'Учебный календарь' });
        await panel.waitFor();
        const calendarShownMs = await sinceBoot(page);
        assert(calendarShownMs < 1000, `local calendar took ${calendarShownMs}ms after app boot`);
        assert.equal(await page.locator('.skeleton-hero').count(), 0);
        assert.equal(await page.locator('.week-chip-health.offline').count(), 0);
        if (viewport.height < 560) {
          const action = page.getByRole('button', { name: 'Выбрать другую группу', exact: true });
          await action.scrollIntoViewIfNeeded();
          const reachable = await action.evaluate((element) => {
            const box = element.getBoundingClientRect();
            const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
            return box.top >= 0 && box.bottom <= innerHeight && element.contains(hit);
          });
          assert.equal(reachable, true, 'landscape group action is clipped');
        }
        await page.screenshot({ path: `${output}/local-calendar-${viewport.width}.png` });
        await panel.locator('.study-period-list button').first().click();
        const calendar = page.getByRole('dialog', { name: 'Календарь', exact: true });
        await calendar.locator('.calendar-study-period').waitFor();
        assert.match(await calendar.innerText(), /25 января 2027 - 5 февраля 2027/);
        await calendar.getByRole('button', { name: 'Закрыть календарь' }).click();
        await nav(page, 'Неделя').click();
        await panel.waitFor();
        metadata.release();
        await page.waitForFunction(() => document.querySelector('.topbar')?.dataset.syncStatus === 'error-without-cache');
        await panel.waitFor();
        assert.equal(await page.getByText('Сегодня без пар', { exact: true }).count(), 0);
        assert.deepEqual(metadata.errors, []);
        console.log(JSON.stringify({ viewport, scenario: 'local-calendar-before-network', calendarShownMs, usableDuringRequest: true }));
      } finally { metadata.release(); await metadata.context.close(); }

      const emptyLegacy = viewport.width === 402 ? {
        groupNrec: snapshot.group.nrec, fetchedAt: '2099-01-01T00:00:00Z', allLessons: [],
        currentInfo: { currentLesson: '', currentWeekType: 1, name: 'ПИ-124', semester: 5 }
      } : undefined;
      const late = await controlledPage(browser, viewport, profile('ПИ-124'), emptyLegacy);
      let savedCache;
      try {
        const { page } = late;
        await page.goto(root, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('.topbar')?.dataset.syncStatus === 'checking-without-cache');
        const placeholderShownMs = await sinceBoot(page);
        assert(placeholderShownMs < 1800, `startup budget took ${placeholderShownMs}ms`);
        assert.equal(await page.locator('.skeleton-hero').count(), 0);
        assert.equal(await page.locator('.week-chip-health.offline').count(), 0);
        await nav(page, 'Записи').click();
        await page.getByRole('button', { name: /Создать запись/ }).first().waitFor();
        const position = await page.locator('.content-scroll').evaluate((element) => {
          element.scrollTop = 40;
          return element.scrollTop;
        });
        late.release('success');
        await page.waitForFunction(() => document.querySelector('.topbar')?.dataset.syncStatus === 'ready');
        assert.equal(await page.locator('.content-scroll').getAttribute('data-active-tab'), 'notes');
        assert.equal(await page.locator('.content-scroll').evaluate((element) => element.scrollTop), position);
        savedCache = await page.evaluate((nrec) => JSON.parse(localStorage.getItem(`lad.schedule.v2:${nrec}`)), snapshot.group.nrec);
        assert(savedCache?.allLessons?.length, 'late response did not persist the timetable');
        assert.notEqual(savedCache.fetchedAt, '2099-01-01T00:00:00Z');
        await nav(page, 'Сегодня').click();
        await page.locator('.lesson-row').first().waitFor();
        assert.deepEqual(late.errors, []);
        console.log(JSON.stringify({ viewport, scenario: emptyLegacy ? 'late-success-after-empty-legacy-cache' : 'late-success-without-cache', placeholderShownMs, keptTabAndScroll: true }));
      } finally { late.release(); await late.context.close(); }

      const cached = await controlledPage(browser, viewport, profile('ПИ-124'), savedCache);
      try {
        const { page } = cached;
        await page.goto(root, { waitUntil: 'domcontentloaded' });
        await page.locator('.lesson-row').first().waitFor();
        const cacheShownMs = await sinceBoot(page);
        assert(cacheShownMs < 1000);
        await page.waitForTimeout(1200);
        assert.equal(await page.locator('.topbar').getAttribute('data-sync-status'), 'refreshing');
        assert.equal(await page.locator('.week-chip-health.offline').count(), 0);
        assert.equal(await page.locator('.skeleton-hero').count(), 0);
        cached.release();
        await page.waitForFunction(() => document.querySelector('.topbar')?.dataset.syncStatus === 'stale');
        assert.equal(await page.locator('.lesson-row').count() > 0, true);
        assert.deepEqual(cached.errors, []);
        console.log(JSON.stringify({ viewport, scenario: 'cache-remains-ready-during-slow-refresh', cacheShownMs, offlineOnlyAfterFailure: true }));
      } finally { cached.release(); await cached.context.close(); }
    }

    const unknown = await controlledPage(browser, viewports[0], profile('ЗМНммрд-124'));
    try {
      await unknown.page.goto(root, { waitUntil: 'domcontentloaded' });
      await unknown.page.waitForFunction(() => document.querySelector('.topbar')?.dataset.syncStatus === 'checking-without-cache');
      assert.equal(await unknown.page.getByRole('region', { name: 'Учебный календарь' }).count(), 0);
      unknown.release();
      await unknown.page.waitForFunction(() => document.querySelector('.topbar')?.dataset.syncStatus === 'error-without-cache');
      assert.equal(await unknown.page.getByRole('button', { name: 'Повторить', exact: true }).isEnabled(), true);
      assert.equal(await unknown.page.getByText('Сегодня без пар', { exact: true }).count(), 0);
      assert.deepEqual(unknown.errors, []);
      console.log(JSON.stringify({ scenario: 'error-without-any-local-timetable', retryAvailable: true, falseFreeDay: false }));
    } finally { unknown.release(); await unknown.context.close(); }

    for (const viewport of viewports.slice(0, 2)) {
      const context = await browser.newContext({ viewport, timezoneId: 'Europe/Moscow' });
      try {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await prepare(page, profile('ЗАФКд-126'));
        await page.goto(root, { waitUntil: 'domcontentloaded' });
        await page.getByRole('region', { name: 'Учебный календарь' }).waitFor();
        await page.waitForFunction(async () => Boolean(navigator.serviceWorker.controller
          && await caches.match(new URL('.', location.href).href)), null, { timeout: 30000 });
        await context.setOffline(true);
        await page.reload({ waitUntil: 'domcontentloaded' });
        const panel = page.getByRole('region', { name: 'Учебный календарь' });
        await panel.waitFor();
        const offlineCalendarShownMs = await sinceBoot(page);
        assert(offlineCalendarShownMs < 1000);
        await panel.locator('.study-period-list button').first().click();
        const calendar = page.getByRole('dialog', { name: 'Календарь', exact: true });
        await calendar.locator('.calendar-study-period').waitFor();
        assert.match(await calendar.innerText(), /25 января 2027 - 5 февраля 2027/);
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${output}/offline-calendar-${viewport.width}.png` });
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ viewport, scenario: 'full-offline-reload', offlineCalendarShownMs, calendarOpened: true }));
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
