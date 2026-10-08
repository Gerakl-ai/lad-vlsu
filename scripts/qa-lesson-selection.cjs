const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const group = JSON.parse(fs.readFileSync(path.resolve('public/data/schedule/7936a2a43b11b20b01d30f5b00c73166.json'), 'utf8')).group;
const otherGroup = JSON.parse(fs.readFileSync(path.resolve('public/data/schedule/0107a80d5bdd182f4b2609a637266fb7.json'), 'utf8')).group;
const url = process.env.QA_URL || 'http://127.0.0.1:4173/';
const output = path.resolve('artifacts/qa/lesson-selection');
fs.mkdirSync(output, { recursive: true });

(async () => {
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH
    || (fs.existsSync(chromium.executablePath()) ? chromium.executablePath() : fs.existsSync(edge) ? edge : undefined);
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  try {
    for (const viewport of [{ width: 402, height: 874 }, { width: 430, height: 932 }, { width: 1440, height: 900 }]) {
      const context = await browser.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500, timezoneId: 'Europe/Moscow', serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.clock.setFixedTime(new Date('2026-10-06T09:40:00+03:00'));
      await page.addInitScript((selected) => {
        localStorage.setItem('lad.selected-group.v2', JSON.stringify({ ...selected, id: selected.nrec, visualKey: 'institute-1' }));
        localStorage.setItem(`lad.subgroup.v1:${selected.nrec}`, '0');
      }, group);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      const row = page.locator('.lesson-row').first();
      await row.waitFor({ timeout: 20000 });
      const initial = await row.locator('.lesson-title').innerText();
      await row.locator('.lesson-row-button').click();
      const picker = row.getByRole('group', { name: 'Выбрать свою пару' });
      assert.equal(await picker.getByRole('button', { name: 'Показать оба варианта' }).getAttribute('aria-pressed'), 'true');
      await picker.getByRole('button', { name: /архитектуры/i }).click();
      assert.match(await row.locator('.lesson-title').innerText(), /архитектуры/i);
      await picker.getByRole('button', { name: /искусственного интеллекта/i }).click();
      assert.match(await row.locator('.lesson-title').innerText(), /искусственного интеллекта/i);
      await page.screenshot({ path: path.join(output, `oct-06-${viewport.width}.png`) });
      const stored = await page.evaluate((nrec) => localStorage.getItem(`lad.lesson-selection.v1:${nrec}:5`), group.nrec);
      assert(stored && stored.includes('основы-искусственного-интеллекта'), 'selected subject not saved');

      await page.clock.setFixedTime(new Date('2026-10-13T09:40:00+03:00'));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await row.waitFor({ timeout: 20000 });
      const nextWeek = await row.locator('.lesson-title').innerText();
      assert.match(nextWeek, /архитектуры/i, `13 October should swap: ${nextWeek}`);
      await page.clock.setFixedTime(new Date('2026-10-09T09:40:00+03:00'));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await row.waitFor({ timeout: 20000 });
      await row.locator('.lesson-row-button').click();
      await row.getByRole('group', { name: 'Выбрать свою пару' }).getByRole('button', { name: /backend/i }).click();
      const friday = await row.locator('.lesson-title').innerText();
      assert.match(friday, /backend/i, `9 October should show chosen lesson: ${friday}`);
      await page.clock.setFixedTime(new Date('2026-10-16T09:40:00+03:00'));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await row.waitFor({ timeout: 20000 });
      const nextFriday = await row.locator('.lesson-title').innerText();
      assert.match(nextFriday, /безопасность/i, `16 October should swap: ${nextFriday}`);
      await page.locator('.bottom-nav').getByRole('button', { name: 'Неделя', exact: true }).click();
      await page.locator('.mini-lesson').first().waitFor({ timeout: 20000 });
      await page.screenshot({ path: path.join(output, `week-${viewport.width}.png`) });
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ viewport, initial, nextWeek, friday, nextFriday, saved: Boolean(stored), errors }));
      await context.close();
    }

    const context = await browser.newContext({ viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true, timezoneId: 'Europe/Moscow', serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date('2026-10-12T12:30:00+03:00'));
    await page.addInitScript((selected) => {
      localStorage.setItem('lad.selected-group.v2', JSON.stringify({ ...selected, id: selected.nrec, visualKey: 'institute-2' }));
    }, otherGroup);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const source = page.locator('.lesson-row').filter({ hasText: 'Инженерная гидрология' }).first();
    await source.waitFor({ timeout: 20000 });
    await source.locator('.lesson-row-button').click();
    await source.getByRole('group', { name: 'Выбрать свою пару' }).getByRole('button', { name: /Инженерная гидрология/i }).click();
    assert.match(await source.locator('.lesson-title').innerText(), /Инженерная гидрология/i);
    await page.clock.setFixedTime(new Date('2026-10-19T12:30:00+03:00'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    const changed = page.locator('.lesson-row').filter({ hasText: 'Технология и организация строительства' }).first();
    await changed.waitFor({ timeout: 20000 });
    await changed.locator('.lesson-row-button').click();
    const picker = changed.getByRole('group', { name: 'Выбрать свою пару' });
    assert.equal(await picker.getByRole('button', { name: 'Показать оба варианта' }).getAttribute('aria-pressed'), 'true');
    await picker.getByRole('button', { name: /Изыскания и проектирование/i }).click();
    assert.match(await changed.locator('.lesson-title').innerText(), /Изыскания и проектирование/i);
    await page.screenshot({ path: path.join(output, 'other-group-402.png') });
    console.log(JSON.stringify({ group: otherGroup.name, firstWeek: 'Инженерная гидрология', secondWeek: 'manual choice required and works' }));
    await context.close();
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
