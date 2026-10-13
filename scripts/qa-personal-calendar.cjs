const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const group = JSON.parse(fs.readFileSync('public/data/schedule/7936a2a43b11b20b01d30f5b00c73166.json', 'utf8')).group;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
  fs.mkdirSync('artifacts/qa/personal-calendar', { recursive: true });
  try {
    for (const viewport of [{ width: 402, height: 874 }, { width: 874, height: 402 }]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript((group) => {
        localStorage.setItem('lad.selected-group.v2', JSON.stringify({ ...group, id: group.nrec, visualKey: 'iite' }));
      }, group);
      await page.goto(process.env.QA_URL || 'http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
      await page.getByTestId('today-calendar-launch').click();
      const calendar = page.getByRole('dialog', { name: 'Календарь', exact: true });
      const month = await page.locator('.calendar-month-label strong').textContent();
      const grid = await page.locator('.calendar-grid').boundingBox();
      await page.mouse.move(grid.x + grid.width * .8, grid.y + grid.height * .5);
      await page.mouse.down();
      await page.mouse.move(grid.x + grid.width * .2, grid.y + grid.height * .5, { steps: 12 });
      await page.mouse.up();
      await page.waitForFunction((previous) => document.querySelector('.calendar-month-label strong')?.textContent !== previous, month);
      await calendar.getByRole('button', { name: 'Предыдущий месяц', exact: true }).click();
      await calendar.getByRole('button', { name: 'Добавить событие', exact: true }).click();
      await page.getByLabel('Название', { exact: true }).fill('Репетиция дуэта');
      const day = await page.evaluate(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      });
      await page.getByLabel('Начало', { exact: true }).fill(`${day}T18:30`);
      await page.getByLabel('Окончание', { exact: true }).fill(`${day}T20:00`);
      await page.getByLabel('Место', { exact: true }).fill('Зал 2');
      await page.getByLabel('Описание', { exact: true }).fill('Прогон новой постановки');
      const formGeometry = await page.evaluate(() => {
        const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect().toJSON();
        return { viewport: innerHeight, sheet: rect('.smart-calendar'), form: rect('.personal-event-form'), formHeader: rect('.personal-event-form header'), title: rect('.personal-event-form input'), footer: rect('.personal-event-form footer') };
      });
      assert.ok(formGeometry.formHeader.top >= 0 && formGeometry.formHeader.bottom <= formGeometry.viewport);
      assert.ok(formGeometry.footer.top >= 0 && formGeometry.footer.bottom <= formGeometry.viewport);
      console.log(JSON.stringify({ viewport, formGeometry }));
      await page.screenshot({ path: `artifacts/qa/personal-calendar/form-${viewport.width}.png` });
      await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
      await page.reload({ waitUntil: 'domcontentloaded' });
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('lad.personal-events.v1')));
      assert.equal(saved.length, 1);
      assert.equal(saved[0].location, 'Зал 2');
      assert.equal(saved[0].description, 'Прогон новой постановки');
      assert.equal(new Date(saved[0].end) - new Date(saved[0].start), 90 * 60000);
      await page.getByTestId('today-calendar-launch').click();
      await page.getByRole('button', { name: 'Изменить событие: Репетиция дуэта', exact: true }).click();
      await page.getByLabel('Место', { exact: true }).fill('Зал 3');
      await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('lad.personal-events.v1'))[0].location), 'Зал 3');
      await page.getByRole('button', { name: 'Изменить событие: Репетиция дуэта', exact: true }).click();
      await page.getByRole('button', { name: 'Удалить', exact: true }).click();
      await page.getByRole('button', { name: 'Подтвердить удаление', exact: true }).click();
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('lad.personal-events.v1')).length), 0);
      await page.getByRole('button', { name: 'Закрыть календарь', exact: true }).click();
      await page.getByTestId('open-theme-picker').click();
      await page.getByRole('button', { name: 'Тёмная', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'Тёмная', exact: true }).getAttribute('aria-pressed'), 'true');
      await page.screenshot({ path: `artifacts/qa/personal-calendar/theme-dark-${viewport.width}.png` });
      await page.getByRole('button', { name: 'Светлая', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'Светлая', exact: true }).getAttribute('aria-pressed'), 'true');
      await page.getByRole('button', { name: 'Закрыть выбор темы', exact: true }).click();
      await page.reload({ waitUntil: 'domcontentloaded' });
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('lad.custom-theme')).mode), 'light');
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ viewport, monthSwipe: true, savedAfterReload: true, editAndDelete: true, themePersisted: true, errors }));
      await page.close();
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
