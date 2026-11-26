const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

const root = process.env.QA_URL || 'http://127.0.0.1:4173/';
const url = new URL('?group=7936a2a43b11b20b01d30f5b00c73166&institute=5b42fa53ec1dd1892e5ec44a3a60a896', root).href;
const tabs = ['Сегодня', 'Неделя', 'Записи', 'Настройки'];

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    args: ['--disable-gpu']
  });
  fs.mkdirSync('artifacts/qa/low-end', { recursive: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 2 });
      Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: 2 });
      Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } });
      window.__tabMotionHistory = [];
      const nativeAnimate = Element.prototype.animate;
      Element.prototype.animate = function (keyframes, options) {
        const animation = nativeAnimate.call(this, keyframes, options);
        queueMicrotask(() => {
          if (animation.id?.startsWith('tab-view-enter-')) {
            const selector = this.classList.contains('notes-loading') ? '.notes-loading' : this.matches('.notes-view') ? '.notes-view' : '.view-stack';
            window.__tabMotionHistory.push({ selector, duration: animation.effect.getTiming().duration, keyframes: animation.effect.getKeyframes() });
          }
        });
        return animation;
      };
    });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator('.bottom-nav').waitFor();
    await page.waitForFunction(() => document.documentElement.dataset.visualQuality === 'lite');

    const qualityState = await page.evaluate(() => ({
      deviceMemory: navigator.deviceMemory,
      hardwareConcurrency: navigator.hardwareConcurrency,
      visualQuality: document.documentElement.dataset.visualQuality,
      ambientDisplay: getComputedStyle(document.querySelector('.motion-scene')).display,
      backgroundAnimation: getComputedStyle(document.querySelector('.ambient-grid')).animationName,
      navigationBlur: getComputedStyle(document.querySelector('.bottom-nav')).backdropFilter
    }));
    assert.equal(qualityState.deviceMemory, 2);
    assert.equal(qualityState.hardwareConcurrency, 2);
    assert.equal(qualityState.visualQuality, 'lite');
    assert.equal(qualityState.ambientDisplay, 'none');
    assert.equal(qualityState.backgroundAnimation, 'none');
    assert.equal(qualityState.navigationBlur, 'none');

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    for (const [index, tab] of tabs.entries()) {
      await page.locator('.bottom-nav').getByRole('button', { name: tab }).click();
      await page.waitForFunction((expected) => document.querySelector('.content-scroll')?.getAttribute('data-active-tab') === expected,
        ['today', 'week', 'notes', 'settings'][index]);
      const layout = await page.evaluate(() => {
        const scroller = document.querySelector('.content-scroll');
        const view = scroller.querySelector(':scope > .view-stack, :scope > .notes-loading');
        const continuousAnimations = [];
        for (const element of document.querySelectorAll('.phone-frame, .phone-frame *')) {
          for (const pseudo of [null, '::before', '::after']) {
            const style = getComputedStyle(element, pseudo);
            if (style.animationName !== 'none' && style.animationIterationCount.split(',').some((count) => count.trim() === 'infinite')) {
              continuousAnimations.push({
                selector: `${element.tagName.toLowerCase()}${element.className?.baseVal || element.className ? `.${String(element.className.baseVal || element.className).trim().replace(/\s+/g, '.')}` : ''}${pseudo || ''}`,
                animation: style.animationName
              });
            }
          }
        }
        return {
          activeTab: scroller.dataset.activeTab,
          viewportWidth: document.documentElement.clientWidth,
          documentWidth: document.documentElement.scrollWidth,
          contentWidth: scroller.clientWidth,
          contentScrollWidth: scroller.scrollWidth,
          viewWidth: view?.getBoundingClientRect().width,
          continuousAnimations
        };
      });
      assert.equal(layout.documentWidth, layout.viewportWidth, `${tab} document overflowed horizontally: ${JSON.stringify(layout)}`);
      assert.ok(layout.contentScrollWidth <= layout.contentWidth + 1, `${tab} content overflowed horizontally: ${JSON.stringify(layout)}`);
      const heroPhotoAnimations = new Set([
        'visual-drift',
        'visual-drift-lite',
        'visual-drift-mobile',
        'landscape-backdrop-breathe',
        'landscape-visual-breathe',
      ]);
      const allowedLiteAmbient = new Set([
        'ambient-shift',
        'data-scan-mobile',
        'spectral-pass-mobile',
        'data-particles',
        'grid-travel',
        'grid-travel-mobile',
      ]);
      const decorativeInfinite = layout.continuousAnimations.filter((entry) => {
        if (allowedLiteAmbient.has(entry.animation) && /\.(light-sweep|ambient-grid)/i.test(entry.selector)) return false;
        if (!heroPhotoAnimations.has(entry.animation)) return true;
        return !/hero-visual/i.test(entry.selector);
      });
      assert.deepEqual(
        decorativeInfinite,
        [],
        `${tab} retained decorative infinite animations in lite mode: ${JSON.stringify({ decorativeInfinite, all: layout.continuousAnimations })}`,
      );
      if (tab === 'Записи') {
        const noteMotion = await page.evaluate(() => [...window.__tabMotionHistory].reverse().find((entry) => entry.selector === '.notes-view'));
        assert.equal(noteMotion?.duration, 300, `Notes should use the lightweight shared transition: ${JSON.stringify(noteMotion)}`);
      }
      await page.screenshot({ path: `artifacts/qa/low-end/1366-${tab}.png` });
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.bottom-nav').getByRole('button', { name: 'Сегодня' }).click();
    await page.waitForFunction(() => document.querySelector('.content-scroll')?.dataset.activeTab === 'today');
    const reducedMotion = await page.evaluate(() => [...window.__tabMotionHistory].at(-1));
    assert.equal(reducedMotion?.duration, 100, `Reduced-motion navigation should use a short fade: ${JSON.stringify(reducedMotion)}`);
    assert.ok(reducedMotion?.keyframes.every((keyframe) => !('transform' in keyframe)), `Reduced-motion navigation should not translate the page: ${JSON.stringify(reducedMotion)}`);
    assert.deepEqual(errors, [], `Browser errors under software rendering: ${errors.join('\n')}`);
    console.log(JSON.stringify({ profile: 'software-rendering + 4x CPU + 2 cores + 2 GB', qualityState, tabs, reducedMotion, errors }));

    let releaseChunk;
    let chunkRequestObserved = false;
    const chunkGate = new Promise((resolve) => { releaseChunk = resolve; });
    const coldContext = await browser.newContext({
      viewport: { width: 402, height: 874 },
      serviceWorkers: 'block'
    });
    const coldPage = await coldContext.newPage();
    coldPage.on('pageerror', (error) => errors.push(error.message));
    const coldCdp = await coldPage.context().newCDPSession(coldPage);
    await coldCdp.send('Network.enable');
    await coldCdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await coldPage.addInitScript(() => {
      Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 2 });
      Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: 2 });
      Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } });
      window.__tabMotionHistory = [];
      const nativeAnimate = Element.prototype.animate;
      Element.prototype.animate = function (keyframes, options) {
        const animation = nativeAnimate.call(this, keyframes, options);
        queueMicrotask(() => window.__tabMotionHistory.push({ selector: this.classList.contains('notes-loading') ? '.notes-loading' : '.view-stack', duration: animation.effect.getTiming().duration }));
        return animation;
      };
    });
    await coldPage.route(/NotesView-[^/]+\.js(?:\?.*)?$/, async (route) => {
      chunkRequestObserved = true;
      await chunkGate;
      await route.continue();
    });
    try {
      await coldPage.goto(url, { waitUntil: 'domcontentloaded' });
      await coldPage.locator('.bottom-nav').waitFor();
      await coldPage.locator('.bottom-nav').getByRole('button', { name: 'Записи' }).click();
      if (!chunkRequestObserved) await coldPage.waitForRequest(/NotesView-[^/]+\.js(?:\?.*)?$/, { timeout: 2000 });
      assert.equal(chunkRequestObserved, true, 'The cold Notes chunk request should be intercepted');
      await coldPage.waitForFunction(() => document.querySelector('.content-scroll')?.dataset.activeTab === 'notes');
      assert.equal(await coldPage.locator('.notes-chunk-loading').isVisible(), true);
      const loadingSurface = await coldPage.locator('.notes-chunk-loading').evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          border: style.borderTopWidth,
          background: style.backgroundColor,
          shadow: style.boxShadow,
          width: element.getBoundingClientRect().width,
          viewportWidth: document.documentElement.clientWidth
        };
      });
      assert.equal(loadingSurface.border, '0px', JSON.stringify(loadingSurface));
      assert.equal(loadingSurface.background, 'rgba(0, 0, 0, 0)', JSON.stringify(loadingSurface));
      assert.equal(loadingSurface.shadow, 'none', JSON.stringify(loadingSurface));
      assert.ok(loadingSurface.width <= loadingSurface.viewportWidth, JSON.stringify(loadingSurface));
      const coldTransition = await coldPage.evaluate(() => [...window.__tabMotionHistory].at(-1));
      assert.equal(coldTransition?.duration, 300, `Cold Notes navigation should animate before its module arrives: ${JSON.stringify(coldTransition)}`);
      await coldPage.screenshot({ path: 'artifacts/qa/low-end/402-notes-module-loading.png' });
      releaseChunk();
      await coldPage.locator('.notes-view').waitFor();
      await coldPage.screenshot({ path: 'artifacts/qa/low-end/402-notes-cold-open.png' });
    } finally {
      releaseChunk();
      await coldContext.close();
    }
    assert.deepEqual(errors, [], `Browser errors while delaying the Notes module: ${errors.join('\n')}`);
    console.log(JSON.stringify({ coldNotes: 'tab transition begins while module is still loading', errors }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
