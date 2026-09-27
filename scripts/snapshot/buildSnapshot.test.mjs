import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { collectCoverage, instituteShortName, isEmptyScheduleResponse, scheduleQuality, sha256, stableStringify } from "./buildSnapshot.mjs";
import { decodePayload, UpstreamError } from "./vlsuClient.mjs";

describe("stableStringify", () => {
  it("не зависит от порядка ключей", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it("сохраняет порядок массива: дни недели переставлять нельзя", () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });
});

describe("scheduleHash", () => {
  const schedule = [{ type: "Lessons", name: "Понедельник", n1: "111-3, лб, Иванов И.И., Базы данных" }];

  it("не меняется от текущей пары и времени снимка", () => {
    // Главное свойство: иначе git показывал бы изменение во всех группах
    // при каждом запуске обхода, а не реальную правку расписания.
    const first = sha256({ semester: 5, schedule });
    const second = sha256({ semester: 5, schedule });
    expect(first).toBe(second);
  });

  it("меняется, когда меняется расписание", () => {
    const changed = [{ ...schedule[0], n1: "119-3, лк, Петров П.П., Базы данных" }];
    expect(sha256({ semester: 5, schedule })).not.toBe(sha256({ semester: 5, schedule: changed }));
  });
});

describe("scheduleQuality", () => {
  it("отвергает пустой массив: это не «занятий нет», а сбой", () => {
    expect(scheduleQuality([])).toBeNull();
    expect(scheduleQuality("")).toBeNull();
  });

  it("отвергает массив с посторонними записями", () => {
    expect(scheduleQuality([{ type: "Lessons", name: "Понедельник" }, { foo: 1 }])).toBeNull();
  });

  it("считает дни и экзамены", () => {
    const quality = scheduleQuality([
      { type: "Lessons", name: "Понедельник", n1: "111-3, лб, Иванов И.И., Базы данных" },
      { type: "ExamSession", name: "Базы данных", date: "10.01.2027", time: "09:00", isConsultation: false }
    ]);
    expect(quality).toMatchObject({ valid: true, scheduleEntries: 2, lessonDays: 1, examEntries: 1 });
  });

  it("не публикует неделю без единого занятия", () => {
    const quality = scheduleQuality([{ type: "Lessons", name: "Понедельник", n1: "", z1: "" }]);
    expect(quality).toBeNull();
  });

  it("сохраняет экзаменационную сессию без недельных занятий", () => {
    const quality = scheduleQuality([
      { type: "Lessons", name: "Понедельник", n1: "", z1: "" },
      { type: "ExamSession", name: "Базы данных", date: "10.01.2027", time: "09:00", isConsultation: false }
    ]);
    expect(quality?.valid).toBe(true);
  });
});

describe("decodePayload", () => {
  it("разворачивает JSON, завёрнутый в JSON-строку", () => {
    expect(decodePayload('[{"Value":"a","Text":"b"}]')).toEqual([{ Value: "a", Text: "b" }]);
  });

  it("оставляет пустую строку как есть, чтобы она была распознана как сбой", () => {
    expect(decodePayload("")).toBe("");
  });
});

describe("outage probe", () => {
  it("recognizes only the known empty schedule response", () => {
    expect(isEmptyScheduleResponse(new UpstreamError("пустой ответ при HTTP 200", {
      status: 200, path: "/student/GetGroupSchedule"
    }))).toBe(true);
    expect(isEmptyScheduleResponse(new UpstreamError("пустой ответ при HTTP 200", {
      status: 200, path: "/catalogs/GetInstitutes"
    }))).toBe(false);
    expect(isEmptyScheduleResponse(new UpstreamError("HTTP 503", {
      status: 503, path: "/student/GetGroupSchedule"
    }))).toBe(false);
  });
});

describe("coverage manifest", () => {
  it("does not advertise an all-blank schedule even with a matching hash", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "lad-coverage-"));
    const nrec = "c".repeat(32);
    const schedule = [{ type: "Lessons", name: "Понедельник", n1: "", z1: "" }];
    try {
      await mkdir(path.join(root, "schedule"));
      await writeFile(path.join(root, "schedule", `${nrec}.json`), JSON.stringify({
        schemaVersion: 3, group: { nrec }, semester: 5, schedule,
        scheduleHash: sha256({ semester: 5, schedule }), capturedAt: "2026-09-08T10:00:00Z"
      }));
      const coverage = await collectCoverage(root, [{ groups: [{ nrec }] }]);
      expect(coverage.available).toBe(0);
    } finally {
      if (!path.resolve(root).startsWith(path.join(path.resolve(os.tmpdir()), "lad-coverage-"))) {
        throw new Error("Refusing to remove an unexpected test directory");
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it("advertises only valid files for current catalog groups", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "lad-coverage-"));
    const nrec = "a".repeat(32);
    const schedule = [{ type: "Lessons", name: "Понедельник", n1: "111-3, лб, Базы данных" }];
    try {
      await mkdir(path.join(root, "schedule"));
      await writeFile(path.join(root, "schedule", `${nrec}.json`), JSON.stringify({
        schemaVersion: 3,
        group: { nrec },
        semester: 5,
        schedule,
        scheduleHash: sha256({ semester: 5, schedule }),
        capturedAt: "2026-09-08T10:00:00Z"
      }));
      await writeFile(path.join(root, "schedule", `${"b".repeat(32)}.json`), "{}");

      const coverage = await collectCoverage(root, [{ groups: [{ nrec }, { nrec: "b".repeat(32) }] }]);
      expect(coverage.catalogGroups).toBe(2);
      expect(coverage.available).toBe(1);
      expect(coverage.groups[nrec]?.capturedAt).toBe("2026-09-08T10:00:00Z");
    } finally {
      if (!path.resolve(root).startsWith(path.join(path.resolve(os.tmpdir()), "lad-coverage-"))) {
        throw new Error("Refusing to remove an unexpected test directory");
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps a reviewed document period in coverage and rejects malformed dates", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "lad-coverage-"));
    const nrec = "d".repeat(32);
    const schedule = [{ type: "Lessons", name: "Понедельник", n1: "111-3, лб, Базы данных" }];
    const target = path.join(root, "schedule", `${nrec}.json`);
    const snapshot = {
      schemaVersion: 3, group: { nrec }, semester: 5, schedule,
      scheduleHash: sha256({ semester: 5, schedule }), capturedAt: "2026-09-27T12:00:00Z",
      validFrom: "2026-09-01", validThrough: "2026-12-30"
    };
    try {
      await mkdir(path.dirname(target));
      await writeFile(target, JSON.stringify(snapshot));
      const catalog = [{ groups: [{ nrec }] }];
      expect((await collectCoverage(root, catalog)).groups[nrec].validThrough).toBe("2026-12-30");
      await writeFile(target, JSON.stringify({ ...snapshot, validThrough: "2026-02-31" }));
      expect((await collectCoverage(root, catalog)).available).toBe(0);
    } finally {
      if (!path.resolve(root).startsWith(path.join(path.resolve(os.tmpdir()), "lad-coverage-"))) {
        throw new Error("Refusing to remove an unexpected test directory");
      }
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("instituteShortName", () => {
  it("разводит два юридических подразделения", () => {
    const law = instituteShortName("Юридический институт");
    const college = instituteShortName("Отделение среднего профессионального юридического образования");
    expect(law).toBe("ЮИ");
    expect(college).not.toBe(law);
  });

  it("узнаёт основные институты", () => {
    expect(instituteShortName("Институт информационных технологий и электроники")).toBe("ИИТЭ");
    expect(instituteShortName("Институт архитектуры, строительства и энергетики")).toBe("ИАС");
  });
});
