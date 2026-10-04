/**
 * Чтение расписания из статических файлов, собранных GitHub Actions.
 *
 * API ВлГУ запрещает чтение с чужого домена, поэтому на статическом хостинге
 * браузер не может обратиться к нему напрямую. Обход выполняется заранее на
 * сервере (scripts/snapshot), а приложение читает готовые файлы с CDN.
 *
 * Формат описан в docs/DATA-PIPELINE.md.
 */

import type { CurrentInfo, LessonSlot, ScheduleState } from "../types";
import type { GroupOption, InstituteOption, StudyFormKey } from "../features/groups/groupTypes";
import { STUDY_FORM_KEYS } from "../features/groups/groupTypes";
import { instituteShortName, instituteVisualKey } from "../features/groups/instituteVisuals";
import { withEstimatedSemesterPeriod } from "./schedulePeriod";

export const STATIC_SCHEMA_VERSION = 3;

interface StaticGroup {
  nrec: string;
  name: string;
  course: string | null;
  forms: StudyFormKey[];
}

interface StaticInstitute {
  id: string;
  name: string;
  shortName: string;
  groupCount: number;
  groups: StaticGroup[];
}

export interface StaticCatalog {
  schemaVersion: number;
  capturedAt: string;
  instituteCount: number;
  groupCount: number;
  institutes: StaticInstitute[];
}

export interface StaticScheduleSnapshot {
  schemaVersion: number;
  group: {
    nrec: string;
    name: string;
    course: string | null;
    forms: StudyFormKey[];
    instituteId: string;
    instituteName: string;
    instituteShortName: string;
  };
  semester: number | null;
  schedule: unknown[];
  quality: { valid: boolean; scheduleEntries: number; lessonDays: number; examEntries: number; warnings: string[] };
  scheduleHash: string;
  capturedAt: string;
  validFrom?: string;
  validThrough?: string;
  sourceDocument?: {
    title: string;
    url: string;
    sha256: string;
    reviewedAt: string;
  };
  provenance?: unknown;
  extraction?: {
    method: "ocr";
    status: "unreviewed";
    sourceUrl: string;
    sourcePdfSha256: string;
    member: number;
    page: number;
    column: number;
    flaggedCells: number;
  };
}

function validDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export interface StaticCoverage {
  checkedAt: string;
  catalogGroups: number;
  available: number;
  groups: Record<string, { capturedAt: string; semester: number | null; scheduleHash: string; validFrom?: string; validThrough?: string }>;
}

export interface OfficialDocumentLocation {
  period: string;
  title: string;
  url: string;
  groupName: string;
  member: number;
  page: number;
  column: number;
  sharedColumn?: boolean;
  columnHeader?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

/** Pages может раздавать приложение из подкаталога, поэтому путь строится от BASE_URL. */
export function staticDataUrl(relativePath: string) {
  const base = import.meta.env.BASE_URL || "/";
  return `${base.replace(/\/$/, "")}/data/${relativePath.replace(/^\//, "")}`;
}

let documentIndexPromise: Promise<unknown> | null = null;

function loadOfficialDocumentIndex(): Promise<unknown> {
  documentIndexPromise ??= fetchJson(staticDataUrl("document-index.json"))
    .catch((error) => { documentIndexPromise = null; throw error; });
  return documentIndexPromise;
}

export function resetOfficialDocumentIndexCache() {
  documentIndexPromise = null;
}

function documentLocationFromIndex(payload: unknown, nrec: string): OfficialDocumentLocation | null {
  if (!isRecord(payload) || payload.schemaVersion !== 1 || !isRecord(payload.groups)
    || !isRecord(payload.sources) || typeof payload.period !== "string"
    || !payload.period.trim() || payload.period.length > 60) return null;
  const group = payload.groups[nrec];
  if (!isRecord(group) || typeof group.sourceId !== "string" || typeof group.groupName !== "string"
    || !Number.isInteger(group.member) || (group.member as number) < 1
    || !Number.isInteger(group.page) || (group.page as number) < 1
    || !Number.isInteger(group.column) || (group.column as number) < 1) return null;
  const source = payload.sources[group.sourceId];
  if (!isRecord(source) || typeof source.title !== "string" || typeof source.url !== "string"
    || !source.url.startsWith("https://www.vlsu.ru/fileadmin/class-schedule/")) return null;
  return {
    period: payload.period,
    title: source.title,
    url: source.url,
    groupName: group.groupName,
    member: group.member as number,
    page: group.page as number,
    column: group.column as number,
    ...(group.sharedColumn === true && typeof group.columnHeader === "string"
      ? { sharedColumn: true, columnHeader: group.columnHeader } : {})
  };
}

export async function fetchOfficialDocumentLocation(nrec: string): Promise<OfficialDocumentLocation | null> {
  if (!/^[a-f\d]{32}$/i.test(nrec)) return null;
  return documentLocationFromIndex(await loadOfficialDocumentIndex(), nrec);
}

export async function fetchOfficialDocumentGroupIds(): Promise<Set<string>> {
  const payload = await loadOfficialDocumentIndex();
  if (!isRecord(payload) || !isRecord(payload.groups)) return new Set();
  return new Set(Object.keys(payload.groups).filter((nrec) => documentLocationFromIndex(payload, nrec)));
}

export async function fetchOcrScheduleCoverage(): Promise<Record<string, { validFrom: string; validThrough: string }>> {
  const payload = await fetchJson(staticDataUrl("ocr-schedule/index.json"));
  if (!isRecord(payload) || payload.schemaVersion !== 1 || !isRecord(payload.groups)) {
    throw new Error("Карта расписаний имеет неизвестный формат");
  }
  const groups: Record<string, { validFrom: string; validThrough: string }> = {};
  for (const [nrec, period] of Object.entries(payload.groups)) {
    if (!/^[a-f\d]{32}$/i.test(nrec) || !isRecord(period)
      || !validDateKey(period.validFrom) || !validDateKey(period.validThrough)
      || period.validFrom > period.validThrough) continue;
    groups[nrec] = { validFrom: period.validFrom, validThrough: period.validThrough };
  }
  return groups;
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal });
  if (!response.ok) throw new Error(`Статические данные недоступны: ${url} (${response.status})`);
  return response.json();
}

function isStudyForm(value: unknown): value is StudyFormKey {
  return typeof value === "string" && (STUDY_FORM_KEYS as readonly string[]).includes(value);
}

function normalizeStaticGroup(value: unknown): StaticGroup | null {
  if (!isRecord(value)) return null;
  if (typeof value.nrec !== "string" || !/^[a-f\d]{32}$/i.test(value.nrec)) return null;
  if (typeof value.name !== "string" || !value.name.trim()) return null;
  const forms = Array.isArray(value.forms) ? value.forms.filter(isStudyForm) : [];
  return {
    nrec: value.nrec,
    name: value.name.trim(),
    course: typeof value.course === "string" && value.course ? value.course : null,
    forms
  };
}

export function normalizeStaticCatalog(payload: unknown): StaticCatalog {
  if (!isRecord(payload)
    || payload.schemaVersion !== STATIC_SCHEMA_VERSION
    || typeof payload.capturedAt !== "string"
    || !Array.isArray(payload.institutes)) {
    throw new Error("Каталог имеет неизвестный формат");
  }

  const institutes = payload.institutes
    .map((item): StaticInstitute | null => {
      if (!isRecord(item)) return null;
      if (typeof item.id !== "string" || !item.id) return null;
      if (typeof item.name !== "string" || !item.name.trim()) return null;
      const groups = (Array.isArray(item.groups) ? item.groups : [])
        .map(normalizeStaticGroup)
        .filter((group): group is StaticGroup => group !== null);
      return {
        id: item.id,
        name: item.name.trim(),
        shortName: typeof item.shortName === "string" && item.shortName ? item.shortName : "ВлГУ",
        groupCount: groups.length,
        groups
      };
    })
    .filter((item): item is StaticInstitute => item !== null);

  if (!institutes.length) throw new Error("Каталог пуст");

  return {
    schemaVersion: STATIC_SCHEMA_VERSION,
    capturedAt: payload.capturedAt,
    instituteCount: institutes.length,
    groupCount: institutes.reduce((sum, item) => sum + item.groups.length, 0),
    institutes
  };
}

let catalogPromise: Promise<StaticCatalog> | null = null;

/** Каталог читается один раз за сессию: это один файл на весь университет. */
export function loadStaticCatalog(signal?: AbortSignal): Promise<StaticCatalog> {
  if (!catalogPromise) {
    catalogPromise = fetchJson(staticDataUrl("catalog.json"), signal)
      .then(normalizeStaticCatalog)
      .catch((error) => {
        catalogPromise = null;
        throw error;
      });
  }
  return catalogPromise;
}

export function resetStaticCatalogCache() {
  catalogPromise = null;
}

export function normalizeStaticCoverage(payload: unknown): StaticCoverage {
  if (!isRecord(payload) || payload.schemaVersion !== 1 || !isRecord(payload.groups)
    || typeof payload.checkedAt !== "string" || Number.isNaN(Date.parse(payload.checkedAt))) {
    throw new Error("Карта покрытия имеет неизвестный формат");
  }
  const groups: StaticCoverage["groups"] = {};
  for (const [nrec, item] of Object.entries(payload.groups)) {
    if (!/^[a-f\d]{32}$/i.test(nrec) || !isRecord(item)
      || typeof item.capturedAt !== "string" || Number.isNaN(Date.parse(item.capturedAt))
      || typeof item.scheduleHash !== "string" || !/^[a-f\d]{64}$/i.test(item.scheduleHash)) continue;
    groups[nrec] = {
      capturedAt: item.capturedAt,
      semester: typeof item.semester === "number" ? item.semester : null,
      scheduleHash: item.scheduleHash,
      ...(validDateKey(item.validFrom) && validDateKey(item.validThrough) && item.validFrom <= item.validThrough
        ? { validFrom: item.validFrom, validThrough: item.validThrough }
        : {})
    };
  }
  return {
    checkedAt: payload.checkedAt,
    catalogGroups: typeof payload.catalogGroups === "number" ? payload.catalogGroups : 0,
    available: Object.keys(groups).length,
    groups
  };
}

let coveragePromise: Promise<StaticCoverage> | null = null;

export function loadStaticCoverage(): Promise<StaticCoverage> {
  if (!coveragePromise) {
    coveragePromise = fetchJson(staticDataUrl("coverage.json"))
      .then(normalizeStaticCoverage)
      .catch((error) => { coveragePromise = null; throw error; });
  }
  return coveragePromise;
}

export function catalogInstitutes(catalog: StaticCatalog): InstituteOption[] {
  return catalog.institutes
    .map((institute) => ({
      id: institute.id,
      name: institute.name,
      shortName: institute.shortName || instituteShortName(institute.id, institute.name),
      visualKey: instituteVisualKey(institute.id, institute.name)
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

export function catalogGroups(catalog: StaticCatalog, instituteId: string): GroupOption[] {
  const institute = catalog.institutes.find((item) => item.id === instituteId);
  if (!institute) return [];
  return institute.groups
    .map((group) => ({
      nrec: group.nrec,
      name: group.name,
      course: group.course ?? undefined,
      forms: group.forms
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true }));
}

export function normalizeStaticSnapshot(payload: unknown, expectedNrec: string): StaticScheduleSnapshot {
  if (!isRecord(payload)
    || payload.schemaVersion !== STATIC_SCHEMA_VERSION
    || !isRecord(payload.group)
    || payload.group.nrec !== expectedNrec
    || typeof payload.group.name !== "string"
    || !Array.isArray(payload.schedule)
    || payload.schedule.length === 0
    || !payload.schedule.every((item: unknown) => isRecord(item)
      && typeof item.name === "string"
      && (item.type === "Lessons" || item.type === "ExamSession"))
    || !payload.schedule.some((item: Record<string, unknown>) => item.type === "ExamSession"
      || Array.from({ length: 8 }, (_, index) => index + 1)
        .some((pair) => String(item[`n${pair}`] ?? "").trim() || String(item[`z${pair}`] ?? "").trim()))
    || typeof payload.scheduleHash !== "string"
    || !/^[a-f\d]{64}$/i.test(payload.scheduleHash)
    || typeof payload.capturedAt !== "string"
    || Number.isNaN(Date.parse(payload.capturedAt))
    || !isRecord(payload.quality)
    || payload.quality.valid !== true
    || ((payload.validFrom !== undefined || payload.validThrough !== undefined)
      && (!validDateKey(payload.validFrom) || !validDateKey(payload.validThrough)
        || payload.validFrom > payload.validThrough))
    || (payload.extraction !== undefined && (!isRecord(payload.extraction)
      || payload.extraction.method !== "ocr" || payload.extraction.status !== "unreviewed"
      || typeof payload.extraction.sourceUrl !== "string"
      || !payload.extraction.sourceUrl.startsWith("https://www.vlsu.ru/")
      || typeof payload.extraction.sourcePdfSha256 !== "string"
      || !/^[a-f\d]{64}$/i.test(payload.extraction.sourcePdfSha256)
      || ![payload.extraction.member, payload.extraction.page, payload.extraction.column]
        .every((value) => Number.isInteger(value) && (value as number) > 0)
      || !Number.isInteger(payload.extraction.flaggedCells)
      || (payload.extraction.flaggedCells as number) < 0
      || !validDateKey(payload.validFrom) || !validDateKey(payload.validThrough)))
    || (payload.sourceDocument !== undefined && (!isRecord(payload.sourceDocument)
      || !validDateKey(payload.validFrom) || !validDateKey(payload.validThrough)
      || typeof payload.sourceDocument.title !== "string" || !payload.sourceDocument.title.trim()
      || typeof payload.sourceDocument.url !== "string" || !payload.sourceDocument.url.startsWith("https://")
      || typeof payload.sourceDocument.sha256 !== "string" || !/^[a-f\d]{64}$/i.test(payload.sourceDocument.sha256)
      || typeof payload.sourceDocument.reviewedAt !== "string"
      || !Number.isFinite(Date.parse(payload.sourceDocument.reviewedAt))))) {
    throw new Error("Снимок расписания имеет неизвестный формат");
  }
  return payload as unknown as StaticScheduleSnapshot;
}

/**
 * Тип недели в снимке не хранится: он выводится из календаря, чтобы старый
 * снимок не мог перевернуть неделю. Приложение считает неделю само
 * (vlsuWeekModeForDate), сюда она приходит уже посчитанной.
 */
function currentInfoFromSnapshot(snapshot: StaticScheduleSnapshot, weekType: 1 | 2): CurrentInfo {
  const institute = snapshot.group.instituteShortName;
  return {
    currentLesson: "",
    currentWeekType: weekType,
    name: institute ? `${snapshot.group.name}, ${institute}` : snapshot.group.name,
    semester: snapshot.semester ?? 0
  };
}

export function scheduleStateFromSnapshot(
  snapshot: StaticScheduleSnapshot,
  normalizeSchedule: (days: unknown[]) => LessonSlot[],
  weekType: 1 | 2,
  now = Date.now()
): ScheduleState {
  const capturedAtMs = Date.parse(snapshot.capturedAt);
  const lessons = normalizeSchedule(snapshot.schedule);
  return withEstimatedSemesterPeriod({
    schemaVersion: STATIC_SCHEMA_VERSION,
    groupNrec: snapshot.group.nrec,
    currentInfo: currentInfoFromSnapshot(snapshot, weekType),
    allLessons: snapshot.validFrom && snapshot.validThrough
      ? lessons.map((lesson) => lesson.scheduleKind === "exam" ? lesson : {
          ...lesson, validFrom: snapshot.validFrom, validThrough: snapshot.validThrough
        })
      : lessons,
    fetchedAt: snapshot.capturedAt,
    validFrom: snapshot.validFrom,
    validThrough: snapshot.validThrough,
    sourceDocument: snapshot.sourceDocument,
    weekTypeAsOf: snapshot.capturedAt,
    source: snapshot.extraction?.method === "ocr" ? "pdf-ocr" : "static-snapshot",
    snapshotAgeSeconds: Math.max(0, Math.floor((now - capturedAtMs) / 1000)),
    contentHash: snapshot.scheduleHash,
    provenance: normalizeProvenance(snapshot.provenance) ?? undefined,
    quality: snapshot.quality
  });
}

let universityBundlePromise: Promise<Record<string, unknown>> | null = null;

export function resetUniversityBundleCache() {
  universityBundlePromise = null;
}

export async function warmUniversityScheduleBundle(): Promise<Record<string, unknown>> {
  universityBundlePromise ??= fetchJson(staticDataUrl("university-schedule.json"), AbortSignal.timeout(8000))
    .catch(() => fetchJson(staticDataUrl("ocr-schedule/bundle.json"), AbortSignal.timeout(8000)))
    .then((payload) => {
      if (!isRecord(payload) || payload.schemaVersion !== 1 || !isRecord(payload.groups)) {
        throw new Error("Пакет расписаний имеет неизвестный формат");
      }
      return payload.groups;
    }).catch((error) => { universityBundlePromise = null; throw error; });
  return universityBundlePromise;
}

export async function fetchStaticSnapshot(nrec: string, signal?: AbortSignal) {
  try {
    const primary = await fetch(staticDataUrl(`schedule/${nrec}.json`), {
      headers: { Accept: "application/json" }, signal
    });
    if (primary.ok) return normalizeStaticSnapshot(await primary.json(), nrec);
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  try {
    const provisional = await fetchJson(staticDataUrl(`ocr-schedule/${nrec}.json`), signal);
    return normalizeStaticSnapshot(provisional, nrec);
  } catch (error) {
    if (signal?.aborted) throw error;
    const bundle = await warmUniversityScheduleBundle();
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    return normalizeStaticSnapshot(bundle[nrec], nrec);
  }
}

/* ------------------------------------------------------------------ *
 * Происхождение данных
 * ------------------------------------------------------------------ */

/**
 * Откуда взялся снимок.
 *
 * Обход собирает данные в GitHub Actions, поэтому каждое обновление —
 * публичный коммит. Эти поля дают студенту (и ИТ-службе ВлГУ) возможность
 * открыть конкретный коммит и сверить, что показано именно то, что забрали из
 * API. Без ссылки на себя «прозрачность» остаётся обещанием в README.
 *
 * Снимок, собранный вручную вне CI, полей не имеет — и это честно.
 */
export interface SnapshotProvenance {
  repository: string;
  commit: string;
  commitUrl: string;
  runUrl: string | null;
}

export interface CrawlStatus {
  startedAt: string;
  finishedAt: string | null;
  durationSeconds?: number;
  institutes: number;
  groupsInCatalog: number;
  scheduleAttempted: number;
  scheduleOk: number;
  scheduleFailed: number;
  probeAttempted: number;
  probeEmpty: number;
  scheduleSkipped: number;
  skipReason: string | null;
  coverageAvailable: number;
  failures: Array<{ scope: string; group?: string; institute?: string; reason: string }>;
  provenance: SnapshotProvenance | null;
}

export function normalizeProvenance(value: unknown): SnapshotProvenance | null {
  if (!isRecord(value)) return null;
  if (typeof value.repository !== "string" || typeof value.commit !== "string") return null;
  if (typeof value.commitUrl !== "string" || !value.commitUrl.startsWith("https://")) return null;
  const runUrl = typeof value.runUrl === "string" && value.runUrl.startsWith("https://") ? value.runUrl : null;
  return { repository: value.repository, commit: value.commit, commitUrl: value.commitUrl, runUrl };
}

export function normalizeCrawlStatus(payload: unknown): CrawlStatus {
  if (!isRecord(payload) || typeof payload.startedAt !== "string") {
    throw new Error("Отчёт об обходе имеет неизвестный формат");
  }
  const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  return {
    startedAt: payload.startedAt,
    finishedAt: typeof payload.finishedAt === "string" ? payload.finishedAt : null,
    durationSeconds: typeof payload.durationSeconds === "number" ? payload.durationSeconds : undefined,
    institutes: number(payload.institutes),
    groupsInCatalog: number(payload.groupsInCatalog),
    scheduleAttempted: number(payload.scheduleAttempted),
    scheduleOk: number(payload.scheduleOk),
    scheduleFailed: number(payload.scheduleFailed),
    probeAttempted: number(payload.probeAttempted),
    probeEmpty: number(payload.probeEmpty),
    scheduleSkipped: number(payload.scheduleSkipped),
    skipReason: typeof payload.skipReason === "string" ? payload.skipReason : null,
    coverageAvailable: number(payload.coverageAvailable),
    failures: Array.isArray(payload.failures)
      ? payload.failures.filter(isRecord).map((item) => ({
          scope: String(item.scope ?? ""),
          group: typeof item.group === "string" ? item.group : undefined,
          institute: typeof item.institute === "string" ? item.institute : undefined,
          reason: String(item.reason ?? "")
        }))
      : [],
    provenance: normalizeProvenance(payload.provenance)
  };
}

export async function fetchCrawlStatus(signal?: AbortSignal): Promise<CrawlStatus> {
  return normalizeCrawlStatus(await fetchJson(staticDataUrl("status.json"), signal));
}
