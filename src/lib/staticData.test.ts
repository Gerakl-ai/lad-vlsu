import { beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeSchedule } from "./scheduleApi";
import { vlsuWeekModeForDate, vlsuWeekTypeForDate } from "./academicWeek";
import {
  catalogGroups,
  catalogInstitutes,
  fetchOfficialDocumentGroupIds,
  fetchOfficialDocumentLocation,
  fetchOcrScheduleCoverage,
  fetchStaticSnapshot,
  resetUniversityBundleCache,
  warmUniversityScheduleBundle,
  normalizeStaticCatalog,
  normalizeStaticSnapshot,
  normalizeStaticCoverage,
  resetStaticCatalogCache,
  normalizeCrawlStatus,
  normalizeProvenance,
  resetOfficialDocumentIndexCache,
  scheduleStateFromSnapshot,
  staticDataUrl
} from "./staticData";

describe("официальный документ группы", () => {
  it("показывает доступность только для датированных структурированных снимков", async () => {
    const nrec = "a".repeat(32);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      schemaVersion: 1,
      groups: {
        [nrec]: { validFrom: "2026-09-01", validThrough: "2026-12-30" },
        ["b".repeat(32)]: { validFrom: "2026-12-30", validThrough: "2026-09-01" }
      }
    }), { status: 200 })));
    expect(await fetchOcrScheduleCoverage()).toEqual({
      [nrec]: { validFrom: "2026-09-01", validThrough: "2026-12-30" }
    });
    vi.unstubAllGlobals();
  });

  it("находит координаты и принимает только ссылку ВлГУ", async () => {
    resetOfficialDocumentIndexCache();
    const nrec = "a".repeat(32);
    const payload = {
      schemaVersion: 1,
      period: "Осень 2026",
      groups: { [nrec]: { groupName: "ПИ-124", sourceId: "029", member: 1, page: 3, column: 5 } },
      sources: { "029": { title: "Приказ", url: "https://www.vlsu.ru/fileadmin/class-schedule/order.zip" } }
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchOfficialDocumentLocation(nrec)).toMatchObject({ page: 3, column: 5, title: "Приказ" });
    expect((await fetchOfficialDocumentGroupIds()).has(nrec)).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    payload.sources["029"].url = "https://example.com/archive.zip";
    resetOfficialDocumentIndexCache();
    expect(await fetchOfficialDocumentLocation(nrec)).toBeNull();
    vi.unstubAllGlobals();
    resetOfficialDocumentIndexCache();
  });

});

const HASH = "a".repeat(64);

const catalogPayload = {
  schemaVersion: 3,
  capturedAt: "2026-09-18T16:31:59.322Z",
  instituteCount: 1,
  groupCount: 3,
  institutes: [
    {
      id: "5b42fa53ec1dd1892e5ec44a3a60a896",
      name: "Институт информационных технологий и электроники",
      shortName: "ИИТЭ",
      groupCount: 3,
      groups: [
        { nrec: "7936a2a43b11b20b01d30f5b00c73166", name: "ПИ-124", course: "3 курс", forms: ["full-time"] },
        { nrec: "b".repeat(32), name: "ЗИС-123", course: "4 курс", forms: ["extramural"] },
        { nrec: "c".repeat(32), name: "ВИС-121", course: "5 курс", forms: ["part-time", "extramural"] }
      ]
    }
  ]
};

const snapshotPayload = {
  schemaVersion: 3,
  group: {
    nrec: "7936a2a43b11b20b01d30f5b00c73166",
    name: "ПИ-124",
    course: "3 курс",
    forms: ["full-time"],
    instituteId: "5b42fa53ec1dd1892e5ec44a3a60a896",
    instituteName: "Институт информационных технологий и электроники",
    instituteShortName: "ИИТЭ"
  },
  semester: 5,
  schedule: [
    {
      type: "Lessons",
      name: "Понедельник",
      n1: "111-3, лб, Старовойтов Е.А., Базы данных",
      z1: "119-3, лк, Шутов А.В., Базы данных"
    }
  ],
  quality: { valid: true, scheduleEntries: 1, lessonDays: 1, examEntries: 0, warnings: [] },
  scheduleHash: HASH,
  capturedAt: "2026-09-18T16:31:59.322Z"
};

beforeEach(() => {
  resetUniversityBundleCache();
  resetStaticCatalogCache();
});

describe("staticDataUrl", () => {
  it("строит путь от BASE_URL, чтобы работать в подкаталоге Pages", () => {
    expect(staticDataUrl("catalog.json")).toMatch(/\/data\/catalog\.json$/);
    expect(staticDataUrl("/schedule/abc.json")).toMatch(/\/data\/schedule\/abc\.json$/);
  });
});

describe("normalizeStaticCatalog", () => {
  it("читает каталог и отдаёт институты", () => {
    const catalog = normalizeStaticCatalog(catalogPayload);
    expect(catalog.groupCount).toBe(3);
    expect(catalogInstitutes(catalog)).toHaveLength(1);
  });

  it("отвергает каталог неизвестной версии", () => {
    expect(() => normalizeStaticCatalog({ ...catalogPayload, schemaVersion: 2 })).toThrow();
  });

  it("отбрасывает группы с испорченным идентификатором, не роняя каталог", () => {
    const broken = structuredClone(catalogPayload);
    broken.institutes[0].groups.push({ nrec: "нет", name: "X", course: null, forms: [] } as never);
    expect(normalizeStaticCatalog(broken).groupCount).toBe(3);
  });

  it("отдаёт группы всех форм обучения", () => {
    // Главная причина перехода: раньше в каталог попадала только очная форма.
    const groups = catalogGroups(normalizeStaticCatalog(catalogPayload), catalogPayload.institutes[0].id);
    expect(groups.map((group) => group.name)).toEqual(["ВИС-121", "ЗИС-123", "ПИ-124"]);
    expect(groups.find((group) => group.name === "ЗИС-123")?.forms).toEqual(["extramural"]);
  });
});

describe("normalizeStaticSnapshot", () => {
  it("uses the cached provisional schedule when the primary file is offline", async () => {
    const provisional = { ...snapshotPayload,
      validFrom: "2026-09-01", validThrough: "2026-12-30",
      extraction: { method: "ocr", status: "unreviewed", sourceUrl: "https://www.vlsu.ru/schedule.zip",
        sourcePdfSha256: HASH, member: 1, page: 1, column: 1, flaggedCells: 0 }
    };
    const fetchMock = vi.fn(async (url: string) => url.includes("/schedule/")
      ? new Response("", { status: 504 })
      : new Response(JSON.stringify(provisional), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await fetchStaticSnapshot(snapshotPayload.group.nrec)).extraction?.method).toBe("ocr");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it("принимает корректный снимок", () => {
    expect(normalizeStaticSnapshot(snapshotPayload, snapshotPayload.group.nrec).semester).toBe(5);
  });

  it("отвергает снимок чужой группы", () => {
    expect(() => normalizeStaticSnapshot(snapshotPayload, "d".repeat(32))).toThrow();
  });

  it("отвергает пустое расписание: это сбой, а не отсутствие занятий", () => {
    expect(() => normalizeStaticSnapshot({ ...snapshotPayload, schedule: [] }, snapshotPayload.group.nrec)).toThrow();
  });

  it("отвергает дни без пар, даже если качество в файле объявлено валидным", () => {
    expect(() => normalizeStaticSnapshot({
      ...snapshotPayload,
      schedule: [{ type: "Lessons", name: "Понедельник" }]
    }, snapshotPayload.group.nrec)).toThrow();
  });

  it("принимает расписание с экзаменом без обычных пар", () => {
    expect(normalizeStaticSnapshot({
      ...snapshotPayload,
      schedule: [{ type: "ExamSession", name: "Экзамен" }]
    }, snapshotPayload.group.nrec).schedule).toHaveLength(1);
  });

  it("rejects an undated or malformed reviewed PDF snapshot", () => {
    const sourceDocument = {
      title: "Расписание ИИТЭ",
      url: "https://www.vlsu.ru/example.zip",
      sha256: "a".repeat(64),
      reviewedAt: "2026-09-27T12:00:00Z"
    };
    expect(() => normalizeStaticSnapshot({ ...snapshotPayload, sourceDocument }, snapshotPayload.group.nrec)).toThrow();
    expect(() => normalizeStaticSnapshot({ ...snapshotPayload, sourceDocument,
      validFrom: "2026-09-01", validThrough: "2026-02-31" }, snapshotPayload.group.nrec)).toThrow();
    expect(normalizeStaticSnapshot({ ...snapshotPayload, sourceDocument,
      validFrom: "2026-09-01", validThrough: "2026-12-30" }, snapshotPayload.group.nrec).sourceDocument).toEqual(sourceDocument);
  });
});

describe("university offline bundle", () => {
  it("uses a bundled unvisited group when both individual files are unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("bundle.json")
      ? new Response(JSON.stringify({ schemaVersion: 1, groups: { [snapshotPayload.group.nrec]: snapshotPayload } }))
      : new Response("", { status: 504 })));
    expect((await fetchStaticSnapshot(snapshotPayload.group.nrec)).scheduleHash).toBe(HASH);
    vi.unstubAllGlobals();
  });

  it("never substitutes another group when the requested one is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("bundle.json")
      ? new Response(JSON.stringify({ schemaVersion: 1, groups: { ["d".repeat(32)]: snapshotPayload } }))
      : new Response("", { status: 504 })));
    await expect(fetchStaticSnapshot(snapshotPayload.group.nrec)).rejects.toThrow();
    vi.unstubAllGlobals();
  });

  it("rejects a wrong group identity even under the requested key", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("bundle.json")
      ? new Response(JSON.stringify({ schemaVersion: 1, groups: { [snapshotPayload.group.nrec]: { ...snapshotPayload, group: { ...snapshotPayload.group, nrec: "d".repeat(32) } } } }))
      : new Response("", { status: 504 })));
    await expect(fetchStaticSnapshot(snapshotPayload.group.nrec)).rejects.toThrow();
    vi.unstubAllGlobals();
  });

  it("retries a failed warmup and shares a successful download", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("Offline"))
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ schemaVersion: 1, groups: {} })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(warmUniversityScheduleBundle()).rejects.toThrow("Offline");
    await Promise.all([warmUniversityScheduleBundle(), warmUniversityScheduleBundle()]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
  });

  it("prefers the university package without downloading the legacy package", async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify({ schemaVersion: 1,
      groups: { [snapshotPayload.group.nrec]: snapshotPayload } })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await warmUniversityScheduleBundle()).toHaveProperty(snapshotPayload.group.nrec);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("university-schedule.json");
    vi.unstubAllGlobals();
  });
});

describe("normalizeStaticCoverage", () => {
  it("shows only groups with a valid dated snapshot entry", () => {
    const coverage = normalizeStaticCoverage({
      schemaVersion: 1,
      checkedAt: "2026-09-24T00:00:00Z",
      catalogGroups: 965,
      available: 2,
      groups: {
        [snapshotPayload.group.nrec]: { capturedAt: snapshotPayload.capturedAt, semester: 5, scheduleHash: HASH },
        broken: { capturedAt: "yesterday", semester: 5, scheduleHash: HASH }
      }
    });
    expect(coverage.available).toBe(1);
    expect(coverage.groups[snapshotPayload.group.nrec]?.semester).toBe(5);
  });
});

describe("scheduleStateFromSnapshot", () => {
  it("разбирает занятия и сохраняет происхождение данных", () => {
    const state = scheduleStateFromSnapshot(
      normalizeStaticSnapshot(snapshotPayload, snapshotPayload.group.nrec),
      (days) => normalizeSchedule(days as never),
      1,
      Date.parse("2026-09-18T17:31:59.322Z")
    );

    expect(state.source).toBe("static-snapshot");
    expect(state.contentHash).toBe(HASH);
    expect(state.snapshotAgeSeconds).toBe(3600);
    expect(state.currentInfo.name).toBe("ПИ-124, ИИТЭ");
    expect(state.allLessons).toHaveLength(2);
    expect(state.allLessons.map((lesson) => lesson.weekMode)).toEqual(["numerator", "denominator"]);
  });

  it("берёт тип недели снаружи, а не из снимка", () => {
    // Старый снимок не должен переворачивать неделю: её считает календарь.
    const snapshot = normalizeStaticSnapshot(snapshotPayload, snapshotPayload.group.nrec);
    const asNumerator = scheduleStateFromSnapshot(snapshot, (days) => normalizeSchedule(days as never), 1);
    const asDenominator = scheduleStateFromSnapshot(snapshot, (days) => normalizeSchedule(days as never), 2);
    expect(asNumerator.currentInfo.currentWeekType).toBe(1);
    expect(asDenominator.currentInfo.currentWeekType).toBe(2);
  });

  it("attaches the reviewed PDF period to weekly lessons", () => {
    const snapshot = normalizeStaticSnapshot({ ...snapshotPayload,
      validFrom: "2026-09-01", validThrough: "2026-12-30" }, snapshotPayload.group.nrec);
    const state = scheduleStateFromSnapshot(snapshot, (days) => normalizeSchedule(days as never), 1);
    expect(state.allLessons[0].validFrom).toBe("2026-09-01");
    expect(state.allLessons[0].validThrough).toBe("2026-12-30");
  });
});

describe("учебная неделя ВлГУ", () => {
  it("считает неделю с 1 сентября числителем", () => {
    expect(vlsuWeekModeForDate(new Date(2026, 8, 2))).toBe("numerator");
    expect(vlsuWeekTypeForDate(new Date(2026, 8, 2))).toBe(1);
  });

  it("переключает знаменатель на следующей неделе", () => {
    expect(vlsuWeekModeForDate(new Date(2026, 8, 9))).toBe("denominator");
    expect(vlsuWeekTypeForDate(new Date(2026, 8, 9))).toBe(2);
  });

  it("не зависит от того, когда снят снимок", () => {
    const spy = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2027-01-01T00:00:00Z"));
    expect(vlsuWeekModeForDate(new Date(2026, 8, 2))).toBe("numerator");
    spy.mockRestore();
  });
});

describe("происхождение снимка", () => {
  const valid = {
    repository: "Gerakl-ai/vlsu-pi-124-schedule",
    commit: "abc123",
    commitUrl: "https://github.com/Gerakl-ai/vlsu-pi-124-schedule/commit/abc123",
    runUrl: "https://github.com/Gerakl-ai/vlsu-pi-124-schedule/actions/runs/1"
  };

  it("читает ссылку на коммит", () => {
    expect(normalizeProvenance(valid)).toEqual(valid);
  });

  it("отвергает ссылку не по https", () => {
    // Ссылка ведёт наружу по нажатию пользователя, поэтому схема проверяется.
    expect(normalizeProvenance({ ...valid, commitUrl: "javascript:alert(1)" })).toBeNull();
    expect(normalizeProvenance({ ...valid, commitUrl: "http://example.com" })).toBeNull();
  });

  it("переживает снимок без происхождения", () => {
    // Снимок, собранный вручную, ссылок не имеет — это не ошибка.
    expect(normalizeProvenance(undefined)).toBeNull();
    expect(normalizeProvenance({ repository: "x" })).toBeNull();
  });

  it("отбрасывает недостоверную ссылку на запуск, сохраняя коммит", () => {
    const result = normalizeProvenance({ ...valid, runUrl: "ftp://example.com" });
    expect(result?.commitUrl).toBe(valid.commitUrl);
    expect(result?.runUrl).toBeNull();
  });
});

describe("отчёт об обходе", () => {
  it("читает сводку и сбои", () => {
    const status = normalizeCrawlStatus({
      startedAt: "2026-09-18T16:31:59.322Z",
      finishedAt: "2026-09-18T16:32:13.446Z",
      institutes: 14,
      groupsInCatalog: 966,
      scheduleAttempted: 966,
      scheduleOk: 940,
      scheduleFailed: 26,
      failures: [{ scope: "schedule", group: "ПИ-124", reason: "ВлГУ вернул пустой ответ" }]
    });
    expect(status.groupsInCatalog).toBe(966);
    expect(status.scheduleFailed).toBe(26);
    expect(status.failures[0].group).toBe("ПИ-124");
  });

  it("не падает на отчёте без необязательных полей", () => {
    const status = normalizeCrawlStatus({ startedAt: "2026-09-18T16:31:59.322Z" });
    expect(status.institutes).toBe(0);
    expect(status.failures).toEqual([]);
    expect(status.provenance).toBeNull();
  });

  it("отвергает отчёт без времени начала", () => {
    expect(() => normalizeCrawlStatus({})).toThrow();
  });
});
