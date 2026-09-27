const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const catalog = JSON.parse(execFileSync('git', ['show', 'origin/data:data/catalog.json'], { encoding: 'utf8' }));
const institute = catalog.institutes.find((item) => item.groups.some((group) => group.name === 'АРХ-121'));
const group = institute.groups.find((item) => item.name === 'АРХ-121');
const base = process.env.QA_URL;
if (!base) throw new Error('Build and preview with PAGES_BASE, then set QA_URL to the subpath URL');
const missing = process.env.QA_MISSING_ARCHIVE === '1';
const output = `artifacts/qa/archive-${missing ? 'missing' : 'fallback'}-402.png`;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
  try {
    const page = await browser.newPage({ viewport: { width: 402, height: 874 }, serviceWorkers: 'block' });
    const errors = [];
    const requests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => requests.push(request.url()));
    await page.addInitScript(({ group, institute }) => {
      localStorage.setItem('lad.selected-group.v2', JSON.stringify({
        id: group.nrec,
        nrec: group.nrec,
        name: group.name,
        instituteId: institute.id,
        instituteName: institute.name,
        instituteShortName: institute.shortName,
        visualKey: 'architecture'
      }));
    }, { group, institute });
    await page.route('**/data/schedule/**', (route) => route.fulfill({ status: 404, body: 'Not found' }));
    await page.route('https://vlsu-pi-124-schedule.polkin-06.workers.dev/app-api/schedule/**', (route) => {
      if (missing) {
        return route.fulfill({ status: 404, contentType: 'application/json',
          headers: { 'Access-Control-Allow-Origin': new URL(base).origin },
          body: JSON.stringify({ error: 'No saved schedule for this group' }) });
      }
      const snapshot = {
        schemaVersion: 2,
        group: { nrec: group.nrec, name: group.name },
        semester: 5,
        currentInfo: { CurrentLesson: '', CurrentWeekType: 1, Name: group.name, CurrentSemester: 5 },
        schedule: [{ type: 'Lessons', name: 'Понедельник', n1: '101, лк, Тестовый преподаватель, QA резервный снимок' }],
        weekType: 1,
        weekTypeAsOf: '2026-09-08T09:00:00.000Z',
        scheduleFetchedAt: '2026-09-08T09:00:00.000Z',
        contentHash: 'a'.repeat(64),
        source: 'global-snapshot',
        ageSeconds: 0,
        requestId: 'qa-archive',
        quality: { valid: true, scheduleEntries: 1, lessonDays: 1, examEntries: 0, warnings: [] }
      };
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': new URL(base).origin },
        body: JSON.stringify(snapshot)
      });
    });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    if (missing) {
      await page.getByText('Расписание не получено').waitFor({ timeout: 8000 });
      assert(!(await page.getByText('QA резервный снимок').count()), 'Missing data must not look like a free day');
    } else {
      await page.waitForFunction((nrec) => Boolean(localStorage.getItem(`lad.schedule.v2:${nrec}`)), group.nrec,
        { timeout: 8000 });
      await page.getByRole('button', { name: 'Неделя', exact: true }).last().click();
      await page.getByRole('radio', { name: 'Числитель' }).click();
      await page.getByText('QA резервный снимок').first().waitFor({ timeout: 8000 });
    }
    const nav = await page.locator('.bottom-nav').boundingBox();
    assert(nav && Math.round(nav.y + nav.height) === 874, 'Navigation must meet viewport bottom');
    assert(requests.some((url) => url.includes(`/app-api/schedule/${group.nrec}?cached=1`)),
      'Pages must request the cached-only Worker endpoint');
    assert(!requests.some((url) => url.includes('/vlsu-api/')), 'Pages must not wait for live VLSU');
    assert.deepEqual(errors, [], 'Fallback must not cause runtime errors');
    fs.mkdirSync('artifacts/qa', { recursive: true });
    await page.screenshot({ path: output });
    console.log(JSON.stringify({ group: group.name, workerFallback: !missing, navBottom: nav.y + nav.height,
      viewportHeight: 874, errors, screenshot: output }));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
