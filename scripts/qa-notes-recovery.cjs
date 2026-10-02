const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
  fs.mkdirSync('artifacts/qa/notes-recovery', { recursive: true });

  try {
    for (const viewport of [{ width: 402, height: 874 }, { width: 430, height: 932 }, { width: 874, height: 402 }]) {
      const page = await browser.newPage({ viewport, timezoneId: 'Europe/Moscow' });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(process.env.QA_URL || 'http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
      await page.evaluate(async () => {
        const database = await new Promise((resolve, reject) => {
          const request = indexedDB.open('lad-personal', 2);
          request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains('notes')) {
              request.result.createObjectStore('notes', { keyPath: 'id' });
            }
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        await new Promise((resolve, reject) => {
          const transaction = database.transaction('notes', 'readwrite');
          transaction.objectStore('notes').put({
            id: 'qa-legacy', text: 'Старая запись из базы', title: 'Старая запись из базы',
            kind: 'task', space: 'Входящие', confidence: 1, status: 'open', pinned: false,
            createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z',
            classificationSource: 'local'
          });
          transaction.oncomplete = resolve;
          transaction.onerror = () => reject(transaction.error);
        });
        database.close();
      });

      await page.addInitScript(() => {
        localStorage.removeItem('lad.notes.fallback');
        localStorage.setItem('lad.selected-group.v2', JSON.stringify({
          id: 'qa', nrec: 'qa', name: 'QA', instituteId: 'qa', instituteName: 'QA',
          instituteShortName: 'QA', visualKey: 'iite'
        }));
        const native = window.indexedDB;
        let failed = false;
        Object.defineProperty(window, 'indexedDB', { configurable: true, get() {
          return { open(...args) {
            if (failed) return native.open(...args);
            failed = true;
            const request = { error: new Error('temporary test failure') };
            setTimeout(() => request.onerror?.(), 0);
            return request;
          } };
        } });
      });

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('.bottom-nav button').filter({ hasText: 'Записи' }).click();
      await page.locator('.notes-storage-warning').waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('.bottom-nav button')]
        .some((button) => button.textContent.includes('Записи') && button.classList.contains('active')));
      assert.match(await page.locator('.notes-storage-warning').innerText(), /не удалось проверить данные/i);
      await page.waitForTimeout(550);
      await page.screenshot({ path: `artifacts/qa/notes-recovery/warning-${viewport.width}.png` });

      await page.locator('.notes-storage-warning button').click();
      await page.getByText('Старая запись из базы', { exact: false }).first().waitFor();
      assert.equal(await page.locator('.notes-storage-warning').count(), 0);
      const geometry = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - innerWidth,
        navBottom: document.querySelector('.bottom-nav')?.getBoundingClientRect().bottom,
        viewportBottom: innerHeight
      }));
      assert.equal(geometry.overflow, 0);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `artifacts/qa/notes-recovery/recovered-${viewport.width}.png` });
      console.log(JSON.stringify({ viewport, geometry, errors, result: 'pass' }));
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
