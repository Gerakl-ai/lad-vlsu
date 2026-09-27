/**
 * Сборка статических снимков расписания ВлГУ.
 *
 * Зачем это нужно: API ВлГУ запрещает чтение с чужого домена (CORS), поэтому
 * статический фронтенд не может ходить в него из браузера. GitHub Actions —
 * сервер, на него CORS не распространяется: он обходит API заранее и кладёт
 * результат в репозиторий обычными файлами.
 *
 * Два правила, на которых держится вся надёжность:
 *  1. Плохой ответ никогда не перезаписывает хороший снимок. Сбой уходит в
 *     status.json, а на диске остаётся последнее валидное расписание.
 *  2. Хэш считается только по стабильной части (семестр + расписание). Из него
 *     исключены «текущая пара» и метки времени, иначе git видел бы изменение во
 *     всех группах при каждом запуске, а не реальную правку расписания.
 *
 * Использование:
 *   node scripts/snapshot/buildSnapshot.mjs [опции]
 *     --out <dir>          куда писать (по умолчанию data)
 *     --institutes <n>     ограничить число институтов (для проверки)
 *     --groups <n>         ограничить число групп на институт (для проверки)
 *     --concurrency <n>    параллельных запросов (по умолчанию 3)
 *     --delay <ms>         пауза между запросами (по умолчанию 200)
 *     --catalog-only       собрать только каталог, без расписаний
 *     --dry-run            ничего не записывать на диск
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  STUDY_FORMS,
  UpstreamError,
  fetchGroupCurrentInfo,
  fetchGroupSchedule,
  fetchGroups,
  fetchInstitutes,
  runPolitely
} from "./vlsuClient.mjs";

export const SNAPSHOT_SCHEMA_VERSION = 3;

/* ------------------------------------------------------------------ *
 * Аргументы
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const args = {
    out: "data",
    institutes: Infinity,
    groups: Infinity,
    concurrency: 3,
    delay: 200,
    catalogOnly: false,
    dryRun: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case "--out": args.out = value; index += 1; break;
      case "--institutes": args.institutes = Number(value); index += 1; break;
      case "--groups": args.groups = Number(value); index += 1; break;
      case "--concurrency": args.concurrency = Number(value); index += 1; break;
      case "--delay": args.delay = Number(value); index += 1; break;
      case "--catalog-only": args.catalogOnly = true; break;
      case "--dry-run": args.dryRun = true; break;
      default: break;
    }
  }
  return args;
}

/* ------------------------------------------------------------------ *
 * Детерминированная запись
 * ------------------------------------------------------------------ */

/** Ключи всегда в одном порядке: иначе git показывал бы ложные изменения. */
export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  const body = keys
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",");
  return `{${body}}`;
}

export function sha256(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function validDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Пишет файл только если содержимое изменилось — коммит отражает реальную правку. */
async function writeIfChanged(filePath, contents, { dryRun }) {
  let previous = null;
  try {
    previous = await readFile(filePath, "utf8");
  } catch {
    previous = null;
  }
  if (previous === contents) return "unchanged";
  if (dryRun) return previous === null ? "would-create" : "would-update";
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
  return previous === null ? "created" : "updated";
}

function toJsonFile(value) {
  return `${JSON.stringify(JSON.parse(stableStringify(value)), null, 2)}\n`;
}

export async function collectCoverage(outDir, catalog) {
  const knownGroups = new Set(catalog.flatMap((institute) => institute.groups.map((group) => group.nrec)));
  const directory = path.join(outDir, "schedule");
  const files = await readdir(directory).catch(() => []);
  const groups = {};

  for (const file of files) {
    const match = /^([a-f\d]{32})\.json$/i.exec(file);
    if (!match || !knownGroups.has(match[1])) continue;
    try {
      const snapshot = JSON.parse(await readFile(path.join(directory, file), "utf8"));
      if (snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION
        || snapshot.group?.nrec !== match[1]
        || !scheduleQuality(snapshot.schedule)
        || snapshot.scheduleHash !== sha256({ semester: snapshot.semester, schedule: snapshot.schedule })
        || ((snapshot.validFrom !== undefined || snapshot.validThrough !== undefined)
          && (!validDateKey(snapshot.validFrom) || !validDateKey(snapshot.validThrough)
            || snapshot.validFrom > snapshot.validThrough))
        || !Number.isFinite(Date.parse(snapshot.capturedAt))) continue;
      groups[match[1]] = {
        capturedAt: snapshot.capturedAt,
        semester: snapshot.semester,
        scheduleHash: snapshot.scheduleHash,
        ...(snapshot.validFrom && snapshot.validThrough
          ? { validFrom: snapshot.validFrom, validThrough: snapshot.validThrough }
          : {})
      };
    } catch {
      // A corrupt file must not be advertised as available.
    }
  }

  return { schemaVersion: 1, checkedAt: new Date().toISOString(), catalogGroups: knownGroups.size, available: Object.keys(groups).length, groups };
}

/* ------------------------------------------------------------------ *
 * Валидация расписания
 * ------------------------------------------------------------------ */

/**
 * Повторяет проверку качества из Worker: массив должен состоять только из
 * известных типов записей, иначе это не расписание, а мусор.
 */
export function scheduleQuality(schedule) {
  if (!Array.isArray(schedule) || schedule.length === 0) return null;

  const isDay = (item) =>
    item && typeof item === "object" && item.type === "Lessons" && typeof item.name === "string";
  const isExam = (item) =>
    item && typeof item === "object" && item.type === "ExamSession" && typeof item.name === "string";

  const lessonDays = schedule.filter(isDay).length;
  const examEntries = schedule.filter(isExam).length;
  if (lessonDays + examEntries !== schedule.length) return null;

  const warnings = [];
  const hasAnyLesson = schedule.some(
    (item) =>
      isDay(item) &&
      Array.from({ length: 8 }, (_, i) => i + 1).some(
        (pair) => String(item[`n${pair}`] ?? "").trim() || String(item[`z${pair}`] ?? "").trim()
      )
  );
  // An all-blank timetable is indistinguishable from an upstream outage.
  // A genuine exam-only response remains useful even without weekly lessons.
  if (lessonDays > 0 && !hasAnyLesson && examEntries === 0) return null;

  return { valid: true, scheduleEntries: schedule.length, lessonDays, examEntries, warnings };
}

export function isEmptyScheduleResponse(error) {
  return error instanceof UpstreamError
    && error.status === 200
    && error.path === "/student/GetGroupSchedule"
    && error.message.includes("пустой ответ");
}

function probeGroupsFromDifferentInstitutes(catalog) {
  return catalog.flatMap((institute) => institute.groups.length ? [institute.groups[0]] : []).slice(0, 3);
}

/* ------------------------------------------------------------------ *
 * Сокращения институтов
 * ------------------------------------------------------------------ */

const SHORT_NAME_RULES = [
  [/информационн.*технолог.*электроник/i, "ИИТЭ"],
  [/архитектур.*строитель/i, "ИАС"],
  [/машиностроен.*автомобиль/i, "ИМиАТ"],
  [/экономик.*туризм/i, "ИЭиТ"],
  [/физическ.*культур/i, "ФКСХ"],
  [/музык.*театр/i, "ВШМТ"],
  [/естественн.*наук/i, "ЕН"],
  [/колледж/i, "КИТП"],
  [/среднего профессионального юридического/i, "СПО-Ю"],
  [/юридическ/i, "ЮИ"],
  [/педагогическ/i, "ПИ"],
  [/гуманитарн/i, "ГИ"],
  [/международного образования/i, "ЦМО"],
  [/международного сотрудничества/i, "ОМС"]
];

export function instituteShortName(name) {
  const rule = SHORT_NAME_RULES.find(([pattern]) => pattern.test(name));
  if (rule) return rule[1];

  const words = name
    .replace(/[()«»"']/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !/^(институт|филиал|имени|университет|отдел|отделение)$/i.test(word));
  return words.map((word) => word[0]).join("").toLocaleUpperCase("ru-RU").slice(0, 5) || "ВлГУ";
}

/* ------------------------------------------------------------------ *
 * Каталог
 * ------------------------------------------------------------------ */

async function buildCatalog(args, report) {
  const institutes = (await fetchInstitutes()).slice(0, args.institutes);
  const catalog = [];

  for (const institute of institutes) {
    const byNrec = new Map();

    for (const form of STUDY_FORMS) {
      try {
        const groups = await fetchGroups(institute.id, form.id);
        for (const group of groups) {
          const existing = byNrec.get(group.nrec);
          if (existing) {
            // Одна группа может числиться сразу в нескольких формах обучения.
            if (!existing.forms.includes(form.key)) existing.forms.push(form.key);
            continue;
          }
          byNrec.set(group.nrec, { ...group, forms: [form.key] });
        }
      } catch (error) {
        report.failures.push({
          scope: "groups",
          institute: institute.name,
          form: form.key,
          reason: error?.message ?? String(error)
        });
      }
    }

    const groups = [...byNrec.values()]
      .sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true }))
      .slice(0, args.groups);

    catalog.push({
      id: institute.id,
      name: institute.name,
      shortName: instituteShortName(institute.name),
      groupCount: groups.length,
      groups
    });
  }

  catalog.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return catalog;
}

/* ------------------------------------------------------------------ *
 * Снимок группы
 * ------------------------------------------------------------------ */

async function buildGroupSnapshot(group, institute) {
  const [schedule, currentInfo] = await Promise.all([
    fetchGroupSchedule(group.nrec),
    fetchGroupCurrentInfo(group.nrec).catch(() => null)
  ]);

  const quality = scheduleQuality(schedule);
  if (!quality) {
    const error = new Error("расписание не прошло проверку качества");
    error.code = "invalid-schedule";
    throw error;
  }

  const semester =
    currentInfo && Number.isInteger(currentInfo.CurrentSemester) && currentInfo.CurrentSemester > 0
      ? currentInfo.CurrentSemester
      : null;

  // Стабильное ядро: только то, изменение чего означает изменение расписания.
  const core = { semester, schedule };

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    group: {
      nrec: group.nrec,
      name: group.name,
      course: group.course || null,
      forms: group.forms,
      instituteId: institute.id,
      instituteName: institute.name,
      instituteShortName: institute.shortName
    },
    semester,
    schedule,
    quality,
    scheduleHash: sha256(core),
    provenance: buildProvenance()
  };
}

/* ------------------------------------------------------------------ *
 * Происхождение снимка
 * ------------------------------------------------------------------ */

/**
 * Откуда взялись эти данные.
 *
 * Главная ценность сборки через Actions в том, что каждое обновление —
 * публичный коммит. Но чтобы это было проверяемо, снимок обязан нести ссылку
 * на себя: репозиторий, коммит и запуск обхода. Иначе «прозрачность» остаётся
 * словами в README.
 *
 * Вне CI полей нет — и это честно: снимок, собранный вручную, ничем не
 * подтверждён.
 */
export function buildProvenance(env = process.env) {
  const repository = env.GITHUB_REPOSITORY;
  const commit = env.GITHUB_SHA;
  const runId = env.GITHUB_RUN_ID;
  if (!repository || !commit) return null;

  const server = env.GITHUB_SERVER_URL || "https://github.com";
  return {
    repository,
    commit,
    commitUrl: `${server}/${repository}/commit/${commit}`,
    runUrl: runId ? `${server}/${repository}/actions/runs/${runId}` : null
  };
}

export function crawlExitCode(report, catalogOnly = false) {
  if (catalogOnly) return 0;
  if (report.scheduleSkipped > 0) {
    return report.probeAttempted === 3 && report.probeEmpty === 3
      && report.scheduleAttempted === 0 ? 2 : 1;
  }
  return report.scheduleAttempted > 0 && report.scheduleOk === 0 ? 1 : 0;
}

/* ------------------------------------------------------------------ *
 * Главный проход
 * ------------------------------------------------------------------ */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const outDir = path.resolve(process.cwd(), args.out);

  const report = {
    startedAt,
    provenance: buildProvenance(),
    finishedAt: null,
    institutes: 0,
    groupsInCatalog: 0,
    scheduleAttempted: 0,
    scheduleOk: 0,
    scheduleFailed: 0,
    probeAttempted: 0,
    probeEmpty: 0,
    scheduleSkipped: 0,
    skipReason: null,
    coverageAvailable: 0,
    written: { created: 0, updated: 0, unchanged: 0 },
    failures: []
  };

  console.log(`[снимок] старт ${startedAt}`);
  console.log(`[снимок] каталог: институты и группы всех форм обучения`);

  const catalog = await buildCatalog(args, report);
  report.institutes = catalog.length;
  report.groupsInCatalog = catalog.reduce((sum, item) => sum + item.groups.length, 0);
  console.log(`[снимок] институтов: ${report.institutes}, групп: ${report.groupsInCatalog}`);

  const catalogFile = path.join(outDir, "catalog.json");
  const catalogResult = await writeIfChanged(
    catalogFile,
    toJsonFile({
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      capturedAt: startedAt,
      provenance: buildProvenance(),
      instituteCount: catalog.length,
      groupCount: report.groupsInCatalog,
      institutes: catalog
    }),
    args
  );
  console.log(`[снимок] catalog.json: ${catalogResult}`);

  if (!args.catalogOnly) {
    const tasks = catalog.flatMap((institute) =>
      institute.groups.map((group) => ({ group, institute }))
    );
    const probes = probeGroupsFromDifferentInstitutes(catalog);
    report.probeAttempted = probes.length;
    const probeResults = await Promise.allSettled(
      probes.map((group) => fetchGroupSchedule(group.nrec, { retries: 0, timeoutMs: 8_000 }))
    );
    report.probeEmpty = probeResults.filter((result) => result.status === "rejected" && isEmptyScheduleResponse(result.reason)).length;
    const upstreamUnavailable = probes.length === 3 && report.probeEmpty === 3;

    if (upstreamUnavailable) {
      report.scheduleSkipped = tasks.length;
      report.skipReason = "Три группы разных институтов вернули пустой ответ HTTP 200; полный обход отложен";
      console.warn(`[снимок] ${report.skipReason}. Сохранённые файлы не изменены.`);
    } else {
      report.scheduleAttempted = tasks.length;
      await runPolitely(
        tasks,
        async ({ group, institute }) => {
          const file = path.join(outDir, "schedule", `${group.nrec}.json`);
          try {
            const snapshot = await buildGroupSnapshot(group, institute);
            const result = await writeIfChanged(
              file,
              toJsonFile({ ...snapshot, capturedAt: startedAt }),
              args
            );
            report.scheduleOk += 1;
            if (result.includes("creat")) report.written.created += 1;
            else if (result.includes("updat")) report.written.updated += 1;
            else report.written.unchanged += 1;
          } catch (error) {
            // Плохой ответ не трогает файл на диске: там остаётся последний хороший снимок.
            report.scheduleFailed += 1;
            report.failures.push({
              scope: "schedule",
              group: group.name,
              nrec: group.nrec,
              institute: institute.shortName,
              reason: error?.message ?? String(error)
            });
          }
        },
        { concurrency: args.concurrency, delayMs: args.delay }
      );
    }

    console.log(
      `[снимок] расписания: успешно ${report.scheduleOk}, сбоев ${report.scheduleFailed}` +
        `, пропущено ${report.scheduleSkipped}` +
        ` (создано ${report.written.created}, обновлено ${report.written.updated}, без изменений ${report.written.unchanged})`
    );
  }

  report.finishedAt = new Date().toISOString();
  report.durationSeconds = Math.round(
    (Date.parse(report.finishedAt) - Date.parse(report.startedAt)) / 1000
  );

  const coverage = await collectCoverage(outDir, catalog);
  report.coverageAvailable = coverage.available;
  await writeIfChanged(path.join(outDir, "coverage.json"), toJsonFile(coverage), args);

  const statusResult = await writeIfChanged(
    path.join(outDir, "status.json"),
    toJsonFile(report),
    args
  );
  console.log(`[снимок] status.json: ${statusResult}`);

  if (report.failures.length) {
    console.log(`[снимок] сбоев всего: ${report.failures.length}`);
    for (const failure of report.failures.slice(0, 10)) {
      console.log(`  · ${failure.scope} ${failure.group ?? failure.institute ?? ""}: ${failure.reason}`);
    }
  }

  const exitCode = crawlExitCode(report, args.catalogOnly);
  if (exitCode === 2) {
    console.warn("[снимок] ожидаемый сбой источника: отчёт обновлён, прежние снимки сохранены");
  } else if (exitCode === 1) {
    console.error("[снимок] ни одна группа не получила расписание - обход считается проваленным");
  }
  process.exitCode = exitCode;
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith("buildSnapshot.mjs");
if (isDirectRun) {
  main().catch((error) => {
    console.error("[снимок] аварийная остановка:", error?.message ?? error);
    process.exitCode = 1;
  });
}
