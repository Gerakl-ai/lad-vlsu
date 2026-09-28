import { RELEASE_CHANNEL } from "./release";

interface WorkerVersionMetadata {
  id: string;
  tag?: string;
  timestamp: string;
}

interface KvNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  CF_VERSION_METADATA?: WorkerVersionMetadata;
  EDGE_CACHE?: Pick<Cache, "match" | "put">;
  SCHEDULE_SNAPSHOT?: KvNamespace;
}

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

const API_ORIGIN = "https://abiturient-api.vlsu.ru/api";
const UPSTREAM_TIMEOUT_MS = 8_500;
const EDGE_FRESH_WAIT_MS = 900;
const EDGE_CACHE_SECONDS = 30 * 24 * 60 * 60;
const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024;
const MAX_PROXY_BODY_BYTES = 16_384;
const ACTIVE_GROUPS_KEY = "v2:active-groups";
const MAX_ACTIVE_GROUPS = 48;
const REFRESH_BATCH_SIZE = 4;
const ACTIVE_GROUP_MAX_AGE_MS = 45 * 24 * 60 * 60 * 1000;
const ARCHIVE_READ_ORIGINS = new Set(["https://germanpolkin.ru", "https://gerakl-ai.github.io"]);

const allowedVlsuRoutes = new Map<string, "GET" | "POST">([
  ["catalogs/GetInstitutes", "GET"],
  ["student/GetStudGroups", "POST"],
  ["student/GetGroupCurrentInfo", "POST"],
  ["student/GetGroupSchedule", "POST"]
]);

interface ActiveGroupRecord {
  nrec: string;
  lastSeenAt: string;
}

function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}

function isAllowedArchiveRead(request: Request) {
  const origin = request.headers.get("Origin");
  return isSameOriginRequest(request) || (origin !== null && ARCHIVE_READ_ORIGINS.has(origin));
}

function responseWithPlatformHeaders(response: Response, env: Env, request: Request) {
  const headers = new Headers(response.headers);
  const url = new URL(request.url);
  const contentType = headers.get("Content-Type") ?? "";
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=(self), payment=(), usb=()");
  headers.set("X-Lad-Release", RELEASE_CHANNEL);
  if (url.pathname === "/sw.js" || contentType.includes("text/html")) {
    headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
  }
  if (env.CF_VERSION_METADATA?.id) {
    headers.set("X-Lad-Worker-Version", env.CF_VERSION_METADATA.id);
  }
  if (url.pathname.startsWith("/app-api/schedule/")
    && (url.searchParams.get("cached") === "1" || url.searchParams.get("discover") === "1")) {
    const origin = request.headers.get("Origin");
    if (origin && ARCHIVE_READ_ORIGINS.has(origin)) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.append("Vary", "Origin");
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function jsonResponse(payload: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

function methodNotAllowed(allowedMethod: string) {
  return jsonResponse({ error: "Method not allowed" }, 405, { Allow: allowedMethod });
}

function defaultEdgeCache() {
  if (typeof caches === "undefined") return undefined;
  return (caches as CacheStorage & { default?: Cache }).default;
}

function cacheBodyFingerprint(value = "") {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${value.length}-${(hash >>> 0).toString(16)}`;
}

function edgeCacheRequest(sourceUrl: URL, apiPath: string, body?: string) {
  const key = new URL(`/__edge-vlsu-cache/${apiPath}`, sourceUrl.origin);
  key.searchParams.set("query", sourceUrl.searchParams.toString());
  key.searchParams.set("body", cacheBodyFingerprint(body));
  return new Request(key, { method: "GET" });
}

interface GlobalSnapshotRecord {
  version: 1;
  storedAt: string;
  contentType: string;
  body: string;
}

interface CurrentInfoPayload {
  CurrentLesson: string;
  CurrentWeekType: 1 | 2;
  Name: string;
  CurrentSemester: number;
}

interface GroupSnapshotQuality {
  valid: true;
  scheduleEntries: number;
  lessonDays: number;
  examEntries: number;
  warnings: string[];
}

interface GroupScheduleSnapshotV2 {
  schemaVersion: 2;
  group: {
    nrec: string;
    name: string;
  };
  semester: number;
  currentInfo: CurrentInfoPayload;
  schedule: unknown[];
  weekType: 1 | 2;
  weekTypeAsOf: string;
  scheduleFetchedAt: string;
  storedAt: string;
  contentHash: string;
  quality: GroupSnapshotQuality;
}

type GroupSnapshotSource = "live" | "global-snapshot";

const GROUP_SNAPSHOT_PREFIX = "snapshot:v2";
const GROUP_SNAPSHOT_LATEST_PREFIX = "snapshot:v2:latest";

function globalSnapshotKey(sourceUrl: URL, apiPath: string, body?: string) {
  return `v1:${apiPath}:${cacheBodyFingerprint(`${sourceUrl.searchParams.toString()}|${body ?? ""}`)}`;
}

function validGroupNrec(value: string) {
  return /^[a-f\d]{32}$/i.test(value);
}

function groupSnapshotKey(nrec: string, semester: number) {
  return `${GROUP_SNAPSHOT_PREFIX}:${nrec}:${semester}`;
}

function groupSnapshotLatestKey(nrec: string) {
  return `${GROUP_SNAPSHOT_LATEST_PREFIX}:${nrec}`;
}

function requestId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function contentHash(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isCurrentInfoPayload(value: unknown): value is CurrentInfoPayload {
  return Boolean(value)
    && typeof value === "object"
    && typeof (value as CurrentInfoPayload).CurrentLesson === "string"
    && [1, 2].includes((value as CurrentInfoPayload).CurrentWeekType)
    && typeof (value as CurrentInfoPayload).Name === "string"
    && (value as CurrentInfoPayload).Name.trim().length > 0
    && Number.isInteger((value as CurrentInfoPayload).CurrentSemester)
    && (value as CurrentInfoPayload).CurrentSemester > 0;
}

function scheduleQuality(value: unknown): GroupSnapshotQuality | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const lessonDays = value.filter((item) => item && typeof item === "object" && (item as { type?: unknown }).type === "Lessons" && typeof (item as { name?: unknown }).name === "string").length;
  const examEntries = value.filter((item) => item && typeof item === "object" && (item as { type?: unknown }).type === "ExamSession" && typeof (item as { name?: unknown }).name === "string").length;
  if (lessonDays + examEntries !== value.length || lessonDays + examEntries === 0) return null;
  const hasLesson = value.some((item) => item?.type === "Lessons"
    && Array.from({ length: 8 }, (_, index) => index + 1)
      .some((pair) => String(item[`n${pair}`] ?? "").trim() || String(item[`z${pair}`] ?? "").trim()));
  if (lessonDays > 0 && !hasLesson && examEntries === 0) return null;
  return {
    valid: true,
    scheduleEntries: value.length,
    lessonDays,
    examEntries,
    warnings: []
  };
}

function isGroupSnapshotV2(value: unknown): value is GroupScheduleSnapshotV2 {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<GroupScheduleSnapshotV2>;
  const measuredQuality = scheduleQuality(snapshot.schedule);
  return snapshot.schemaVersion === 2
    && Boolean(snapshot.group)
    && typeof snapshot.group?.nrec === "string"
    && validGroupNrec(snapshot.group.nrec)
    && typeof snapshot.group?.name === "string"
    && Number.isInteger(snapshot.semester)
    && isCurrentInfoPayload(snapshot.currentInfo)
    && Array.isArray(snapshot.schedule)
    && Boolean(measuredQuality)
    && (snapshot.weekType === 1 || snapshot.weekType === 2)
    && typeof snapshot.weekTypeAsOf === "string"
    && !Number.isNaN(Date.parse(snapshot.weekTypeAsOf))
    && typeof snapshot.scheduleFetchedAt === "string"
    && !Number.isNaN(Date.parse(snapshot.scheduleFetchedAt))
    && typeof snapshot.storedAt === "string"
    && !Number.isNaN(Date.parse(snapshot.storedAt))
    && typeof snapshot.contentHash === "string"
    && /^[a-f\d]{64}$/i.test(snapshot.contentHash)
    && snapshot.quality?.valid === true
    && snapshot.quality.scheduleEntries === measuredQuality?.scheduleEntries
    && snapshot.quality.lessonDays === measuredQuality?.lessonDays
    && snapshot.quality.examEntries === measuredQuality?.examEntries;
}

function apiResponse(response: Response, source: "live" | "edge-cache" | "global-snapshot") {
  const headers = new Headers(response.headers);
  headers.delete("Access-Control-Allow-Origin");
  headers.delete("Access-Control-Allow-Credentials");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Lad-Data-Source", source);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function decodeSnapshotPayload(body: string): unknown {
  let payload: unknown = JSON.parse(body);
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) payload = JSON.parse(trimmed);
  }
  if (payload && typeof payload === "object" && "value" in payload) {
    const value = (payload as { value?: unknown }).value;
    if (Array.isArray(value)) return value;
  }
  return payload;
}

function isUsefulVlsuPayload(apiPath: string, payload: unknown) {
  if (apiPath === "student/GetGroupCurrentInfo") {
    return Boolean(payload)
      && typeof payload === "object"
      && [1, 2].includes((payload as { CurrentWeekType?: number }).CurrentWeekType ?? 0);
  }

  if (apiPath === "student/GetGroupSchedule") {
    return scheduleQuality(payload) !== null;
  }

  if (apiPath === "catalogs/GetInstitutes" || apiPath === "student/GetStudGroups") {
    return Array.isArray(payload) && payload.length > 0;
  }

  return false;
}

async function isUsefulSnapshotResponse(apiPath: string, response: Response) {
  if (!response.ok) return false;
  try {
    return isUsefulVlsuPayload(apiPath, decodeSnapshotPayload(await response.text()));
  } catch {
    return false;
  }
}

async function storeEdgeResponse(cache: Pick<Cache, "put"> | undefined, key: Request, response: Response, storedAt?: string) {
  if (!cache || !response.ok) return;
  const headers = new Headers(response.headers);
  headers.delete("Set-Cookie");
  headers.set("Cache-Control", `public, max-age=${EDGE_CACHE_SECONDS}`);
  headers.set("X-Lad-Snapshot-At", storedAt ?? headers.get("X-Lad-Snapshot-At") ?? new Date().toISOString());
  await cache.put(key, new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  }));
}

async function readGlobalSnapshot(kv: KvNamespace | undefined, key: string) {
  if (!kv) return undefined;
  const raw = await kv.get(key);
  if (!raw) return undefined;

  try {
    const record = JSON.parse(raw) as Partial<GlobalSnapshotRecord>;
    if (record.version !== 1
      || typeof record.storedAt !== "string"
      || Number.isNaN(new Date(record.storedAt).getTime())
      || typeof record.contentType !== "string"
      || typeof record.body !== "string") return undefined;
    JSON.parse(record.body);
    return new Response(record.body, {
      headers: {
        "Content-Type": record.contentType,
        "X-Lad-Snapshot-At": record.storedAt
      }
    });
  } catch {
    return undefined;
  }
}

async function storeGlobalSnapshot(kv: KvNamespace | undefined, key: string, response: Response, storedAt: string, apiPath: string) {
  if (!kv || !response.ok) return;
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_SNAPSHOT_BYTES) return;
  try {
    if (!isUsefulVlsuPayload(apiPath, decodeSnapshotPayload(body))) return;
  } catch {
    return;
  }

  const record: GlobalSnapshotRecord = {
    version: 1,
    storedAt,
    contentType: response.headers.get("Content-Type") || "application/json; charset=utf-8",
    body
  };
  await kv.put(key, JSON.stringify(record));
}

async function buildGroupSnapshotV2(
  nrec: string,
  currentInfo: CurrentInfoPayload,
  schedule: unknown[],
  scheduleFetchedAt: string,
  weekTypeAsOf: string
): Promise<GroupScheduleSnapshotV2> {
  const quality = scheduleQuality(schedule);
  if (!quality) throw new Error("Invalid schedule payload");
  const storedAt = new Date().toISOString();
  return {
    schemaVersion: 2,
    group: { nrec, name: currentInfo.Name.trim() },
    semester: currentInfo.CurrentSemester,
    currentInfo,
    schedule,
    weekType: currentInfo.CurrentWeekType,
    weekTypeAsOf,
    scheduleFetchedAt,
    storedAt,
    contentHash: await contentHash({
      groupNrec: nrec,
      semester: currentInfo.CurrentSemester,
      weekType: currentInfo.CurrentWeekType,
      currentLesson: currentInfo.CurrentLesson,
      schedule
    }),
    quality
  };
}

async function readGroupSnapshotV2(kv: KvNamespace | undefined, key: string) {
  if (!kv) return null;
  try {
    const raw = await kv.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isGroupSnapshotV2(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function readLatestGroupSnapshotV2(kv: KvNamespace | undefined, nrec: string) {
  if (!kv) return null;
  try {
    const key = await kv.get(groupSnapshotLatestKey(nrec));
    if (!key || !key.startsWith(`${GROUP_SNAPSHOT_PREFIX}:${nrec}:`)) return null;
    return readGroupSnapshotV2(kv, key);
  } catch {
    return null;
  }
}

async function storeGroupSnapshotV2(kv: KvNamespace | undefined, snapshot: GroupScheduleSnapshotV2) {
  if (!kv) return;
  const key = groupSnapshotKey(snapshot.group.nrec, snapshot.semester);
  const existing = await readGroupSnapshotV2(kv, key);
  if (existing && Date.parse(existing.scheduleFetchedAt) > Date.parse(snapshot.scheduleFetchedAt)) return;
  await kv.put(key, JSON.stringify(snapshot));
  await kv.put(groupSnapshotLatestKey(snapshot.group.nrec), key);
}

async function migrateLegacyGroupSnapshot(kv: KvNamespace | undefined, nrec: string) {
  if (!kv) return null;
  const sourceUrl = (apiPath: string) => new URL(`https://snapshot.internal/vlsu-api/${apiPath}`);
  const currentPath = "student/GetGroupCurrentInfo";
  const schedulePath = "student/GetGroupSchedule";
  const currentBody = JSON.stringify(nrec);
  const scheduleBody = JSON.stringify({ Nrec: nrec, WeekType: 0, WeekDays: "1,2,3,4,5,6" });
  const [currentResponse, scheduleResponse] = await Promise.all([
    readGlobalSnapshot(kv, globalSnapshotKey(sourceUrl(currentPath), currentPath, currentBody)),
    readGlobalSnapshot(kv, globalSnapshotKey(sourceUrl(schedulePath), schedulePath, scheduleBody))
  ]);
  if (!currentResponse || !scheduleResponse) return null;

  try {
    const currentInfo = decodeSnapshotPayload(await currentResponse.text());
    const schedule = decodeSnapshotPayload(await scheduleResponse.text());
    if (!isCurrentInfoPayload(currentInfo) || !Array.isArray(schedule) || !scheduleQuality(schedule)) return null;
    const snapshot = await buildGroupSnapshotV2(
      nrec,
      currentInfo,
      schedule,
      scheduleResponse.headers.get("X-Lad-Snapshot-At") ?? new Date().toISOString(),
      currentResponse.headers.get("X-Lad-Snapshot-At") ?? new Date().toISOString()
    );
    await storeGroupSnapshotV2(kv, snapshot).catch(() => undefined);
    return snapshot;
  } catch {
    return null;
  }
}

async function migrateEdgeGroupSnapshot(
  cache: Pick<Cache, "match"> | undefined,
  kv: KvNamespace | undefined,
  requestUrl: URL,
  nrec: string
) {
  if (!cache) return null;
  const currentPath = "student/GetGroupCurrentInfo";
  const schedulePath = "student/GetGroupSchedule";
  const sourceUrl = (apiPath: string) => new URL(`/vlsu-api/${apiPath}`, requestUrl.origin);
  const [currentResponse, scheduleResponse] = await Promise.all([
    cache.match(edgeCacheRequest(sourceUrl(currentPath), currentPath, JSON.stringify(nrec))).catch(() => undefined),
    cache.match(edgeCacheRequest(sourceUrl(schedulePath), schedulePath,
      JSON.stringify({ Nrec: nrec, WeekType: 0, WeekDays: "1,2,3,4,5,6" }))).catch(() => undefined)
  ]);
  if (!currentResponse || !scheduleResponse) return null;

  try {
    const capturedAt = (response: Response) => response.headers.get("X-Lad-Snapshot-At") ?? response.headers.get("Date");
    const scheduleAt = capturedAt(scheduleResponse);
    const currentAt = capturedAt(currentResponse);
    if (!scheduleAt || !currentAt || !Number.isFinite(Date.parse(scheduleAt)) || !Number.isFinite(Date.parse(currentAt))) {
      return null;
    }
    const currentInfo = decodeSnapshotPayload(await currentResponse.text());
    const schedule = decodeSnapshotPayload(await scheduleResponse.text());
    if (!isCurrentInfoPayload(currentInfo) || !Array.isArray(schedule) || !scheduleQuality(schedule)) return null;
    const snapshot = await buildGroupSnapshotV2(nrec, currentInfo, schedule, scheduleAt, currentAt);
    await storeGroupSnapshotV2(kv, snapshot).catch(() => undefined);
    return snapshot;
  } catch {
    return null;
  }
}

async function fetchGroupSnapshotV2(nrec: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  const requestedAt = new Date().toISOString();
  try {
    const [currentResponse, scheduleResponse] = await Promise.all([
      fetch(`${API_ORIGIN}/student/GetGroupCurrentInfo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nrec),
        signal: controller.signal
      }),
      fetch(`${API_ORIGIN}/student/GetGroupSchedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Nrec: nrec, WeekType: 0, WeekDays: "1,2,3,4,5,6" }),
        signal: controller.signal
      })
    ]);
    if (!currentResponse.ok || !scheduleResponse.ok) throw new Error("VLSU API request failed");
    const [currentText, scheduleText] = await Promise.all([currentResponse.text(), scheduleResponse.text()]);
    if (new TextEncoder().encode(currentText).byteLength + new TextEncoder().encode(scheduleText).byteLength > MAX_SNAPSHOT_BYTES) {
      throw new Error("VLSU schedule payload is too large");
    }
    const currentInfo = decodeSnapshotPayload(currentText);
    const schedule = decodeSnapshotPayload(scheduleText);
    if (!isCurrentInfoPayload(currentInfo) || !Array.isArray(schedule) || !scheduleQuality(schedule)) {
      throw new Error("VLSU schedule payload is invalid");
    }
    return buildGroupSnapshotV2(nrec, currentInfo, schedule, requestedAt, requestedAt);
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

function groupSnapshotResponse(snapshot: GroupScheduleSnapshotV2, source: GroupSnapshotSource, id: string) {
  const ageSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(snapshot.scheduleFetchedAt)) / 1000));
  return jsonResponse({
    ...snapshot,
    source,
    ageSeconds,
    requestId: id
  }, 200, {
    "X-Lad-Data-Source": source,
    "X-Lad-Snapshot-At": snapshot.scheduleFetchedAt,
    "X-Lad-Snapshot-Age": String(ageSeconds),
    "X-Lad-Content-Hash": snapshot.contentHash,
    "X-Lad-Request-Id": id,
    "X-Lad-Data-Quality": "valid"
  });
}

async function getGroupScheduleSnapshot(request: Request, env: Env, context?: WorkerExecutionContext) {
  const id = requestId();
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET, HEAD");
  const url = new URL(request.url);
  const cachedOnly = url.searchParams.get("cached") === "1";
  const discover = url.searchParams.get("discover") === "1";
  if (!((cachedOnly || discover) ? isAllowedArchiveRead(request) : isSameOriginRequest(request))) {
    return jsonResponse({ error: "Cross-origin request denied", requestId: id }, 403);
  }
  const match = url.pathname.match(/^\/app-api\/schedule\/([a-f\d]{32})\/?$/i);
  if (!match) return jsonResponse({ error: "Invalid group identifier", requestId: id }, 400);
  const nrec = match[1];

  const cached = await readLatestGroupSnapshotV2(env.SCHEDULE_SNAPSHOT, nrec)
    ?? await migrateLegacyGroupSnapshot(env.SCHEDULE_SNAPSHOT, nrec)
    ?? await migrateEdgeGroupSnapshot(env.EDGE_CACHE ?? defaultEdgeCache(), env.SCHEDULE_SNAPSHOT, url, nrec);
  if (cachedOnly) {
    return cached
      ? groupSnapshotResponse(cached, "global-snapshot", id)
      : jsonResponse({ error: "No saved schedule for this group", requestId: id }, 404);
  }
  const freshPromise = fetchGroupSnapshotV2(nrec);

  if (cached) {
    const quickFresh = await Promise.race([
      freshPromise.catch(() => null),
      wait(EDGE_FRESH_WAIT_MS)
    ]);
    if (quickFresh) {
      await storeGroupSnapshotV2(env.SCHEDULE_SNAPSHOT, quickFresh);
      await registerActiveGroup(env.SCHEDULE_SNAPSHOT, nrec);
      return groupSnapshotResponse(quickFresh, "live", id);
    }

    const backgroundRefresh = freshPromise
      .then((snapshot) => storeGroupSnapshotV2(env.SCHEDULE_SNAPSHOT, snapshot))
      .catch(() => undefined);
    const tracking = registerActiveGroup(env.SCHEDULE_SNAPSHOT, nrec).catch(() => undefined);
    if (context) {
      context.waitUntil(backgroundRefresh);
      context.waitUntil(tracking);
    } else {
      void backgroundRefresh;
      void tracking;
    }
    return groupSnapshotResponse(cached, "global-snapshot", id);
  }

  try {
    const fresh = await freshPromise;
    await Promise.all([
      storeGroupSnapshotV2(env.SCHEDULE_SNAPSHOT, fresh),
      registerActiveGroup(env.SCHEDULE_SNAPSHOT, nrec)
    ]);
    return groupSnapshotResponse(fresh, "live", id);
  } catch {
    return jsonResponse({ error: "VLSU schedule is temporarily unavailable", requestId: id }, 503, {
      "X-Lad-Request-Id": id
    });
  }
}

async function storeSuccessfulResponse(
  cache: Pick<Cache, "put"> | undefined,
  edgeKey: Request,
  kv: KvNamespace | undefined,
  snapshotKey: string,
  apiPath: string,
  response: Response
) {
  if (!await isUsefulSnapshotResponse(apiPath, response.clone())) return;
  const storedAt = new Date().toISOString();
  await Promise.all([
    storeEdgeResponse(cache, edgeKey, response.clone(), storedAt),
    storeGlobalSnapshot(kv, snapshotKey, response.clone(), storedAt, apiPath)
  ]);
}

function groupNrecFromScheduleBody(body?: string) {
  if (!body) return null;
  try {
    const payload = JSON.parse(body) as { Nrec?: unknown };
    return typeof payload.Nrec === "string" && /^[a-f\d]{32}$/i.test(payload.Nrec) ? payload.Nrec : null;
  } catch {
    return null;
  }
}

async function registerActiveGroup(kv: KvNamespace | undefined, nrec: string | null) {
  if (!kv || !nrec) return;
  let records: ActiveGroupRecord[] = [];
  try {
    const raw = await kv.get(ACTIVE_GROUPS_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    if (Array.isArray(parsed)) {
      records = parsed.filter((item): item is ActiveGroupRecord => Boolean(item)
        && typeof item === "object"
        && typeof (item as ActiveGroupRecord).nrec === "string"
        && typeof (item as ActiveGroupRecord).lastSeenAt === "string"
        && Date.now() - Date.parse((item as ActiveGroupRecord).lastSeenAt) <= ACTIVE_GROUP_MAX_AGE_MS);
    }
  } catch {
    records = [];
  }

  const now = new Date().toISOString();
  const next = [{ nrec, lastSeenAt: now }, ...records.filter((item) => item.nrec !== nrec)]
    .slice(0, MAX_ACTIVE_GROUPS);
  await kv.put(ACTIVE_GROUPS_KEY, JSON.stringify(next));
}

async function readActiveGroups(kv: KvNamespace | undefined) {
  if (!kv) return [];
  try {
    const raw = await kv.get(ACTIVE_GROUPS_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is ActiveGroupRecord => Boolean(item)
        && typeof item === "object"
        && typeof (item as ActiveGroupRecord).nrec === "string"
        && /^[a-f\d]{32}$/i.test((item as ActiveGroupRecord).nrec)
        && typeof (item as ActiveGroupRecord).lastSeenAt === "string"
        && Date.now() - Date.parse((item as ActiveGroupRecord).lastSeenAt) <= ACTIVE_GROUP_MAX_AGE_MS)
      .slice(0, MAX_ACTIVE_GROUPS);
  } catch {
    return [];
  }
}

async function refreshGroupSnapshots(env: Env, nrec: string) {
  try {
    const snapshot = await fetchGroupSnapshotV2(nrec);
    await storeGroupSnapshotV2(env.SCHEDULE_SNAPSHOT, snapshot);
  } catch {
    // The last valid snapshot remains authoritative when VLSU is unavailable.
  }
}

async function refreshGlobalScheduleSnapshots(env: Env) {
  if (!env.SCHEDULE_SNAPSHOT) return;
  const groups = await readActiveGroups(env.SCHEDULE_SNAPSHOT);
  for (let offset = 0; offset < groups.length; offset += REFRESH_BATCH_SIZE) {
    const batch = groups.slice(offset, offset + REFRESH_BATCH_SIZE);
    await Promise.allSettled(batch.map((group) => refreshGroupSnapshots(env, group.nrec)));
  }
}

function wait(milliseconds: number) {
  return new Promise<null>((resolve) => setTimeout(() => resolve(null), milliseconds));
}

async function readLimitedBody(request: Request, maximumBytes: number) {
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new RangeError("Payload too large");
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maximumBytes) {
    throw new RangeError("Payload too large");
  }
  return body;
}

function apiPreflight(request: Request, allowedMethod: string) {
  if (!isSameOriginRequest(request)) return jsonResponse({ error: "Cross-origin request denied" }, 403);
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": `${allowedMethod},OPTIONS`,
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400"
    }
  });
}

async function proxyVlsuApi(request: Request, env: Env, context?: WorkerExecutionContext) {
  const sourceUrl = new URL(request.url);
  const apiPath = sourceUrl.pathname.replace(/^\/vlsu-api\/?/, "").replace(/\/+$/, "");
  const allowedMethod = allowedVlsuRoutes.get(apiPath);

  if (!allowedMethod) return jsonResponse({ error: "VLSU route not found" }, 404);
  if (request.method === "OPTIONS") return apiPreflight(request, allowedMethod);
  if (!isSameOriginRequest(request)) return jsonResponse({ error: "Cross-origin request denied" }, 403);
  if (request.method !== allowedMethod) return methodNotAllowed(allowedMethod);

  let body: string | undefined;
  if (allowedMethod === "POST") {
    try {
      body = await readLimitedBody(request, MAX_PROXY_BODY_BYTES);
    } catch (error) {
      if (error instanceof RangeError) return jsonResponse({ error: "Payload too large" }, 413);
      return jsonResponse({ error: "Unable to read request" }, 400);
    }
  }

  const targetUrl = new URL(`${API_ORIGIN}/${apiPath}`);
  targetUrl.search = sourceUrl.search;
  const cache = env.EDGE_CACHE ?? defaultEdgeCache();
  const cacheKey = edgeCacheRequest(sourceUrl, apiPath, body);
  const snapshotKey = globalSnapshotKey(sourceUrl, apiPath, body);
  const requestedGroupNrec = apiPath === "student/GetGroupSchedule" ? groupNrecFromScheduleBody(body) : null;
  const trackGroup = () => {
    const tracking = registerActiveGroup(env.SCHEDULE_SNAPSHOT, requestedGroupNrec).catch(() => undefined);
    if (context) context.waitUntil(tracking);
    else void tracking;
  };
  const cachedPromise = cache?.match(cacheKey).catch(() => undefined);
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, UPSTREAM_TIMEOUT_MS);
  const freshPromise = fetch(targetUrl, {
    method: allowedMethod,
    headers: allowedMethod === "POST"
      ? { "Content-Type": request.headers.get("Content-Type") || "application/json" }
      : undefined,
    body,
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));
  const cachedCandidate = await cachedPromise;
  const cached = cachedCandidate && await isUsefulSnapshotResponse(apiPath, cachedCandidate.clone())
    ? cachedCandidate
    : undefined;

  if (cached) {
    const cachedAt = cached.headers.get("X-Lad-Snapshot-At")
      ?? cached.headers.get("Date")
      ?? new Date().toISOString();
    const globalSeed = storeGlobalSnapshot(env.SCHEDULE_SNAPSHOT, snapshotKey, cached.clone(), cachedAt, apiPath)
      .catch(() => undefined);
    const quickFresh = await Promise.race([
      freshPromise.then(async (response) => await isUsefulSnapshotResponse(apiPath, response.clone()) ? response : null, () => null),
      wait(EDGE_FRESH_WAIT_MS)
    ]);
    if (quickFresh?.ok) {
      trackGroup();
      const cacheWrite = storeSuccessfulResponse(cache, cacheKey, env.SCHEDULE_SNAPSHOT, snapshotKey, apiPath, quickFresh.clone());
      if (context) context.waitUntil(cacheWrite);
      else void cacheWrite.catch(() => undefined);
      return apiResponse(quickFresh, "live");
    }

    const backgroundRefresh = freshPromise
      .then((response) => storeSuccessfulResponse(cache, cacheKey, env.SCHEDULE_SNAPSHOT, snapshotKey, apiPath, response))
      .catch(() => undefined);
    if (context) {
      context.waitUntil(globalSeed);
      context.waitUntil(backgroundRefresh);
    } else {
      void globalSeed;
      void backgroundRefresh;
    }
    trackGroup();
    return apiResponse(cached, "edge-cache");
  }

  const globalSnapshotCandidate = await readGlobalSnapshot(env.SCHEDULE_SNAPSHOT, snapshotKey).catch(() => undefined);
  const globalSnapshot = globalSnapshotCandidate && await isUsefulSnapshotResponse(apiPath, globalSnapshotCandidate.clone())
    ? globalSnapshotCandidate
    : undefined;
  if (globalSnapshot) {
    const quickFresh = await Promise.race([
      freshPromise.then(async (response) => await isUsefulSnapshotResponse(apiPath, response.clone()) ? response : null, () => null),
      wait(EDGE_FRESH_WAIT_MS)
    ]);
    if (quickFresh?.ok) {
      trackGroup();
      const cacheWrite = storeSuccessfulResponse(cache, cacheKey, env.SCHEDULE_SNAPSHOT, snapshotKey, apiPath, quickFresh.clone());
      if (context) context.waitUntil(cacheWrite);
      else void cacheWrite.catch(() => undefined);
      return apiResponse(quickFresh, "live");
    }

    const snapshotAt = globalSnapshot.headers.get("X-Lad-Snapshot-At") ?? undefined;
    const edgeSeed = storeEdgeResponse(cache, cacheKey, globalSnapshot.clone(), snapshotAt);
    const backgroundRefresh = freshPromise
      .then((response) => storeSuccessfulResponse(cache, cacheKey, env.SCHEDULE_SNAPSHOT, snapshotKey, apiPath, response))
      .catch(() => undefined);
    if (context) {
      context.waitUntil(edgeSeed);
      context.waitUntil(backgroundRefresh);
    } else {
      void edgeSeed.catch(() => undefined);
      void backgroundRefresh;
    }
    trackGroup();
    return apiResponse(globalSnapshot, "global-snapshot");
  }

  try {
    const upstream = await freshPromise;
    if (upstream.ok && await isUsefulSnapshotResponse(apiPath, upstream.clone())) {
      trackGroup();
      const cacheWrite = storeSuccessfulResponse(cache, cacheKey, env.SCHEDULE_SNAPSHOT, snapshotKey, apiPath, upstream.clone());
      if (context) context.waitUntil(cacheWrite);
      else void cacheWrite.catch(() => undefined);
    }
    return apiResponse(upstream, "live");
  } catch {
    return timedOut
      ? jsonResponse({ error: "VLSU API timed out" }, 504)
      : jsonResponse({ error: "VLSU API unavailable" }, 502);
  }
}

function healthResponse(request: Request, env: Env) {
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET, HEAD");
  const version = env.CF_VERSION_METADATA;
  return jsonResponse({
    ok: true,
    release: RELEASE_CHANNEL,
    workerVersion: version?.id ?? null,
    workerTag: version?.tag ?? null,
    deployedAt: version?.timestamp ?? null,
    globalSnapshot: Boolean(env.SCHEDULE_SNAPSHOT)
  });
}

const worker = {
  scheduled(_controller: { cron: string; scheduledTime: number }, env: Env, context: WorkerExecutionContext) {
    context.waitUntil(refreshGlobalScheduleSnapshots(env));
  },

  async fetch(request: Request, env: Env, context?: WorkerExecutionContext) {
    const url = new URL(request.url);
    let response: Response;

    if (url.pathname.startsWith("/vlsu-api/")) {
      response = await proxyVlsuApi(request, env, context);
    } else if (url.pathname.startsWith("/app-api/schedule/")) {
      response = await getGroupScheduleSnapshot(request, env, context);
    } else if (url.pathname === "/app-api/health") {
      response = healthResponse(request, env);
    } else if (url.pathname.startsWith("/app-api/")) {
      response = jsonResponse({ error: "App API route not found" }, 404);
    } else if (url.pathname === "/index.html") {
      response = await env.ASSETS.fetch(new Request(new URL("/", request.url).toString(), request));
    } else {
      response = await env.ASSETS.fetch(request);
    }

    return responseWithPlatformHeaders(response, env, request);
  }
};

export default worker;
