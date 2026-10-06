const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

const id = '7936a2a43b11b20b01d30f5b00c73166';
const root = process.env.QA_URL || 'http://127.0.0.1:4173/';
const url = new URL(`?group=${id}&institute=5b42fa53ec1dd1892e5ec44a3a60a896`, root).href;

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
    const scheduleRequests = [];
    page.on('response', (response) => {
      if (response.url().includes('/data/schedule/') || response.url().includes('/app-api/schedule/')) scheduleRequests.push({ url: response.url(), status: response.status() });
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install({ time: new Date('2026-10-05T09:00:00Z') });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator('.bottom-nav').getByRole('button', { name: 'Неделя' }).click();
    await page.locator('.week-subgroup-picker').waitFor();
    const picker = page.locator('.week-subgroup-picker');
    const tuesday = page.locator('.day-block').filter({ has: page.getByRole('heading', { name: 'Вторник' }) });
    const friday = page.locator('.day-block').filter({ has: page.getByRole('heading', { name: 'Пятница' }) });
    await picker.getByRole('button', { name: '1', exact: true }).click();
    assert.match(await tuesday.locator('.mini-lesson').first().innerText(), /искусственного интеллекта/);
    assert.match(await friday.locator('.mini-lesson').first().innerText(), /backend/);
    await picker.getByRole('button', { name: '2', exact: true }).click();
    assert.match(await tuesday.locator('.mini-lesson').first().innerText(), /архитектуры и интеграции/);
    assert.match(await tuesday.locator('.mini-lesson').first().innerText(), /перенесена на дистант/);
    assert.match(await friday.locator('.mini-lesson').first().innerText(), /Информационная безопасность/);
    const geometry = await page.evaluate(() => ({ navBottom: document.querySelector('.bottom-nav').getBoundingClientRect().bottom,
      viewportBottom: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth }));
    assert.ok(Math.abs(geometry.navBottom - geometry.viewportBottom) < 2);
    assert.equal(geometry.overflow, false);
    fs.mkdirSync('artifacts/qa/subgroup', { recursive: true });
    await page.screenshot({ path: 'artifacts/qa/subgroup/week-402.png' });
    await page.locator('.mode-switch').getByRole('radio', { name: 'Числитель' }).click();
    assert.match(await friday.locator('.mini-lesson').first().innerText(), /backend/);
    await picker.getByRole('button', { name: '1', exact: true }).click();
    assert.match(await friday.locator('.mini-lesson').first().innerText(), /Информационная безопасность/);
    await page.locator('.bottom-nav').getByRole('button', { name: 'Сегодня' }).click();
    await page.getByRole('button', { name: 'Следующий день' }).click();
    await page.locator('.today-view').waitFor();
    await page.locator('.lesson-row').first().locator('.lesson-row-button').click();
    await page.locator('.today-view .subgroup-picker').getByRole('button', { name: '1', exact: true }).click();
    assert.match(await page.locator('.hero-card').innerText(), /искусственного интеллекта/);
    await page.locator('.today-view .subgroup-picker').getByRole('button', { name: '2', exact: true }).click();
    assert.match(await page.locator('.hero-card').innerText(), /архитектуры и интеграции/);
    assert.match(await page.locator('.hero-card').innerText(), /перенесена на дистант/);
    await page.setViewportSize({ width: 430, height: 932 });
    await page.screenshot({ path: 'artifacts/qa/subgroup/today-430.png' });
    const todayGeometry = await page.evaluate(() => ({ navBottom: document.querySelector('.bottom-nav').getBoundingClientRect().bottom,
      viewportBottom: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth }));
    assert.ok(Math.abs(todayGeometry.navBottom - todayGeometry.viewportBottom) < 2);
    assert.equal(todayGeometry.overflow, false);
    await page.evaluate((groupId) => {
      const key = `lad.schedule.v2:${groupId}`;
      const cached = JSON.parse(localStorage.getItem(key));
      const tuesday = cached.allLessons.find((lesson) => lesson.dayIndex === 2 && lesson.pairIndex === 1 && lesson.weekMode === 'denominator');
      tuesday.variants.reverse();
      tuesday.rawText = tuesday.variants.map((variant) => variant.rawText).join('\n');
      tuesday.subject = tuesday.variants.map((variant) => variant.subject).join(' / ');
      cached.fetchedAt = '2026-10-07T12:00:00Z';
      localStorage.setItem(key, JSON.stringify(cached));
      localStorage.setItem(`lad.subgroup.v1:${groupId}`, '0');
    }, id);
    if (process.env.QA_OFFLINE_CACHE === '1') {
      await page.route('**/data/schedule/**', (route) => route.abort());
      await page.route('**/app-api/schedule/**', (route) => route.abort());
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Следующий день' }).click();
    try {
      await page.waitForFunction(() => document.querySelector('.hero-card')?.textContent?.includes('искусственного интеллекта'), null, { timeout: 12000 });
    } catch (error) {
      await page.screenshot({ path: 'artifacts/qa/subgroup/today-cache-recovery-failed.png' });
      console.error('Recovery diagnostics:', await page.evaluate(() => ({
        hero: document.querySelector('.hero-card')?.textContent,
        date: document.querySelector('.date-card')?.textContent,
        status: document.querySelector('.sync-status')?.textContent,
        cached: (() => { const value = JSON.parse(localStorage.getItem('lad.schedule.v2:7936a2a43b11b20b01d30f5b00c73166')); return { fetchedAt: value.fetchedAt, variants: value.allLessons.find((item) => item.dayIndex === 2 && item.pairIndex === 1 && item.weekMode === 'denominator')?.variants?.map((item) => item.subject) }; })()
      })), { scheduleRequests, errors });
      throw error;
    }
    const restoredCache = await page.evaluate((groupId) => JSON.parse(localStorage.getItem(`lad.schedule.v2:${groupId}`)), id);
    assert.match(restoredCache.allLessons.find((lesson) => lesson.dayIndex === 2 && lesson.pairIndex === 1 && lesson.weekMode === 'denominator').variants[0].subject, /искусственного интеллекта/);
    await page.screenshot({ path: 'artifacts/qa/subgroup/today-restored-cache-430.png' });
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(JSON.stringify({ geometry, todayGeometry, errors, checks: 'Tuesday and Friday, both subgroups and week types; Today both subgroups; corrupted cache recovery' }));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
