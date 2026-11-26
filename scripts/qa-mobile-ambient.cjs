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
          gridPos: gridStyle.backgroundPosition,
          gridDur: gridStyle.animationDuration,
          dots: dotsStyle.animationName,
          scan: scanStyle.animationName,
          scanDur: scanStyle.animationDuration,
          scanDisplay: scanStyle.display,
          scanTr: scanStyle.transform,
          spectral: lineStyle?.animationName ?? 'n/a',
          spectralDur: lineStyle?.animationDuration ?? 'n/a',
          spectralTr: lineStyle?.transform ?? 'n/a',
        };
      });
    };

    const a = await sample();
    await page.waitForTimeout(900);
    const b = await sample();

    assert.notEqual(a.grid, 'none', `grid animation: ${JSON.stringify(a)}`);
    assert.ok(['grid-travel', 'grid-travel-mobile'].includes(a.grid), JSON.stringify(a));
    assert.ok(a.dots === 'data-particles' || a.dots === 'none', JSON.stringify(a));
    assert.ok(['data-scan', 'data-scan-mobile'].includes(a.scan), JSON.stringify(a));
    assert.notEqual(a.scanDisplay, 'none', JSON.stringify(a));
    assert.ok(['spectral-pass', 'spectral-pass-mobile'].includes(a.spectral), JSON.stringify(a));
    const durScan = parseFloat(a.scanDur);
    const durGrid = parseFloat(a.gridDur);
    const durSpectral = parseFloat(a.spectralDur);
    assert.ok(durScan > 0 && durScan <= 14, `scan too slow: ${a.scanDur}`);
    assert.ok(durGrid > 0 && durGrid <= 24, `grid too slow: ${a.gridDur}`);
    assert.ok(durSpectral > 0 && durSpectral <= 18, `spectral too slow: ${a.spectralDur}`);
    assert.notEqual(a.gridPos, b.gridPos, `grid background static: ${JSON.stringify({ a, b })}`);
    assert.notEqual(a.scanTr, b.scanTr, `scan transform static: ${JSON.stringify({ a, b })}`);

    console.log(JSON.stringify({ ok: true, viewport, first: a, second: b }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});