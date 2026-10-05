const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

const id = '7936a2a43b11b20b01d30f5b00c73166';
const url = `http://127.0.0.1:4173/?group=${id}&institute=5b42fa53ec1dd1892e5ec44a3a60a896`;

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2 });
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
    await page.locator('.today-view .subgroup-picker').getByRole('button', { name: '2', exact: true }).click();
    assert.match(await page.locator('.hero-card').innerText(), /архитектуры и интеграции/);
    assert.match(await page.locator('.hero-card').innerText(), /перенесена на дистант/);
    await page.setViewportSize({ width: 430, height: 932 });
    await page.screenshot({ path: 'artifacts/qa/subgroup/today-430.png' });
    const todayGeometry = await page.evaluate(() => ({ navBottom: document.querySelector('.bottom-nav').getBoundingClientRect().bottom,
      viewportBottom: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth }));
    assert.ok(Math.abs(todayGeometry.navBottom - todayGeometry.viewportBottom) < 2);
    assert.equal(todayGeometry.overflow, false);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(JSON.stringify({ geometry, todayGeometry, errors, checks: 'Tuesday and Friday, both subgroups and week types; Today change' }));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
