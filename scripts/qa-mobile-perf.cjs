#!/usr/bin/env node
/**
 * Телефон: бюджет бесконечных CSS-анимаций и грубый rAF-замер кадра.
 * QA_URL=http://127.0.0.1:4173/ node scripts/qa-mobile-perf.cjs
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const root = process.env.QA_URL || 'http://127.0.0.1:4173/';
const url = new URL('?group=7936a2a43b11b20b01d30f5b00c73166&institute=5b42fa53ec1dd1892e5ec44a3a60a896', root).href;
const viewport = { width: 390, height: 844 };
const MAX_DECORATIVE_INFINITE = 10;
const IGNORE_ANIMATIONS = new Set(['spin', 'shimmer', 'pulse']);
const P95_FRAME_MS = 26;
const MAX_SINGLE_FRAME_MS = 120;

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    args: ['--disable-gpu'],
  });
  try {
    const page = await browser.newPage({ viewport });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator('.bottom-nav').waitFor({ timeout: 20000 });
    await page.locator('.topbar h1').filter({ hasNotText: 'Выберите' }).waitFor({ timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('.skeleton-line'));

    const layout = await page.evaluate(() => {
      const skip = new Set(['spin', 'shimmer', 'pulse']);
      const continuous = [];
      for (const element of document.querySelectorAll('.phone-frame, .phone-frame *')) {
        for (const pseudo of [null, '::before', '::after']) {
          const style = getComputedStyle(element, pseudo);
          if (style.animationName === 'none') continue;
          if (skip.has(style.animationName)) continue;
          const counts = style.animationIterationCount.split(',').map((v) => v.trim());
          if (!counts.some((c) => c === 'infinite')) continue;
          const cls = element.className?.baseVal || element.className;
          const tag = element.tagName.toLowerCase();
          continuous.push({
            animation: style.animationName,
            selector: `${tag}${cls ? `.${String(cls).trim().replace(/\s+/g, '.')}` : ''}${pseudo || ''}`,
          });
        }
      }
      const ambient = document.querySelector('.ambient-grid');
      const sweep = document.querySelector('.light-sweep');
      const nav = document.querySelector('.bottom-nav');
      return {
        visualQuality: document.documentElement.dataset.visualQuality,
        motionScene: getComputedStyle(document.querySelector('.motion-scene')).display,
        infiniteCount: continuous.length,
        continuous,
        gridAnim: ambient ? getComputedStyle(ambient).animationName : 'n/a',
        scanAnim: ambient ? getComputedStyle(ambient, '::after').animationName : 'n/a',
        stripeAnim: sweep ? getComputedStyle(sweep, '::before').animationName : 'n/a',
        navBlur: nav ? getComputedStyle(nav).backdropFilter : 'n/a',
      };
    });

    assert.equal(layout.motionScene, 'none', JSON.stringify(layout));
    assert.ok(['grid-travel', 'grid-travel-mobile'].includes(layout.gridAnim), JSON.stringify(layout));
    assert.ok(['data-scan', 'data-scan-mobile'].includes(layout.scanAnim), JSON.stringify(layout));
    assert.ok(['spectral-pass', 'spectral-pass-mobile'].includes(layout.stripeAnim), JSON.stringify(layout));
    assert.ok(layout.navBlur === 'none' || layout.navBlur === '', JSON.stringify(layout));
    assert.ok(layout.infiniteCount <= MAX_DECORATIVE_INFINITE, JSON.stringify(layout));

    const rafSample = await page.evaluate(async () => {
      const intervals = [];
      let prev = 0;
      let frames = 0;
      await new Promise((resolve) => {
        const tick = (t) => {
          if (prev) intervals.push(t - prev);
          prev = t;
          frames += 1;
          if (frames < 90) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      const sorted = [...intervals].sort((a, b) => a - b);
      const max = sorted.at(-1) ?? 0;
      const p95 = sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * 0.95))] ?? 0;
      return { samples: intervals.length, p95, max, median: sorted[Math.floor(sorted.length / 2)] ?? 0 };
    });

    assert.ok(rafSample.p95 <= P95_FRAME_MS, JSON.stringify({ rafSample, layout }));
    assert.ok(rafSample.max <= MAX_SINGLE_FRAME_MS, JSON.stringify({ rafSample, layout }));

    await page.locator('.bottom-nav').getByRole('button', { name: 'Неделя' }).click();
    await page.waitForFunction(() => document.querySelector('.content-scroll')?.dataset.activeTab === 'week');
    const weekOverflow = await page.evaluate(() => ({
      vw: document.documentElement.clientWidth,
      sw: document.documentElement.scrollWidth,
    }));
    assert.equal(weekOverflow.sw, weekOverflow.vw, JSON.stringify(weekOverflow));

    console.log(JSON.stringify({
      ok: true,
      viewport,
      throttling: '4x CPU',
      layout,
      rafSample,
    }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});