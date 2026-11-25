/**
 * Автоматическая разведка продакшена Лад ВлГУ
 * Запуск: node artifacts/final-audit-2026-11-25/lad-full-bug-audit.mjs
 */
const BASE = "https://germanpolkin.ru/lad-vlsu";
const bugs = [];

function bug(id, sev, cat, title, detail, repro = "", expected = "") {
  bugs.push({ id, sev, cat, title, detail, repro, expected });
}

async function fetchText(url, opts = {}) {
  const t0 = Date.now();
  const r = await fetch(url, { ...opts, redirect: "follow" });
  const text = await r.text();
  return { r, text, ms: Date.now() - t0, url };
}

async function fetchJson(url) {
  const { r, text, ms, url: u } = await fetchText(url);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* */
  }
  return { r, json, text, ms, url: u };
}

async function head(url) {
  const t0 = Date.now();
  const r = await fetch(url, { method: "HEAD", redirect: "follow" });
  return { r, ms: Date.now() - t0, url };
}

async function main() {
  const index = await fetchText(`${BASE}/`);
  if (!index.r.ok) bug("INF-01", "Critical", "Infra", "Главная недоступна", `HTTP ${index.r.status}`);

  const release = index.text.match(/lad-release" content="([^"]+)"/)?.[1];
  const jsMatch = index.text.match(/src="(\/lad-vlsu\/assets\/[^"]+\.js)"/);
  const cssMatch = index.text.match(/href="(\/lad-vlsu\/assets\/[^"]+\.css)"/);

  const catalog = await fetchJson(`${BASE}/data/catalog.json`);
  const coverage = await fetchJson(`${BASE}/data/coverage.json`);
  const quality = await fetchJson(`${BASE}/data/quality.json`);

  const proxy = await fetchText("https://germanpolkin.ru/vlsu-api/catalogs/GetInstitutes");
  if (!proxy.r.ok || proxy.text.trimStart().startsWith("<!")) {
    bug(
      "API-01",
      "Critical",
      "Backend",
      "Прокси /vlsu-api отдаёт не-JSON",
      `HTTP ${proxy.r.status}, content-type: ${proxy.r.headers.get("content-type")}, начало: ${proxy.text.slice(0, 80)}`,
      "fetch('/vlsu-api/catalogs/GetInstitutes') со страницы приложения",
      "200 application/json"
    );
  }

  const appApi = await head("https://germanpolkin.ru/app-api/health");
  if (!appApi.r.ok) {
    bug(
      "API-02",
      "High",
      "Backend",
      "/app-api на germanpolkin.ru недоступен",
      `HEAD /app-api/health → HTTP ${appApi.r.status}`,
      "curl https://germanpolkin.ru/app-api/health",
      "200 (Pages Function или Worker на том же origin)"
    );
  }

  if (coverage.json?.groups) {
    const available = Object.entries(coverage.json.groups).filter(([, v]) => v?.available);
    const sample = available.slice(0, 40);
    const missing = [];
    const badJson = [];
    for (const [id] of sample) {
      const sch = await head(`${BASE}/data/schedule/${id}.json`);
      if (sch.r.status === 404) missing.push(id);
      if (sch.r.status === 200) {
        const body = await fetchJson(`${BASE}/data/schedule/${id}.json`);
        if (!body.json?.schedule?.length) badJson.push(id);
      }
    }
    if (missing.length) {
      bug(
        "DATA-01",
        "High",
        "Data",
        "coverage помечает группу available, файла schedule нет",
        `Из выборки 40: ${missing.length} с 404: ${missing.slice(0, 5).join(", ")}`,
        "Сравнить coverage.json и HEAD schedule/{id}.json"
      );
    }
    if (badJson.length) {
      bug(
        "DATA-02",
        "Medium",
        "Data",
        "Пустой schedule в JSON при 200",
        `ids: ${badJson.slice(0, 5).join(", ")}`
      );
    }
  }

  if (quality.json?.missing && quality.json.missing > 0) {
    bug(
      "DATA-04",
      "Low",
      "Data",
      `В quality.json ${quality.json.missing} групп без приемлемого снимка`,
      `preliminary: ${quality.json.preliminary}, missing: ${quality.json.missing}`,
      "",
      "UI предупреждает покрытие"
    );
  }

  const sw = await fetchText(`${BASE}/sw.js?release=${release || "x"}`);
  const embedded = [...sw.text.matchAll(/"assets\/[^"]+"/g)].map((m) => m[0].slice(1, -1));
  for (const asset of embedded) {
    const h = await head(`${BASE}/${asset}`);
    if (!h.r.ok) {
      bug("PWA-01", "High", "PWA", `SW кэширует отсутствующий chunk`, `${asset} → HTTP ${h.r.status}`);
    }
  }

  if (jsMatch && cssMatch) {
    for (const m of [jsMatch[1], cssMatch[1]]) {
      const url = m.startsWith("http") ? m : `https://germanpolkin.ru${m}`;
      const h = await head(url);
      if (!h.r.ok) bug("INF-02", "Critical", "Infra", "Бандл из index.html недоступен", url);
    }
  }

  if (/user-scalable=no|maximum-scale=1\.0/.test(index.text)) {
    bug(
      "A11Y-01",
      "Medium",
      "A11y",
      "Отключено масштабирование страницы",
      "meta viewport: maximum-scale=1.0, user-scalable=no",
      "Попытка pinch-zoom на мобильном",
      "Разрешён zoom для слабовидящих"
    );
  }

  const sec = await fetch(`${BASE}/`, { method: "GET" });
  for (const h of ["content-security-policy", "strict-transport-security", "x-frame-options"]) {
    if (!sec.headers.get(h)) {
      bug(
        "SEC-01",
        "Low",
        "Security",
        `Нет заголовка ${h}`,
        "Типично для GitHub Pages, повышает риск clickjacking/XSS без CSP"
      );
      break;
    }
  }

  const uni = await head(`${BASE}/data/university-schedule.json`);
  const len = uni.r.headers.get("content-length");
  if (len && Number(len) > 2_500_000) {
    bug(
      "PERF-01",
      "Medium",
      "Performance",
      "Сводный JSON > 2.5 MB",
      `content-length: ${len}, ~${(Number(len) / 1e6).toFixed(2)} MB`,
      "Первый запуск / обновление кэша",
      "Ленивая загрузка по группам"
    );
  }

  const out = {
    auditedAt: new Date().toISOString(),
    release,
    stats: {
      institutes: catalog.json?.institutes?.length,
      coverageGroups: coverage.json?.groups ? Object.keys(coverage.json.groups).length : 0,
      bugCount: bugs.length,
    },
    bugs,
  };

  const fs = await import("fs");
  const path = await import("path");
  const { fileURLToPath } = await import("url");
  const dir = path.dirname(fileURLToPath(import.meta.url));
  fs.writeFileSync(path.join(dir, "lad-bugs-automated.json"), JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});