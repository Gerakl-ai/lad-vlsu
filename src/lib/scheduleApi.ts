import type { CurrentInfo, LessonSlot, LessonVariant, ScheduleDataSource, ScheduleQuality, ScheduleState, WeekMode } from "../types";
import { writeGroupScheduleCache } from "../features/groups/groupStorage";
import { vlsuWeekTypeForDate } from "./academicWeek";
import {
  catalogGroups,
  catalogInstitutes,
  fetchStaticSnapshot,
  loadStaticCatalog,
  scheduleStateFromSnapshot
} from "./staticData";
import { instituteShortName, instituteVisualKey } from "../features/groups/instituteVisuals";
import {
  type GroupOption,
  type GroupProfile,
  type InstituteOption,
  type StudyFormKey
} from "../features/groups/groupTypes";

const API_BASE = "/vlsu-api";
const REQUEST_TIMEOUT_MS = 8_000;
const REQUEST_RETRIES = 0;

const PAIR_TIMES = [
  ["08:30", "10:00"],
  ["10:20", "11:50"],
  ["12:10", "13:40"],
  ["14:00", "15:30"],
  ["15:50", "17:20"],
  ["17:40", "19:10"],
  ["19:20", "20:50"]
] as const;

const DAY_INDEX_BY_NAME: Record<string, number> = {
  "понедельник": 1,
  "вторник": 2,
  "среда": 3,
  "четверг": 4,
  "пятница": 5,
  "суббота": 6,
  "воскресенье": 7
};

interface InstituteDto {
  Value: string;
  Text: string;
}

interface GroupDto {
  Nrec: string;
  Name: string;
  Course: string;
}

interface GroupsResponse {
  value?: GroupDto[];
  Count?: number;
}

export interface ScheduleDayDto {
  type: string;
  name: string;
  [key: `n${number}`]: string;
  [key: `z${number}`]: string;
}

export interface ExamSessionDto {
  type: "ExamSession";
  date: string;
  time: string;
  isConsultation: boolean;
  name: string;
}

interface CurrentInfoDto {
  CurrentLesson: string;
  CurrentWeekType: 1 | 2;
  Name: string;
  CurrentSemester: number;
}

interface GroupScheduleSnapshotDto {
  schemaVersion: 2;
  group: { nrec: string; name: string };
  semester: number;
  currentInfo: CurrentInfoDto;
  schedule: unknown[];
  weekType: 1 | 2;
  weekTypeAsOf: string;
  scheduleFetchedAt: string;
  contentHash: string;
  source: ScheduleDataSource;
  ageSeconds: number;
  requestId: string;
  quality: ScheduleQuality;
}

interface ParsedLesson {
  subject: string;
  room?: string;
  kind?: string;
  teacher?: string;
  variants: LessonVariant[];
}

interface RequestMetadata {
  snapshotAt?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isScheduleDay(value: unknown): value is ScheduleDayDto {
  return isRecord(value) && value.type === "Lessons" && typeof value.name === "string";
}

function isExamSession(value: unknown): value is ExamSessionDto {
  return isRecord(value)
    && value.type === "ExamSession"
    && typeof value.date === "string"
    && typeof value.time === "string"
    && typeof value.name === "string"
    && typeof value.isConsultation === "boolean";
}

class ApiResponseError extends Error {
  constructor(path: string, readonly status: number) {
    super(`VLSU API ${path} failed with ${status}`);
  }
}

function wait(milliseconds: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

export function decodeApiPayload(payload: unknown) {
  if (typeof payload !== "string") return payload;
  const trimmed = payload.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return payload;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return payload;
  }
}

async function request<T>(path: string, init?: RequestInit, metadata?: RequestMetadata): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= REQUEST_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const abortFromParent = () => controller.abort(init?.signal?.reason);
    init?.signal?.addEventListener("abort", abortFromParent, { once: true });
    const timeout = globalThis.setTimeout(() => controller.abort("timeout"), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${API_BASE}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers ?? {})
        }
      });

      if (!response.ok) throw new ApiResponseError(path, response.status);
      const snapshotAt = response.headers.get("X-Lad-Snapshot-At")
        ?? response.headers.get("Date")
        ?? new Date().toISOString();
      if (metadata && !Number.isNaN(new Date(snapshotAt).getTime())) {
        metadata.snapshotAt = snapshotAt;
      }
      return decodeApiPayload(await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (init?.signal?.aborted) throw error;
      if (error instanceof ApiResponseError && !isRetryableStatus(error.status)) throw error;
      if (attempt === REQUEST_RETRIES) throw error;
      await wait(300 * (attempt + 1));
    } finally {
      globalThis.clearTimeout(timeout);
      init?.signal?.removeEventListener("abort", abortFromParent);
    }
  }

  throw lastError;
}

function unwrapArrayPayload<T>(payload: unknown, label: string): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === "object" && "value" in payload && Array.isArray(payload.value)) {
    return payload.value as T[];
  }
  throw new Error(`VLSU API returned an invalid ${label} payload`);
}

/**
 * Каталог институтов. Основной источник — статический снимок из ветки data:
 * API ВлГУ недоступен из браузера на чужом домене, а снимок ещё и переживает
 * падения upstream. Прямой запрос остаётся запасным путём для dev-сервера и
 * старых развёртываний через proxy.
 */
export async function loadInstitutes(): Promise<InstituteOption[]> {
  try {
    return catalogInstitutes(await loadStaticCatalog());
  } catch {
    // Статика недоступна — идём через proxy.
  }

  const payload = await request<unknown>("/catalogs/GetInstitutes");
  return unwrapArrayPayload<InstituteDto>(payload, "institutes")
    .filter((item) => typeof item.Value === "string" && typeof item.Text === "string" && item.Value && item.Text)
    .map((item) => ({
      id: item.Value,
      name: item.Text.trim(),
      shortName: instituteShortName(item.Value, item.Text),
      visualKey: instituteVisualKey(item.Value, item.Text)
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

const STUDY_FORM_REQUESTS: Array<{ wformed: number; key: StudyFormKey }> = [
  { wformed: 0, key: "full-time" },
  { wformed: 1, key: "extramural" },
  { wformed: 2, key: "part-time" }
];

async function fetchGroupsForForm(instituteId: string, wformed: number) {
  const groups = await request<GroupDto[] | GroupsResponse>("/student/GetStudGroups", {
    method: "POST",
    body: JSON.stringify({ Institut: instituteId, WFormed: wformed })
  });
  const list = Array.isArray(groups) ? groups : groups.value ?? [];
  return list.filter((group) => typeof group.Nrec === "string" && typeof group.Name === "string" && group.Nrec && group.Name);
}

/**
 * Группы института по всем трём формам обучения.
 *
 * Раньше запрашивалась только очная (WFormed: 0), из-за чего заочники и
 * очно-заочники не находили свою группу вообще — это больше трети групп ВлГУ.
 */
export async function loadGroups(instituteId: string): Promise<GroupOption[]> {
  try {
    const groups = catalogGroups(await loadStaticCatalog(), instituteId);
    if (groups.length) return groups;
  } catch {
    // Статика недоступна — идём через proxy.
  }

  const byNrec = new Map<string, GroupOption>();
  const responses = await Promise.allSettled(
    STUDY_FORM_REQUESTS.map(async (form) => ({ form, groups: await fetchGroupsForForm(instituteId, form.wformed) }))
  );

  for (const response of responses) {
    if (response.status !== "fulfilled") continue;
    for (const group of response.value.groups) {
      const existing = byNrec.get(group.Nrec);
      if (existing) {
        if (existing.forms && !existing.forms.includes(response.value.form.key)) {
          existing.forms.push(response.value.form.key);
        }
        continue;
      }
      byNrec.set(group.Nrec, {
        nrec: group.Nrec,
        name: group.Name.trim(),
        course: group.Course?.trim() || undefined,
        forms: [response.value.form.key]
      });
    }
  }

  if (!byNrec.size && responses.every((response) => response.status === "rejected")) {
    throw (responses[0] as PromiseRejectedResult).reason;
  }

  return [...byNrec.values()].sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true }));
}

async function fetchCurrentInfo(nrec: string, metadata?: RequestMetadata): Promise<CurrentInfo> {
  const payload = await request<unknown>("/student/GetGroupCurrentInfo", {
    method: "POST",
    body: JSON.stringify(nrec)
  }, metadata);
  return normalizeCurrentInfo(payload);
}

function normalizeCurrentInfo(payload: unknown): CurrentInfo {
  if (!isRecord(payload)
    || typeof payload.CurrentLesson !== "string"
    || (payload.CurrentWeekType !== 1 && payload.CurrentWeekType !== 2)
    || typeof payload.Name !== "string"
    || typeof payload.CurrentSemester !== "number") {
    throw new Error("VLSU API returned invalid current group information");
  }
  return {
    currentLesson: payload.CurrentLesson,
    currentWeekType: payload.CurrentWeekType,
    name: payload.Name,
    semester: payload.CurrentSemester
  };
}

function normalizeWeekMode(mode: "n" | "z"): WeekMode {
  return mode === "n" ? "numerator" : "denominator";
}

function parseLessonVariant(rawText: string): LessonVariant {
  const normalized = rawText.replace(/\s+/g, " ").trim();
  const parts = normalized.split(",").map((part) => part.trim());

  if (parts.length >= 4) {
    const subject = parts.slice(3).filter(Boolean).join(", ");
    return {
      room: parts[0] || undefined,
      kind: parts[1] || undefined,
      teacher: parts[2] || undefined,
      subject: subject || normalized,
      rawText: normalized
    };
  }

  if (parts.length === 3) {
    return {
      room: parts[0] || undefined,
      kind: parts[1] || undefined,
      subject: parts[2] || normalized,
      rawText: normalized
    };
  }

  return { subject: normalized, rawText: normalized };
}

function uniqueValues(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export function parseLessonText(rawText: string): ParsedLesson {
  const variants = rawText
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseLessonVariant);

  if (!variants.length) return { subject: "Занятие", variants: [] };

  const subjects = uniqueValues(variants.map((variant) => variant.subject));
  const rooms = uniqueValues(variants.map((variant) => variant.room));
  const kinds = uniqueValues(variants.map((variant) => variant.kind));
  const teachers = uniqueValues(variants.map((variant) => variant.teacher));

  return {
    subject: subjects.join(" / "),
    room: rooms.length ? rooms.join(" / ") : undefined,
    kind: kinds.length ? kinds.join(" / ") : undefined,
    teacher: teachers.length ? teachers.join(" / ") : undefined,
    variants
  };
}

function parseRuDate(value: string) {
  const [day, month, year] = value.split(".").map(Number);
  return new Date(year, month - 1, day);
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayIndexFromDate(date: Date) {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

function dayIndexFromScheduleName(name: string, fallback: number) {
  return DAY_INDEX_BY_NAME[name.trim().toLocaleLowerCase("ru-RU")] ?? fallback;
}

function endTimeForStart(start: string) {
  const pair = PAIR_TIMES.find(([pairStart]) => pairStart === start);
  if (pair) return pair[1];

  const [hours, minutes] = start.split(":").map(Number);
  const date = new Date(2026, 0, 1, hours, minutes + 90);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function createLesson(day: ScheduleDayDto, dayIndex: number, pairIndex: number, rawText: string, weekMode: WeekMode): LessonSlot {
  const [start, end] = PAIR_TIMES[pairIndex - 1];
  const parsed = parseLessonText(rawText);
  return {
    id: `${dayIndex}-${pairIndex}-${weekMode}-${rawText}`,
    dayIndex,
    dayName: day.name,
    pairIndex,
    start,
    end,
    rawText,
    weekMode,
    scheduleKind: "classes",
    ...parsed
  };
}

function createExamLesson(session: ExamSessionDto, index: number): LessonSlot {
  const date = parseRuDate(session.date);
  const parsed = parseLessonText(session.name);
  const dateIso = dateKey(date);
  const dateLabel = new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    weekday: "short"
  }).format(date);

  return {
    id: `exam-${dateIso}-${session.time}-${index}-${session.name}`,
    dayIndex: dayIndexFromDate(date),
    dayName: new Intl.DateTimeFormat("ru-RU", { weekday: "long" }).format(date),
    date: dateIso,
    dateLabel,
    scheduleKind: "exam",
    isConsultation: session.isConsultation,
    pairIndex: index + 1,
    start: session.time,
    end: endTimeForStart(session.time),
    rawText: session.name,
    weekMode: "all",
    ...parsed,
    kind: session.isConsultation ? "консультация" : parsed.kind
  };
}

function normalizeExamSchedule(sessions: ExamSessionDto[]): LessonSlot[] {
  return sessions
    .map(createExamLesson)
    .sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`, "ru"));
}

function hasScheduleContent(days: Array<ScheduleDayDto | ExamSessionDto>): boolean {
  return days.some((item) => {
    if (item.type === "ExamSession") return true;
    if (!isScheduleDay(item)) return false;
    return PAIR_TIMES.some((_, index) => Boolean(item[`n${index + 1}`]?.trim() || item[`z${index + 1}`]?.trim()));
  });
}

export function normalizeSchedule(days: Array<ScheduleDayDto | ExamSessionDto>): LessonSlot[] {
  const classDays = days.filter(isScheduleDay);
  const sessions = days.filter(isExamSession);
  const lessons: LessonSlot[] = [];

  classDays.forEach((day, index) => {
    const dayIndex = dayIndexFromScheduleName(day.name, index + 1);
    PAIR_TIMES.forEach((_, pairOffset) => {
      const pairIndex = pairOffset + 1;
      const numerator = (day[`n${pairIndex}`] || "").trim();
      const denominator = (day[`z${pairIndex}`] || "").trim();

      if (!numerator && !denominator) return;

      if (numerator && denominator && numerator === denominator) {
        lessons.push(createLesson(day, dayIndex, pairIndex, numerator, "all"));
        return;
      }

      if (numerator) lessons.push(createLesson(day, dayIndex, pairIndex, numerator, normalizeWeekMode("n")));
      if (denominator) lessons.push(createLesson(day, dayIndex, pairIndex, denominator, normalizeWeekMode("z")));
    });
  });

  return lessons.concat(normalizeExamSchedule(sessions));
}

export function normalizeGroupScheduleSnapshot(payload: unknown, expectedNrec: string): ScheduleState {
  if (!isRecord(payload)
    || payload.schemaVersion !== 2
    || !isRecord(payload.group)
    || payload.group.nrec !== expectedNrec
    || typeof payload.group.name !== "string"
    || typeof payload.semester !== "number"
    || !Array.isArray(payload.schedule)
    || (payload.weekType !== 1 && payload.weekType !== 2)
    || typeof payload.weekTypeAsOf !== "string"
    || Number.isNaN(Date.parse(payload.weekTypeAsOf))
    || typeof payload.scheduleFetchedAt !== "string"
    || Number.isNaN(Date.parse(payload.scheduleFetchedAt))
    || typeof payload.contentHash !== "string"
    || !/^[a-f\d]{64}$/i.test(payload.contentHash)
    || !["live", "edge-cache", "global-snapshot"].includes(String(payload.source))
    || typeof payload.ageSeconds !== "number"
    || payload.ageSeconds < 0
    || typeof payload.requestId !== "string"
    || !isRecord(payload.quality)
    || payload.quality.valid !== true) {
    throw new Error("Schedule snapshot v2 is invalid");
  }

  const days = payload.schedule as Array<ScheduleDayDto | ExamSessionDto>;
  if (days.length === 0 || days.some((day) => !isScheduleDay(day) && !isExamSession(day)) || !hasScheduleContent(days)) {
    throw new Error("Schedule snapshot v2 contains invalid schedule data");
  }
  const lessonDays = days.filter(isScheduleDay).length;
  const examEntries = days.filter(isExamSession).length;
  if (payload.quality.scheduleEntries !== days.length
    || payload.quality.lessonDays !== lessonDays
    || payload.quality.examEntries !== examEntries
    || !Array.isArray(payload.quality.warnings)) {
    throw new Error("Schedule snapshot v2 quality metadata is inconsistent");
  }
  const currentInfo = normalizeCurrentInfo(payload.currentInfo);
  if (currentInfo.semester !== payload.semester || currentInfo.currentWeekType !== payload.weekType) {
    throw new Error("Schedule snapshot v2 metadata is inconsistent");
  }

  const quality = payload.quality as unknown as ScheduleQuality;
  return {
    schemaVersion: 2,
    groupNrec: expectedNrec,
    currentInfo,
    allLessons: normalizeSchedule(days),
    fetchedAt: payload.scheduleFetchedAt,
    weekTypeAsOf: payload.weekTypeAsOf,
    source: payload.source as ScheduleDataSource,
    snapshotAgeSeconds: payload.ageSeconds,
    contentHash: payload.contentHash,
    requestId: payload.requestId,
    quality
  };
}

function isCachedLesson(value: unknown): value is LessonSlot {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && typeof value.dayIndex === "number"
    && typeof value.dayName === "string"
    && typeof value.pairIndex === "number"
    && typeof value.start === "string"
    && typeof value.end === "string"
    && typeof value.subject === "string"
    && typeof value.rawText === "string"
    && ["all", "numerator", "denominator"].includes(String(value.weekMode));
}

export function normalizeCachedSchedule(state: unknown): ScheduleState | null {
  if (!isRecord(state)
    || typeof state.groupNrec !== "string"
    || !isRecord(state.currentInfo)
    || typeof state.currentInfo.currentLesson !== "string"
    || (state.currentInfo.currentWeekType !== 1 && state.currentInfo.currentWeekType !== 2)
    || typeof state.currentInfo.name !== "string"
    || typeof state.currentInfo.semester !== "number"
    || !Array.isArray(state.allLessons)
    || state.allLessons.some((lesson) => !isCachedLesson(lesson))
    || typeof state.fetchedAt !== "string"
    || Number.isNaN(Date.parse(state.fetchedAt))) {
    return null;
  }

  const cached = state as unknown as ScheduleState;
  return {
    ...cached,
    source: "device-cache",
    weekTypeAsOf: cached.weekTypeAsOf ?? cached.fetchedAt,
    snapshotAgeSeconds: Math.max(0, Math.floor((Date.now() - Date.parse(cached.fetchedAt)) / 1000)),
    allLessons: cached.allLessons.map((lesson) => ({
      ...lesson,
      ...parseLessonText(lesson.rawText)
    }))
  };
}

async function fetchSchedule(nrec: string, metadata?: RequestMetadata) {
  const payload = await request<unknown>("/student/GetGroupSchedule", {
    method: "POST",
    body: JSON.stringify({ Nrec: nrec, WeekType: 0, WeekDays: "1,2,3,4,5,6" })
  }, metadata);
  const days = unwrapArrayPayload<ScheduleDayDto | ExamSessionDto>(payload, "schedule");
  if (days.some((day) => !isScheduleDay(day) && !isExamSession(day))) {
    throw new Error("VLSU API returned an invalid schedule item");
  }
  if (!hasScheduleContent(days)) {
    throw new Error("VLSU API returned an empty schedule");
  }

  return normalizeSchedule(days);
}

async function fetchGroupScheduleSnapshot(nrec: string) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort("timeout"), REQUEST_TIMEOUT_MS + 1_500);
  try {
    const response = await fetch(`/app-api/schedule/${encodeURIComponent(nrec)}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) throw new ApiResponseError("/app-api/schedule", response.status);
    return normalizeGroupScheduleSnapshot(await response.json(), nrec);
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export async function fetchArchivedWorkerSnapshot(nrec: string, workerUrl = import.meta.env.VITE_SCHEDULE_FALLBACK_URL): Promise<ScheduleState> {
  if (!workerUrl || !/^[a-f\d]{32}$/i.test(nrec)) throw new Error("Archived schedule fallback is unavailable");
  const base = new URL(workerUrl);
  if (base.protocol !== "https:") throw new Error("Archived schedule fallback requires HTTPS");
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort("timeout"), 2_500);
  try {
    const url = new URL(`/app-api/schedule/${nrec}?cached=1`, base);
    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: controller.signal,
      credentials: "omit"
    });
    if (!response.ok) throw new ApiResponseError("/app-api/schedule?cached=1", response.status);
    return normalizeGroupScheduleSnapshot(await response.json(), nrec);
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

/**
 * Расписание группы из статического снимка.
 *
 * Снимок собран заранее на сервере и лежит на CDN, поэтому открытие расписания
 * не зависит от доступности API ВлГУ в этот момент. Тип недели берётся из
 * календаря, а не из снимка: так старый снимок не может перевернуть неделю.
 */
async function loadStaticSchedule(group: GroupProfile): Promise<ScheduleState> {
  const snapshot = await fetchStaticSnapshot(group.nrec);
  return scheduleStateFromSnapshot(snapshot, normalizeScheduleDays, vlsuWeekTypeForDate());
}

function normalizeScheduleDays(days: unknown[]) {
  return normalizeSchedule(days as Array<ScheduleDayDto | ExamSessionDto>);
}

export async function loadSchedule(group: GroupProfile): Promise<ScheduleState> {
  try {
    const staticState = await loadStaticSchedule(group);
    writeGroupScheduleCache(staticState);
    return staticState;
  } catch (error) {
    if (import.meta.env.PROD && import.meta.env.BASE_URL !== "/") {
      try {
        const archived = await fetchArchivedWorkerSnapshot(group.nrec);
        writeGroupScheduleCache(archived);
        return archived;
      } catch {
        throw error;
      }
    }
    // Снимка для этой группы ещё нет — пробуем прежние источники.
  }

  if (import.meta.env.PROD) {
    try {
      const snapshot = await fetchGroupScheduleSnapshot(group.nrec);
      writeGroupScheduleCache(snapshot);
      return snapshot;
    } catch (error) {
      if (error instanceof ApiResponseError && error.status >= 500) throw error;
      // Older Pages deployments do not expose the v2 endpoint yet.
    }
  }

  const fetchState = async (groupNrec: string) => {
    const currentInfoMetadata: RequestMetadata = {};
    const scheduleMetadata: RequestMetadata = {};
    const [currentInfo, allLessons] = await Promise.all([
      fetchCurrentInfo(groupNrec, currentInfoMetadata),
      fetchSchedule(groupNrec, scheduleMetadata)
    ]);
    return { groupNrec, currentInfo, allLessons, currentInfoMetadata, scheduleMetadata };
  };

  const resolved = await fetchState(group.nrec);
  const { currentInfoMetadata, scheduleMetadata, ...scheduleState } = resolved;
  const now = new Date().toISOString();
  const state: ScheduleState = {
    ...scheduleState,
    fetchedAt: scheduleMetadata.snapshotAt ?? now,
    weekTypeAsOf: currentInfoMetadata.snapshotAt ?? now
  };
  writeGroupScheduleCache(state);
  return state;
}

export function activeWeekMode(currentWeekType: 1 | 2): WeekMode {
  return currentWeekType === 1 ? "numerator" : "denominator";
}

export function lessonAppliesToWeek(lesson: LessonSlot, weekMode: WeekMode) {
  return lesson.weekMode === "all" || lesson.weekMode === weekMode;
}

export { PAIR_TIMES };
