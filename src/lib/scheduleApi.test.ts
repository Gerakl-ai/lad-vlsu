import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeApiPayload, fetchArchivedWorkerSnapshot, loadGroups, loadInstitutes, loadSchedule, normalizeCachedSchedule, normalizeGroupScheduleSnapshot, normalizeSchedule, parseLessonText, type ExamSessionDto, type ScheduleDayDto } from "./scheduleApi";
import { LEGACY_PI124_GROUP } from "../features/groups/groupTypes";

const subgroupSlot = [
  "109-3, лб, Аджамиех С.М., Основы frontend разработки",
  "111-3, лб, Старовойтов Е.А., Алгоритмизация и программирование"
].join("\n");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("VLSU catalogs", () => {
  it("normalizes institutes from the public catalog", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([
      { Value: "5b42fa53ec1dd1892e5ec44a3a60a896", Text: "Институт информационных технологий и электроники" },
      { Value: "c22ac11fe7a7799355b1b90ba6957321", Text: "Гуманитарный институт" }
    ]), { status: 200, headers: { "Content-Type": "application/json" } })));

    const institutes = await loadInstitutes();

    expect(institutes).toHaveLength(2);
    expect(institutes.find((item) => item.id === "5b42fa53ec1dd1892e5ec44a3a60a896")).toMatchObject({
      name: "Институт информационных технологий и электроники",
      shortName: "ИИТЭ"
    });
  });

  it("normalizes and naturally sorts groups for an institute", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ value: [
      { Nrec: "b", Name: "ПИ-124", Course: "3 курс" },
      { Nrec: "a", Name: "ПИ-99", Course: "4 курс" }
    ] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const groups = await loadGroups("5b42fa53ec1dd1892e5ec44a3a60a896");

    expect(groups.map((group) => group.name)).toEqual(["ПИ-99", "ПИ-124"]);
    expect(groups[1]).toMatchObject({ nrec: "b", course: "3 курс" });
    expect(fetchMock).toHaveBeenCalledWith("/vlsu-api/student/GetStudGroups", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ Institut: "5b42fa53ec1dd1892e5ec44a3a60a896", WFormed: 0 })
    }));
  });
});

describe("decodeApiPayload", () => {
  it("unwraps JSON that the upstream API encoded as a string", () => {
    expect(decodeApiPayload('[{"type":"Lessons","name":"Понедельник"}]')).toEqual([
      { type: "Lessons", name: "Понедельник" }
    ]);
  });

  it("leaves ordinary text untouched", () => {
    expect(decodeApiPayload("НЕИЗВЕСТНО")).toBe("НЕИЗВЕСТНО");
  });
});

describe("parseLessonText", () => {
  it("parses a regular lesson into structured fields", () => {
    expect(parseLessonText("111-3, лк, Шутов А.В., Базы данных")).toEqual({
      subject: "Базы данных",
      room: "111-3",
      kind: "лк",
      teacher: "Шутов А.В.",
      variants: [{
        subject: "Базы данных",
        room: "111-3",
        kind: "лк",
        teacher: "Шутов А.В.",
        rawText: "111-3, лк, Шутов А.В., Базы данных"
      }]
    });
  });

  it("keeps simultaneous subgroup lessons separate", () => {
    const parsed = parseLessonText(subgroupSlot);

    expect(parsed.subject).toBe("Основы frontend разработки / Алгоритмизация и программирование");
    expect(parsed.room).toBe("109-3 / 111-3");
    expect(parsed.kind).toBe("лб");
    expect(parsed.teacher).toBe("Аджамиех С.М. / Старовойтов Е.А.");
    expect(parsed.variants).toHaveLength(2);
    expect(parsed.variants.map((variant) => variant.subject)).toEqual([
      "Основы frontend разработки",
      "Алгоритмизация и программирование"
    ]);
  });

  it("supports lessons without room and teacher metadata", () => {
    const parsed = parseLessonText("Элективные дисциплины по физической культуре и спорту");
    expect(parsed.subject).toBe("Элективные дисциплины по физической культуре и спорту");
    expect(parsed.room).toBeUndefined();
  });

  it.each(["лк", "лб", "пр"])("preserves the teacher when room is omitted: %s", (kind) => {
    const parsed = parseLessonText(`${kind}, Гундорова М.А., Финансы и кредит`);
    expect(parsed).toMatchObject({ kind, teacher: "Гундорова М.А.", subject: "Финансы и кредит" });
    expect(parsed.room).toBeUndefined();
  });

  it("preserves commas in subjects when room is omitted", () => {
    expect(parseLessonText("лк, Гундорова М.А., Финансы, кредит и банки").subject).toBe("Финансы, кредит и банки");
  });
});

describe("normalizeSchedule", () => {
  it("creates one all-week slot when numerator and denominator are equal", () => {
    const day: ScheduleDayDto = {
      type: "Lessons",
      name: "Пятница",
      n1: subgroupSlot,
      z1: subgroupSlot
    };

    const lessons = normalizeSchedule([day]);
    expect(lessons).toHaveLength(1);
    expect(lessons[0]).toMatchObject({
      dayIndex: 5,
      pairIndex: 1,
      weekMode: "all",
      subject: "Основы frontend разработки / Алгоритмизация и программирование"
    });
    expect(lessons[0].variants).toHaveLength(2);
  });

  it("keeps different numerator and denominator lessons separate", () => {
    const day: ScheduleDayDto = {
      type: "Lessons",
      name: "Вторник",
      n3: "111-3, лк, Шутов А.В., Базы данных",
      z3: "111-3, пр, Шутов А.В., Алгоритмизация и программирование"
    };

    const lessons = normalizeSchedule([day]);
    expect(lessons.map((lesson) => lesson.dayIndex)).toEqual([2, 2]);
    expect(lessons.map((lesson) => lesson.weekMode)).toEqual(["numerator", "denominator"]);
  });

  it("normalizes exam sessions without relying on pair indexes", () => {
    const session: ExamSessionDto = {
      type: "ExamSession",
      date: "20.07.2026",
      time: "09:00",
      isConsultation: false,
      name: "111-3, экз, Шутов А.В., Базы данных"
    };

    expect(normalizeSchedule([session])[0]).toMatchObject({
      date: "2026-07-20",
      start: "09:00",
      end: "10:30",
      subject: "Базы данных",
      scheduleKind: "exam"
    });
  });

  it("keeps lessons and exams when the API returns both", () => {
    const lessons = normalizeSchedule([
      { type: "Lessons", name: "Понедельник", n1: "111-3, лк, Шутов А.В., Базы данных" },
      { type: "ExamSession", date: "20.07.2026", time: "09:00", isConsultation: false, name: "Базы данных" }
    ]);
    expect(lessons.map((lesson) => lesson.scheduleKind)).toContain("exam");
    expect(lessons).toHaveLength(2);
  });

  it("repairs legacy cached lessons with merged subgroup text", () => {
    const cached = normalizeCachedSchedule({
      groupNrec: "group",
      currentInfo: { currentLesson: "", currentWeekType: 1, name: "ПИ-124", semester: 4 },
      fetchedAt: "2026-07-17T00:00:00.000Z",
      allLessons: [{
        id: "legacy",
        dayIndex: 5,
        dayName: "Пятница",
        pairIndex: 1,
        start: "08:30",
        end: "10:00",
        subject: "Основы frontend разработки 111-3, лб, Старовойтов Е.А., Алгоритмизация и программирование",
        room: "109-3",
        kind: "лб",
        rawText: subgroupSlot,
        weekMode: "all"
      }]
    });

    expect(cached?.allLessons[0].subject).toBe("Основы frontend разработки / Алгоритмизация и программирование");
    expect(cached?.allLessons[0].variants).toHaveLength(2);
    expect(cached?.weekTypeAsOf).toBe("2026-07-17T00:00:00.000Z");
    expect(cached?.source).toBe("device-cache");
    expect(cached).toMatchObject({ validFrom: "2026-02-01", validThrough: "2026-06-30", periodEstimated: true });
  });

  it("corrects a previously cached future spring estimate on startup", () => {
    const cached = normalizeCachedSchedule({
      groupNrec: "group",
      currentInfo: { currentLesson: "", currentWeekType: 1, name: "ПИ-124", semester: 6 },
      fetchedAt: "2026-10-05T10:00:00.000Z",
      validFrom: "2027-02-01", validThrough: "2027-06-30", periodEstimated: true,
      allLessons: [{ id: "legacy", dayIndex: 1, dayName: "Понедельник", pairIndex: 1,
        start: "08:30", end: "10:00", subject: "Базы данных", rawText: "Базы данных",
        weekMode: "all", validFrom: "2027-02-01", validThrough: "2027-06-30" }]
    });
    expect(cached).toMatchObject({ validFrom: "2026-02-01", validThrough: "2026-06-30",
      allLessons: [{ validFrom: "2026-02-01", validThrough: "2026-06-30" }] });
  });

  it("rejects a partial legacy cache instead of crashing application startup", () => {
    expect(normalizeCachedSchedule({
      groupNrec: "group",
      currentInfo: { currentWeekType: 1 },
      fetchedAt: "2026-09-16T04:00:00.000Z"
    })).toBeNull();
  });
});

describe("schedule snapshot v2", () => {
  const nrec = "7936a2a43b11b20b01d30f5b00c73166";
  const snapshot = {
    schemaVersion: 2,
    group: { nrec, name: "ПИ-124, ИИТЭ" },
    semester: 5,
    currentInfo: {
      CurrentLesson: "НЕИЗВЕСТНО",
      CurrentWeekType: 1,
      Name: "ПИ-124, ИИТЭ",
      CurrentSemester: 5
    },
    schedule: [{
      type: "Lessons",
      name: "Понедельник",
      n1: "111-3, лк, Шутов А.В., Базы данных",
      z1: "111-3, пр, Шутов А.В., Алгоритмизация и программирование"
    }],
    weekType: 1,
    weekTypeAsOf: "2026-09-16T04:00:00.000Z",
    scheduleFetchedAt: "2026-09-16T04:00:00.000Z",
    contentHash: "a".repeat(64),
    source: "live",
    ageSeconds: 0,
    requestId: "request-1",
    quality: { valid: true, scheduleEntries: 1, lessonDays: 1, examEntries: 0, warnings: [] }
  };

  it("normalizes one atomic schedule and week-type payload", () => {
    const state = normalizeGroupScheduleSnapshot(snapshot, nrec);

    expect(state.currentInfo.currentWeekType).toBe(1);
    expect(state.allLessons.map((lesson) => lesson.weekMode)).toEqual(["numerator", "denominator"]);
    expect(state).toMatchObject({
      schemaVersion: 2,
      source: "live",
      contentHash: "a".repeat(64),
      requestId: "request-1",
      validFrom: "2026-09-01",
      validThrough: "2026-12-31",
      periodEstimated: true
    });
  });

  it("rejects a snapshot whose semester or week type disagrees with current info", () => {
    expect(() => normalizeGroupScheduleSnapshot({ ...snapshot, weekType: 2 }, nrec)).toThrow("inconsistent");
    expect(() => normalizeGroupScheduleSnapshot({ ...snapshot, semester: 4 }, nrec)).toThrow("inconsistent");
  });

  it("rejects a snapshot with day names but no actual lessons", () => {
    expect(() => normalizeGroupScheduleSnapshot({
      ...snapshot,
      schedule: [{ type: "Lessons", name: "Понедельник" }]
    }, nrec)).toThrow("invalid schedule data");
  });

  it("loads a stored Worker snapshot from the configured HTTPS origin", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ...snapshot, source: "global-snapshot" }), {
      status: 200, headers: { "Content-Type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const state = await fetchArchivedWorkerSnapshot(nrec, "https://worker.example");
    expect(state.source).toBe("global-snapshot");
    expect(state.fetchedAt).toBe(snapshot.scheduleFetchedAt);
    expect(fetchMock).toHaveBeenCalledWith(`https://worker.example/app-api/schedule/${nrec}?cached=1`,
      expect.objectContaining({ credentials: "omit" }));
  });

  it("rejects missing or malformed archived snapshots", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    await expect(fetchArchivedWorkerSnapshot(nrec, "https://worker.example")).rejects.toThrow("404");
    await expect(fetchArchivedWorkerSnapshot(nrec, "http://worker.example")).rejects.toThrow("HTTPS");
    await expect(fetchArchivedWorkerSnapshot("not-a-group", "https://worker.example")).rejects.toThrow("unavailable");
  });

  it("uses a saved Worker copy when a Pages group has no static snapshot", async () => {
    vi.stubEnv("PROD", true);
    vi.stubEnv("BASE_URL", "/vlsu-pi-124-schedule/");
    vi.stubEnv("VITE_SCHEDULE_FALLBACK_URL", "https://worker.example");
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value)
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/data/schedule/")) return new Response("Not found", { status: 404 });
      if (url.includes("/data/ocr-schedule/")) return new Response("Not found", { status: 404 });
      if (url.includes("?cached=1")) {
        return new Response(JSON.stringify({ ...snapshot, source: "global-snapshot" }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const state = await loadSchedule(LEGACY_PI124_GROUP);
    expect(state.source).toBe("global-snapshot");
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("ocr-schedule/bundle.json"), expect.any(Object));
  });

  it("opens provisional OCR lessons through the ordinary schedule model", async () => {
    vi.stubEnv("PROD", true);
    vi.stubEnv("BASE_URL", "/vlsu-pi-124-schedule/");
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value)
    });
    const provisional = {
      schemaVersion: 3,
      group: { nrec, name: "ПИ-124", instituteShortName: "ИИТЭ" },
      semester: 5,
      schedule: [{ type: "Lessons", name: "Понедельник", n1: "111-3, лк, Шутов А.В., Базы данных" }],
      scheduleHash: "b".repeat(64),
      capturedAt: "2026-09-03T00:00:00Z",
      validFrom: "2026-09-01", validThrough: "2026-12-30",
      quality: { valid: true, scheduleEntries: 1, lessonDays: 1, examEntries: 0, warnings: ["ocr-unreviewed"] },
      extraction: { method: "ocr", status: "unreviewed", sourceUrl: "https://www.vlsu.ru/source.zip",
        sourcePdfSha256: "a".repeat(64), member: 1, page: 1, column: 1, flaggedCells: 0 }
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/data/schedule/")) return new Response("Not found", { status: 404 });
      if (url.includes("/data/ocr-schedule/")) return new Response(JSON.stringify(provisional), { status: 200 });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const state = await loadSchedule(LEGACY_PI124_GROUP);

    expect(state.source).toBe("pdf-ocr");
    expect(state.allLessons.some((lesson) => lesson.subject === "Базы данных")).toBe(true);
    expect(state.allLessons.every((lesson) => lesson.validThrough === "2026-12-30")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses a newer Worker copy over a static file when the UI already has a device snapshot", async () => {
    vi.stubEnv("PROD", true);
    vi.stubEnv("BASE_URL", "/vlsu-pi-124-schedule/");
    vi.stubEnv("VITE_SCHEDULE_FALLBACK_URL", "https://worker.example");
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value)
    });
    const staticSnapshot = {
      schemaVersion: 3,
      group: { nrec, name: "ПИ-124", instituteShortName: "ИИТЭ" },
      semester: 5,
      schedule: [{ type: "Lessons", name: "Понедельник", n1: "111-3, лк, Шутов А.В., Старая пара" }],
      scheduleHash: "b".repeat(64),
      capturedAt: "2026-09-08T12:00:00Z",
      quality: { valid: true, scheduleEntries: 1, lessonDays: 1, examEntries: 0, warnings: [] }
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/data/schedule/")) return new Response(JSON.stringify(staticSnapshot), { status: 200 });
      if (url.includes("?cached=1")) return new Response(JSON.stringify({ ...snapshot, source: "global-snapshot" }), { status: 200 });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const state = await loadSchedule(LEGACY_PI124_GROUP, true);

    expect(state.source).toBe("global-snapshot");
    expect(state.fetchedAt).toBe(snapshot.scheduleFetchedAt);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps subgroup assignments from the static snapshot when a newer Worker reverses only their order", async () => {
    vi.stubEnv("PROD", true);
    vi.stubEnv("BASE_URL", "/lad-vlsu/");
    vi.stubEnv("VITE_SCHEDULE_FALLBACK_URL", "https://worker.example");
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value)
    });
    const ai = "109-3, лб, Васильев Д.Н., Основы искусственного интеллекта";
    const architecture = "111-3, лб, Аджамиех С.М., Основы архитектуры и интеграции информационных систем";
    const staticSnapshot = {
      schemaVersion: 3,
      group: { nrec, name: "ПИ-124", instituteShortName: "ИИТЭ" },
      semester: 5,
      schedule: [{ type: "Lessons", name: "Вторник", z1: `${ai}\n${architecture}` }],
      scheduleHash: "b".repeat(64),
      capturedAt: "2026-10-01T12:00:00Z",
      quality: { valid: true, scheduleEntries: 1, lessonDays: 1, examEntries: 0, warnings: [] }
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/data/schedule/")) return new Response(JSON.stringify(staticSnapshot), { status: 200 });
      if (url.includes("?cached=1")) return new Response(JSON.stringify({
        ...snapshot,
        schedule: [{ type: "Lessons", name: "Вторник", z1: `${architecture}\n${ai}` }],
        scheduleFetchedAt: "2026-10-05T18:00:00Z"
      }), { status: 200 });
      throw new Error(`Unexpected request: ${url}`);
    }));

    const state = await loadSchedule(LEGACY_PI124_GROUP, true);
    const first = state.allLessons.find((item) => item.dayIndex === 2 && item.pairIndex === 1);
    expect(first?.variants?.map((variant) => variant.subject)).toEqual([
      "Основы искусственного интеллекта", "Основы архитектуры и интеграции информационных систем"
    ]);
    expect(state.fetchedAt).toBe("2026-10-05T18:00:00Z");
  });

  it("discovers an uncached Pages group through the Worker", async () => {
    vi.stubEnv("PROD", true);
    vi.stubEnv("BASE_URL", "/vlsu-pi-124-schedule/");
    vi.stubEnv("VITE_SCHEDULE_FALLBACK_URL", "https://worker.example");
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value)
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/data/schedule/")) return new Response("Not found", { status: 404 });
      if (url.includes("/data/ocr-schedule/")) return new Response("Not found", { status: 404 });
      if (url.includes("?cached=1")) return new Response("{}", { status: 404 });
      if (url.includes("?discover=1")) return new Response(JSON.stringify(snapshot), { status: 200 });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const state = await loadSchedule(LEGACY_PI124_GROUP);
    expect(state.source).toBe("live");
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(fetchMock).toHaveBeenCalledWith(`https://worker.example/app-api/schedule/${nrec}?discover=1`,
      expect.objectContaining({ credentials: "omit" }));
  });

  it("tries the local app endpoint when the archived Worker is unreachable", async () => {
    vi.stubEnv("PROD", true);
    vi.stubEnv("BASE_URL", "/vlsu-pi-124-schedule/");
    vi.stubEnv("VITE_SCHEDULE_FALLBACK_URL", "https://worker.example");
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value)
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/data/schedule/")) return new Response("Not found", { status: 404 });
      if (url.includes("/data/ocr-schedule/")) return new Response("Not found", { status: 404 });
      if (url.startsWith("https://worker.example/")) throw new TypeError("Network error");
      if (url.startsWith("/app-api/schedule/")) return new Response(JSON.stringify(snapshot), { status: 200 });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const state = await loadSchedule(LEGACY_PI124_GROUP);

    expect(state.source).toBe("live");
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
