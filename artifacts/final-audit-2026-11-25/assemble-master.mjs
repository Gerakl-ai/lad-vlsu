import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const uni = JSON.parse(
  fs.readFileSync("D:/UniMate ВлГУ/artifacts/lad-bugs-master.json", "utf8")
);
const auto = JSON.parse(fs.readFileSync(path.join(dir, "lad-bugs-automated.json"), "utf8"));
const covText = fs.readFileSync(path.join(dir, "lad-coverage-scan-output.txt"), "utf8");
const cov = JSON.parse(covText.slice(covText.indexOf("{")));

const lad = [...uni.ladBugs];
const idx = lad.findIndex((b) => b.id === "LAD-023");
if (idx >= 0) {
  lad[idx].detail = `Полный HEAD-скан coverage.keys: ${cov.ok}/${cov.total}, miss404=${cov.miss404}`;
  lad[idx].evidence = "lad-coverage-scan.mjs, финальный прогон 25.11.2026";
}
const visBugs = [
  {
    id: "LAD-VIS-01",
    sev: "High",
    area: "Layout",
    title: "Desktop «Сегодня»: правая колонка длиннее левой (detail vs summary)",
    detail:
      "На 1280–1920 px колонка .today-detail-scroll уходит ниже .today-day-summary на ~150 px (overflow: visible). qa-desktop-layout падает на laptop viewports.",
    repro: "pnpm preview → ПИ-124 → Сегодня; measure-viewport-layout.mjs",
    expected: "Синхронная высота колонок или scroll только внутри detail",
    evidence: "measure-viewport-layout 25.11",
    fixability: "code-local",
  },
  {
    id: "LAD-VIS-02",
    sev: "Medium",
    area: "Layout",
    title: "«Неделя»: .week-overview шире viewport (обрезка справа)",
    detail: "На 1280–2560 right края 1313–2584 при innerWidth меньше на ~24–33 px.",
    repro: "Вкладка Неделя, 1366×768 / 1440×900",
    expected: "max-width: 100% внутри content-scroll",
    evidence: "measure-viewport-layout прод",
    fixability: "code-local",
  },
  {
    id: "LAD-VIS-03",
    sev: "High",
    area: "QA",
    title: "Регрессия laptop: полный qa-desktop-layout не проходит",
    detail: "6 типовых laptop viewport — fail по геометрии today-primary.",
    repro: "QA_URL=http://127.0.0.1:4173/ node scripts/qa-desktop-layout.cjs",
    expected: "Pass на 1024–1920",
    evidence: "25.11.2026",
    fixability: "code-local",
  },
];

for (const b of visBugs) lad.push(b);

lad.push({
  id: "LAD-024",
  sev: "Critical",
  area: "Deploy",
  title: "На проде нет прокси, хотя в репозитории он реализован",
  detail:
    "functions/vlsu-api/[[path]].ts и vite proxy отдают JSON на http://127.0.0.1:4173/vlsu-api/catalogs/GetInstitutes; germanpolkin.ru/vlsu-api → 404 HTML. GitHub Pages не разворачивает functions/.",
  repro: "Сравнить preview 4173 и germanpolkin.ru",
  expected: "CF Pages Functions / wrangler assets с run_worker_first",
  evidence: "curl 25.11.2026 финальный",
});

const repoBugs = [
  {
    id: "REP-001",
    sev: "Info",
    area: "CI",
    title: "Vitest: 583 теста в 67 файлах — все пройдены",
    detail: "pnpm run test (vitest run)",
    evidence: "25.11.2026",
  },
  {
    id: "REP-002",
    sev: "Info",
    area: "Build",
    title: "Production build успешен",
    detail: "tsc --noEmit + vite build; local lad-release 202611251337, прод 9859da8",
    evidence: "vite build log",
  },
  {
    id: "REP-003",
    sev: "Medium",
    area: "QA",
    title: "Playwright падает при длинных прогонах (Edge headless)",
    detail: "group-startup / study-periods: Target crashed, exit 3221225477",
    repro: "node scripts/qa-group-startup.cjs без фильтра viewport",
    expected: "Стабильный прогон в CI (ubuntu-latest)",
    evidence: "25.11.2026 Windows",
  },
  {
    id: "REP-004",
    sev: "Low",
    area: "CI",
    title: "pnpm run check: сбой vite build в цепочке на Windows",
    detail: "После vitest exit -1073741819; отдельный pnpm run build — OK",
    evidence: "25.11.2026",
  },
];

const master = {
  meta: {
    productUrl: "https://germanpolkin.ru/lad-vlsu/",
    release: "9859da8",
    localBuildRelease: "202611251337",
    repoCommit: "9859da820",
    auditedAt: "2026-11-25",
    workspaceNote:
      "Исходный репозиторий Лад ВлГУ (plugin-browser-openai-bundled-build-web): React/TS, PWA, public/data, snapshot pipeline, functions/vlsu-api, Cloudflare Worker. Прототип UniMate (D:\\UniMate ВлГУ) — отдельный проект.",
    testResults: {
      vitest: "583/583 Pass",
      swSyntax: "Pass",
      coverageScan: `${cov.ok}/${cov.total} schedule HTTP 200`,
      qaLessonSelection: "Pass",
      qaUniversityCacheRace: "Pass",
      qaStudyPeriods: "Partial (1 кейс, crash)",
      qaGroupStartup: "Partial (crash mid-run)",
      qaDesktopLayout: "Pass (390×844); Fail laptop full suite",
      qaFullDesktopLayout: "Fail 1024–1920 (LAD-VIS-01/03)",
      measureViewports: "measure-viewport-layout.mjs 7 sizes × today/week",
      prodHttpAutomated: `${auto.stats.bugCount} findings`,
      localVlsuApiProxy: "Pass (JSON institutes на :4173)",
    },
  },
  summary: {
    ladTotal: lad.length,
    repoTotal: repoBugs.length,
    critical: lad.filter((b) => b.sev === "Critical").length,
    high: lad.filter((b) => b.sev === "High").length,
  },
  ladBugs: lad,
  repoBugs,
};

fs.writeFileSync(path.join(dir, "lad-bugs-master.json"), JSON.stringify(master, null, 2), "utf8");
console.log(master.summary);