const { chromium } = require('playwright');
const { mkdirSync } = require('node:fs');
const assert = require('node:assert/strict');

const outputDir = 'artifacts/qa/notes-empty';
mkdirSync(outputDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
  try {
    for (const viewport of [{ width: 402, height: 874 }, { width: 874, height: 402 }]) {
      const page = await browser.newPage({ viewport, serviceWorkers: 'block' });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(() => {
        const nrec = '7936a2a43b11b20b01d30f5b00c73166';
        localStorage.setItem('lad.selected-group.v2', JSON.stringify({
          id: nrec,
          nrec,
          name: 'ПИ-124',
          instituteId: '5b42fa53ec1dd1892e5ec44a3a60a896',
          instituteName: 'Институт информационных технологий и электроники',
          instituteShortName: 'ИИТЭ',
          visualKey: 'iite'
        }));
      });
      await page.goto(`${process.env.QA_URL || 'http://127.0.0.1:5173/'}?tab=notes`, { waitUntil: 'domcontentloaded' });
      await page.locator('.notes-empty').waitFor();
      assert.equal(await page.locator('.notes-pulse').count(), 0);
      assert.equal(await page.locator('.notes-search').count(), 0);
      assert.equal(await page.locator('.space-rail > button').count(), 1);
      assert.equal(await page.getByRole('button', { name: 'Создать запись', exact: true }).count(), 1);
      assert.equal(await page.locator('.calendar-launch-card').count(), 1);
      await page.screenshot({ path: `${outputDir}/empty-${viewport.width}.png` });

      await page.getByRole('button', { name: 'Создать запись', exact: true }).click();
      await page.locator('.rich-editor-content [contenteditable="true"]').fill('Проверка новой записи');
      await page.getByRole('button', { name: 'Сохранить запись' }).click();
      await page.locator('.notes-list').waitFor();
      assert.equal(await page.locator('.notes-pulse').count(), 1);
      assert.equal(await page.locator('.notes-search').count(), 1);
      assert.equal(await page.getByText('Проверка новой записи').count() > 0, true);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `${outputDir}/populated-${viewport.width}.png` });
      console.log(JSON.stringify({ viewport, emptyState: true, savedNote: true, errors }));
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
