const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const url = process.env.QA_URL
  || 'https://germanpolkin.ru/lad-vlsu/?group=7936a2a43b11b20b01d30f5b00c73166&institute=5b42fa53ec1dd1892e5ec44a3a60a896';

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  });
  try {
    const screenshotDir = path.join(process.cwd(), 'artifacts', 'qa', 'subgroup-rotation');
    fs.mkdirSync(screenshotDir, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 402, height: 874 }, timezoneId: 'Europe/Moscow' });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      if (sessionStorage.getItem('qa-subgroup-initialized')) return;
      localStorage.setItem('lad.subgroup.v1:7936a2a43b11b20b01d30f5b00c73166', '0');
      sessionStorage.setItem('qa-subgroup-initialized', '1');
    });
    await page.clock.install({ time: new Date('2026-10-06T04:00:00Z') });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const expected = [
      { date: '6 октября', subject: /искусственного интеллекта/i, daysToNext: 3 },
      { date: '9 октября', subject: /backend/i, daysToNext: 4 },
      { date: '13 октября', subject: /архитектуры и интеграции/i, daysToNext: 3 },
      { date: '16 октября', subject: /Информационная безопасность/i, daysToNext: 0 }
    ];
    for (const item of expected) {
      await page.locator('.timeline-card .lesson-title').first().waitFor({ timeout: 15000 });
      const hero = await page.locator('.hero-card h2').innerText();
      const date = await page.locator('.today-date-launch').innerText();
      const first = await page.locator('.timeline-card .lesson-title').first().innerText();
      console.log(JSON.stringify({ date, hero, first }));
      assert.match(date, new RegExp(item.date, 'i'));
      assert.match(first, item.subject);
      if (item.date === '6 октября') await page.screenshot({ path: path.join(screenshotDir, 'oct-06-first-subgroup.png') });
      for (let index = 0; index < item.daysToNext; index += 1) {
        await page.getByRole('button', { name: 'Следующий день' }).click();
      }
    }
    const cacheKey = 'lad.schedule.v2:7936a2a43b11b20b01d30f5b00c73166';
    const oldCache = await page.evaluate((key) => {
      const state = JSON.parse(localStorage.getItem(key) || 'null');
      if (!state) return false;
      for (const dayIndex of [2, 5]) {
        const numerator = state.allLessons.find((lesson) => lesson.dayIndex === dayIndex && lesson.pairIndex === 1 && lesson.weekMode === 'numerator');
        const denominator = state.allLessons.find((lesson) => lesson.dayIndex === dayIndex && lesson.pairIndex === 1 && lesson.weekMode === 'denominator');
        if (!numerator || !denominator) return false;
        numerator.weekMode = 'all';
        state.allLessons = state.allLessons.filter((lesson) => lesson !== denominator);
      }
      state.fetchedAt = '2026-10-15T12:00:00Z';
      localStorage.setItem(key, JSON.stringify(state));
      return true;
    }, cacheKey);
    assert(oldCache, 'Expected a populated schedule cache before migration QA');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.timeline-card .lesson-title').first().waitFor({ timeout: 15000 });
    const firstDate = await page.locator('.today-date-launch').innerText();
    const migratedFirst = await page.locator('.timeline-card .lesson-title').first().innerText();
    console.log(JSON.stringify({ migration: 'cached-all-to-split', firstDate, migratedFirst }));
    assert.match(migratedFirst, /искусственного интеллекта/i);
    for (let index = 0; index < 7; index += 1) await page.getByRole('button', { name: 'Следующий день' }).click();
    const migratedNext = await page.locator('.timeline-card .lesson-title').first().innerText();
    console.log(JSON.stringify({ migration: 'next-week', migratedNext }));
    assert.match(migratedNext, /архитектуры и интеграции/i);
    await page.evaluate(() => localStorage.setItem('lad.subgroup.v1:7936a2a43b11b20b01d30f5b00c73166', '1'));
    await page.context().setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.timeline-card .lesson-title').first().waitFor({ timeout: 15000 });
    const secondOffline = await page.locator('.timeline-card .lesson-title').first().innerText();
    const savedChoice = await page.evaluate(() => localStorage.getItem('lad.subgroup.v1:7936a2a43b11b20b01d30f5b00c73166'));
    const subgroupButtons = await page.locator('button').filter({ hasText: /подгруппа/i }).allInnerTexts();
    console.log(JSON.stringify({ migration: 'offline-second-subgroup', secondOffline, savedChoice, subgroupButtons }));
    assert.match(secondOffline, /архитектуры и интеграции/i);
    for (let index = 0; index < 7; index += 1) await page.getByRole('button', { name: 'Следующий день' }).click();
    const secondNext = await page.locator('.timeline-card .lesson-title').first().innerText();
    console.log(JSON.stringify({ migration: 'offline-second-next-week', secondNext }));
    assert.match(secondNext, /искусственного интеллекта/i);
    await page.screenshot({ path: path.join(screenshotDir, 'oct-13-second-subgroup-offline.png') });
    await page.getByRole('button', { name: 'Неделя', exact: true }).click();
    await page.locator('.week-subgroup-picker button').nth(0).click();
    await page.getByRole('radio', { name: 'Знаменатель' }).click();
    const tuesday = page.locator('.day-block').filter({ has: page.getByRole('heading', { name: 'Вторник' }) });
    const denominatorTitle = await tuesday.locator('.mini-lesson-main strong').first().innerText();
    console.log(JSON.stringify({ screen: 'week', mode: 'denominator', subgroup: 1, denominatorTitle }));
    assert.match(denominatorTitle, /искусственного интеллекта/i);
    await page.getByRole('radio', { name: 'Числитель' }).click();
    const numeratorTitle = await tuesday.locator('.mini-lesson-main strong').first().innerText();
    console.log(JSON.stringify({ screen: 'week', mode: 'numerator', subgroup: 1, numeratorTitle }));
    assert.match(numeratorTitle, /архитектуры и интеграции/i);
    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
