/**
 * Замеры overflow и геометрии Today/Week на preview или прод.
 * QA_URL=http://127.0.0.1:4173/ node measure-viewport-layout.mjs
 */
import { chromium } from "playwright";

const base =
  process.env.QA_URL ||
  "https://germanpolkin.ru/lad-vlsu/?group=7936a2a43b11b20b01d30f5b00c73166&institute=5b42fa53ec1dd1892e5ec44a3a60a896";

const viewports = [
  [1024, 768],
  [1280, 800],
  [1366, 768],
  [1440, 900],
  [1536, 864, 1.25],
  [1920, 1080],
  [2560, 1440],
];

const launchOpts = process.env.PLAYWRIGHT_CHROMIUM_PATH
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH, headless: true }
  : { headless: true };
const browser = await chromium.launch(launchOpts);
const page = await browser.newPage();
const issues = [];

for (const [w, h, dpr = 1] of viewports) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1200);

  for (const tab of ["today", "week"]) {
    if (tab === "week") {
      await page.getByRole("button", { name: "Неделя", exact: true }).click();
      await page.waitForTimeout(400);
    }

    const m = await page.evaluate(() => {
      const overflow = document.documentElement.scrollWidth > innerWidth + 1;
      const offenders = [...document.querySelectorAll("body *")]
        .filter((el) => {
          if (el.closest(".motion-scene, .light-sweep, .ambient-grid")) return false;
          if (el.closest('[aria-hidden="true"]')) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (r.right > innerWidth + 2 || r.left < -2);
        })
        .slice(0, 8)
        .map((el) => {
          const r = el.getBoundingClientRect();
          const cls = (el.className || "").toString().slice(0, 50);
          return { tag: el.tagName, cls, left: Math.round(r.left), right: Math.round(r.right) };
        });

      const rect = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) };
      };

      const hero = rect(".today-primary > .hero-card");
      const summary = rect(".today-day-summary");
      const detail = rect(".today-detail-scroll");
      let todayGap = null;
      if (summary && detail) todayGap = summary.bottom - detail.bottom;

      const week = rect(".desktop-week-calendar, .week-view");
      const weekHeads = document.querySelectorAll(".desktop-week-day-head, .week-day-header").length;

      return {
        overflow,
        scrollW: document.documentElement.scrollWidth,
        innerW: innerWidth,
        offenders,
        todayGap,
        hero,
        summary,
        detail,
        weekHeads,
        week,
      };
    });

    if (m.overflow) {
      issues.push({ vp: `${w}x${h}`, tab, type: "horizontal-overflow", scrollW: m.scrollW, innerW: m.innerW });
    }
    if (m.offenders.length) {
      issues.push({ vp: `${w}x${h}`, tab, type: "off-screen-elements", offenders: m.offenders });
    }
    if (tab === "today" && m.todayGap != null && (m.todayGap < -120 || m.todayGap > 120)) {
      issues.push({
        vp: `${w}x${h}`,
        tab,
        type: "today-summary-detail-gap",
        gap: Math.round(m.todayGap),
        geo: { hero: m.hero, summary: m.summary, detail: m.detail },
      });
    }
    if (tab === "week" && w >= 960 && m.weekHeads === 0 && w >= 1280) {
      issues.push({ vp: `${w}x${h}`, tab, type: "desktop-week-missing" });
    }

    console.log(JSON.stringify({ vp: `${w}x${h}@${dpr}`, tab, overflow: m.overflow, todayGap: m.todayGap, weekHeads: m.weekHeads, offenders: m.offenders.length }));
  }
}

await browser.close();
console.log("\n--- ISSUES ---\n", JSON.stringify(issues, null, 2));
process.exit(issues.length ? 1 : 0);