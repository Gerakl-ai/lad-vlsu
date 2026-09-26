const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = process.env.QA_URL || "http://127.0.0.1:8789/";
const outputDir = path.resolve("artifacts/qa/2026-09-16-startup");
fs.mkdirSync(outputDir, { recursive: true });

function findChromiumExecutable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH && fs.existsSync(process.env.PLAYWRIGHT_CHROMIUM_PATH)) {
    return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  }

  const playwrightHome = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  if (!fs.existsSync(playwrightHome)) return undefined;

  const candidates = fs.readdirSync(playwrightHome, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^chromium(?:_headless_shell)?-\d+$/.test(entry.name))
    .sort((left, right) => {
      const leftRevision = Number(left.name.match(/(\d+)$/)?.[1] || 0);
      const rightRevision = Number(right.name.match(/(\d+)$/)?.[1] || 0);
      return rightRevision - leftRevision;
    });

  for (const candidate of candidates) {
    const executableNames = candidate.name.startsWith("chromium_headless_shell")
      ? ["chrome-headless-shell.exe"]
      : ["chrome.exe"];
    const queue = [path.join(playwrightHome, candidate.name)];

    while (queue.length) {
      const current = queue.shift();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) queue.push(entryPath);
        if (entry.isFile() && executableNames.includes(entry.name)) return entryPath;
      }
    }
  }

  return undefined;
}

const group = {
  id: "7936a2a43b11b20b01d30f5b00c73166",
  nrec: "7936a2a43b11b20b01d30f5b00c73166",
  name: "ПИ-124",
  instituteId: "5b42fa53ec1dd1892e5ec44a3a60a896",
  instituteName: "Институт информационных технологий и электроники",
  instituteShortName: "ИИТЭ",
  visualKey: "institute-1"
};

(async () => {
  const executablePath = findChromiumExecutable();
  const browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({ viewport: { width: 402, height: 874 } });
  const page = await context.newPage();
  const issues = [];
  const failedResponses = [];
  let offlineMode = false;
  page.on("pageerror", (error) => issues.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  page.on("console", (message) => {
    const text = message.text();
    const expectedOfflineFailure = offlineMode && text.includes("ERR_INTERNET_DISCONNECTED");
    if (["error", "warning"].includes(message.type()) && !expectedOfflineFailure) {
      issues.push(`${message.type()}: ${text}`);
    }
  });

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".phone-frame").waitFor();

    const warmOnline = await page.evaluate(() => ({
      booted: window.__ladBootComplete === true,
      launchVisible: Boolean(document.querySelector(".launch-screen")),
      cacheNames: []
    }));
    warmOnline.cacheNames = await page.evaluate(() => caches.keys());
    const cachedPaths = await page.evaluate(async () => {
      const paths = [];
      for (const name of await caches.keys()) {
        for (const request of await (await caches.open(name)).keys()) paths.push(new URL(request.url).pathname);
      }
      return paths;
    });

    await page.evaluate(({ groupProfile }) => {
      localStorage.setItem("lad.selected-group.v2", JSON.stringify(groupProfile));
      localStorage.setItem(`lad.schedule.v2:${groupProfile.nrec}`, JSON.stringify({
        groupNrec: groupProfile.nrec,
        currentInfo: { currentWeekType: 1 },
        fetchedAt: "broken"
      }));
    }, { groupProfile: group });

    offlineMode = true;
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".phone-frame").waitFor();
    await page.locator(".schedule-unavailable").waitFor();
    await page.screenshot({ path: path.join(outputDir, "offline-corrupt-cache-402x874.png") });

    const offlineRecovery = await page.evaluate(() => {
      const nav = document.querySelector(".bottom-nav")?.getBoundingClientRect();
      return {
        booted: window.__ladBootComplete === true,
        launchVisible: Boolean(document.querySelector(".launch-screen")),
        unavailableVisible: Boolean(document.querySelector(".schedule-unavailable")),
        navGap: nav ? Math.round((innerHeight - nav.bottom) * 10) / 10 : null,
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });

    const expectedDataFailures = failedResponses.filter((response) => /^(?:404|504) \/data\//.test(response));
    const unexpectedResponses = failedResponses.filter((response) => !expectedDataFailures.includes(response));
    const unexpectedIssues = issues.filter((issue) => !issue.startsWith("error: Failed to load resource:"));
    if (issues.length - unexpectedIssues.length !== expectedDataFailures.length + unexpectedResponses.length) {
      unexpectedIssues.push("Unmatched browser resource error");
    }
    const result = {
      warmOnline,
      invalidDoubleAssetPaths: cachedPaths.filter((item) => item.includes("/assets/assets/")),
      offlineRecovery,
      expectedDataFailures,
      unexpectedResponses,
      issues: unexpectedIssues
    };
    fs.writeFileSync(path.join(outputDir, "metrics.json"), `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

    if (!warmOnline.booted || warmOnline.launchVisible) throw new Error("Warm online startup did not finish");
    if (result.invalidDoubleAssetPaths.length) throw new Error("Service worker cached invalid double asset paths");
    if (!offlineRecovery.booted || offlineRecovery.launchVisible || !offlineRecovery.unavailableVisible) {
      throw new Error("Offline recovery from corrupt schedule cache failed");
    }
    if (offlineRecovery.navGap !== 0 || offlineRecovery.horizontalOverflow !== 0) {
      throw new Error("Mobile viewport geometry regressed");
    }
    if (unexpectedResponses.length || unexpectedIssues.length) throw new Error(`Browser issues: ${[...unexpectedResponses, ...unexpectedIssues].join(" | ")}`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
