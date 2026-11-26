#!/usr/bin/env node
/**
 * iPhone-width ambient: точки (data-particles) и скан (data-scan) не static.
 * QA_URL=http://127.0.0.1:4173/ node scripts/qa-mobile-ambient.cjs
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const root = process.env.QA_URL || 'http://127.0.0.1:4173/';
const url = new URL('?group=7936a2a43b11b20b01d30f5b00c73166&institute=5b42fa53ec1dd1892e5ec44a3a60a896', root).href;
const viewport = { width: 390, height: 844 };

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    args: ['--disable-gpu'],
  });
  try {
    const page = await browser.newPage({ viewport });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator('.bottom-nav').waitFor({ timeout: 20000 });

    const sample = async () => {
      return page.evaluate(() => {
        const grid = document.querySelector('.ambient-grid');
        if (!grid) return { error: 'no .ambient-grid' };
        const gridStyle = getComputedStyle(grid);
        const dotsStyle = getComputedStyle(grid, '::before');
        const scanStyle = getComputedStyle(grid, '::after');
        const sweepLine = document.querySelector('.light-sweep');
        const lineStyle = sweepLine ? getComputedStyle(sweepLine, '::before') : null;
        return {
          visualQuality: document.documentElement.dataset.visualQuality,
          grid: gridStyle.animationName,
          dots: dotsStyle.animationName,
          scan: scanStyle.animationName,
          scanDisplay: scanStyle.display,
          spectral: lineStyle?.animationName ?? 'n/a',
        };
      });
    };

    const a = await sample();
    await page.waitForTimeout(400);
    const b = await sample();

    assert.notEqual(a.grid, 'none', `grid animation: ${JSON.stringify(a)}`);
    assert.equal(a.dots, 'data-particles', JSON.stringify(a));
    assert.equal(a.scan, 'data-scan', JSON.stringify(a));
    assert.notEqual(a.scanDisplay, 'none', JSON.stringify(a));
    assert.equal(a.spectral, 'spectral-pass', JSON.stringify(a));
    assert.equal(a.grid, b.grid, `grid animation changed unexpectedly: ${JSON.stringify({ a, b })}`);

    console.log(JSON.stringify({ ok: true, viewport, first: a, second: b }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});