const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

const root = process.env.QA_URL || 'http://127.0.0.1:4173/';
const url = new URL('?group=7936a2a43b11b20b01d30f5b00c73166&institute=5b42fa53ec1dd1892e5ec44a3a60a896', root).href;
const now = '2026-10-08T12:00:00.000Z';
const notes = [
  {
    id: 'qa-long-note', title: 'Подготовка проекта',
    text: 'Подготовка проекта. '.repeat(350), kind: 'task', space: 'Проект',
    confidence: 1, status: 'open', pinned: true, createdAt: now, updatedAt: now,
    classificationSource: 'local'
  },
  {
    id: 'qa-study-note', title: 'Проверить конспект', text: 'Проверить конспект к следующей паре',
    kind: 'note', space: 'Учёба', confidence: 1, status: 'open', pinned: false,
    createdAt: now, updatedAt: now, classificationSource: 'local'
  }
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  fs.mkdirSync('artifacts/qa/notes-desktop', { recursive: true });
  try {
    for (const viewport of [{ width: 402, height: 874 }, { width: 1280, height: 800 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }]) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript((seed) => localStorage.setItem('lad.notes.fallback', JSON.stringify(seed)), notes);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.locator('.bottom-nav').getByRole('button', { name: 'Записи' }).click();
      await page.locator('.note-card').first().waitFor();
      assert.equal(await page.locator('.note-card').count(), 2);
      const geometry = await page.evaluate(() => {
        const rect = (selector) => {
          const node = document.querySelector(selector);
          if (!node) return null;
          const box = node.getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
        };
        return { frame: rect('.phone-frame'), dashboard: rect('.notes-dashboard'), list: rect('.notes-list'),
          overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.equal(geometry.overflow, false);
      assert.ok(geometry.dashboard.right <= viewport.width + 1);
      assert.ok(geometry.list.right <= viewport.width + 1);
      await page.screenshot({ path: `artifacts/qa/notes-desktop/${viewport.width}-list.png` });
      await page.getByTestId('open-note-composer').click();
      const editor = page.locator('.note-composer');
      await editor.waitFor();
      await page.waitForTimeout(450);
      const editorBounds = await editor.boundingBox();
      await page.screenshot({ path: `artifacts/qa/notes-desktop/${viewport.width}-editor.png` });
      assert.ok(editorBounds.x >= -1 && editorBounds.x + editorBounds.width <= viewport.width + 1);
      assert.ok(editorBounds.y >= -1 && editorBounds.y + editorBounds.height <= viewport.height + 1);
      await editor.getByRole('button', { name: 'Закрыть запись' }).click();
      await page.locator('.note-card').first().locator('.note-card-main').click();
      const surface = page.locator('.rich-note-surface');
      await surface.waitFor();
      const longNote = await page.evaluate(() => {
        const scroll = document.querySelector('.rich-editor-content');
        const surface = document.querySelector('.rich-note-surface');
        scroll.scrollTop = scroll.scrollHeight;
        return { fontSize: getComputedStyle(surface).fontSize, scrollHeight: scroll.scrollHeight,
          clientHeight: scroll.clientHeight, scrollTop: scroll.scrollTop };
      });
      assert.equal(longNote.fontSize, '18px');
      assert.ok(longNote.scrollHeight > longNote.clientHeight && longNote.scrollTop > 0);
      await page.screenshot({ path: `artifacts/qa/notes-desktop/${viewport.width}-long-note.png` });
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ viewport, geometry, editor: editorBounds, longNote }));
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
