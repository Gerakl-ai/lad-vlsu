const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const nrec = '7936a2a43b11b20b01d30f5b00c73166';
const snapshot = execFileSync('git', ['show', `origin/data:data/schedule/${nrec}.json`], { encoding: 'utf8' });
const newerDate = '2026-09-28T08:00:00.000Z';
const workerDate = '2026-09-28T08:30:00.000Z';
const probeWorker = process.env.QA_ARCHIVED === '1';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
  try {
    const page = await browser.newPage({ viewport: { width: 402, height: 874 }, serviceWorkers: 'block', timezoneId: 'Europe/Moscow' });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-09-28T09:00:00.000Z'));
    await page.addInitScript(({ nrec, newerDate }) => {
      localStorage.setItem('lad.selected-group.v2', JSON.stringify({
        id: nrec, nrec, name: 'ПИ-124', instituteId: '5b42fa53ec1dd1892e5ec44a3a60a896',
        instituteName: 'Институт информационных технологий и электроники', instituteShortName: 'ИИТЭ', visualKey: 'iite'
      }));
      localStorage.setItem(`lad.schedule.v2:${nrec}`, JSON.stringify({
        groupNrec: nrec,
        currentInfo: { currentLesson: '', currentWeekType: 1, name: 'ПИ-124', semester: 5 },
        allLessons: [{
          id: 'qa-newer', dayIndex: 1, dayName: 'Понедельник', pairIndex: 1,
          start: '08:30', end: '10:00', subject: 'Контрольная актуальная пара',
          rawText: '111-3, лк, Шутов А.В., Контрольная актуальная пара', weekMode: 'all'
        }],
        fetchedAt: newerDate
      }));
    }, { nrec, newerDate });
    await page.route('**/data/schedule/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
    if (probeWorker) {
      const archived = {
        schemaVersion: 2,
        group: { nrec, name: 'ПИ-124' },
        semester: 5,
        currentInfo: { CurrentLesson: '', CurrentWeekType: 1, Name: 'ПИ-124', CurrentSemester: 5 },
        schedule: [{ type: 'Lessons', name: 'Понедельник', n1: '111-3, лк, Шутов А.В., Новейшая пара из Worker', z1: '111-3, лк, Шутов А.В., Новейшая пара из Worker' }],
        weekType: 1,
        weekTypeAsOf: workerDate,
        scheduleFetchedAt: workerDate,
        contentHash: 'a'.repeat(64),
        source: 'global-snapshot',
        ageSeconds: 0,
        requestId: 'qa-worker',
        quality: { valid: true, scheduleEntries: 1, lessonDays: 1, examEntries: 0, warnings: [] }
      };
      await page.route('https://worker.example/app-api/schedule/**', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(archived)
      }));
    }
    await page.goto(process.env.QA_URL || 'http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
    await page.locator('.today-view .lesson-title', { hasText: 'Контрольная актуальная пара' }).waitFor();
    if (probeWorker) {
      await page.locator('.today-view .lesson-title', { hasText: 'Новейшая пара из Worker' }).waitFor();
    } else {
      await page.waitForTimeout(1500);
      assert.equal(await page.locator('.today-view .lesson-title', { hasText: 'Контрольная актуальная пара' }).count(), 1);
    }
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), `lad.schedule.v2:${nrec}`);
    assert.equal(saved.fetchedAt, probeWorker ? workerDate : newerDate);
    assert.equal(saved.allLessons[0].subject, probeWorker ? 'Новейшая пара из Worker' : 'Контрольная актуальная пара');
    assert.deepEqual(errors, []);
    fs.mkdirSync('artifacts/qa/cache-monotonic', { recursive: true });
    await page.screenshot({ path: `artifacts/qa/cache-monotonic/${probeWorker ? 'worker-upgrade' : 'device-cache'}-402.png` });
    console.log(JSON.stringify({ viewport: '402x874', source: probeWorker ? 'worker' : 'device-cache', savedAt: saved.fetchedAt, errors }));
    await page.close();
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
