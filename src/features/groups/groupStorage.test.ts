import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduleState } from "../../types";
import { LEGACY_PI124_GROUP, PI124_INSTITUTE_ID } from "./groupTypes";
import {
  readFavoriteGroups,
  readGroupScheduleCache,
  readKnownGroup,
  readRecentGroups,
  readSelectedGroup,
  toggleFavoriteGroup,
  writeGroupScheduleCache,
  writeSelectedGroup
} from "./groupStorage";

function storageMock() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
    clear: vi.fn(() => values.clear())
  };
}

describe("group storage", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", storageMock());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("migrates the legacy PI-124 cache without deleting it", () => {
    const schedule: ScheduleState = {
      groupNrec: LEGACY_PI124_GROUP.nrec,
      currentInfo: { currentLesson: "", currentWeekType: 1, name: "ПИ-124", semester: 5 },
      allLessons: [],
      fetchedAt: "2026-09-15T08:00:00.000Z"
    };
    localStorage.setItem("pi124.schedule.cache", JSON.stringify(schedule));

    expect(readSelectedGroup()).toEqual(LEGACY_PI124_GROUP);
    expect(readGroupScheduleCache(LEGACY_PI124_GROUP)).toEqual(schedule);
    expect(localStorage.getItem("pi124.schedule.cache")).toBeTruthy();
  });

  it("repairs an old selected PI-124 institute id without touching its schedule", () => {
    const oldProfile = { ...LEGACY_PI124_GROUP, instituteId: "iite", visualKey: "iite" };
    const schedule = { groupNrec: LEGACY_PI124_GROUP.nrec, fetchedAt: "2026-09-15T08:00:00.000Z" };
    localStorage.setItem("lad.selected-group.v2", JSON.stringify(oldProfile));
    localStorage.setItem(`lad.schedule.v2:${LEGACY_PI124_GROUP.nrec}`, JSON.stringify(schedule));

    expect(readSelectedGroup()).toEqual(LEGACY_PI124_GROUP);
    expect(readKnownGroup(LEGACY_PI124_GROUP.nrec, PI124_INSTITUTE_ID)).toEqual(LEGACY_PI124_GROUP);
    expect(localStorage.getItem(`lad.schedule.v2:${LEGACY_PI124_GROUP.nrec}`)).toBe(JSON.stringify(schedule));
  });

  it("keeps independent schedule snapshots for different groups", () => {
    const other = { ...LEGACY_PI124_GROUP, id: "other", nrec: "other", name: "ИВТ-101" };
    writeSelectedGroup(other);
    writeGroupScheduleCache({
      groupNrec: other.nrec,
      currentInfo: { currentLesson: "", currentWeekType: 2, name: other.name, semester: 1 },
      allLessons: [],
      fetchedAt: "2026-09-15T09:00:00.000Z"
    });

    expect(readSelectedGroup()).toEqual(other);
    expect(readGroupScheduleCache(other)?.currentInfo.name).toBe("ИВТ-101");
    expect(readGroupScheduleCache(LEGACY_PI124_GROUP)).toBeNull();
  });

  it("does not overwrite a newer device snapshot with an older publication", () => {
    const recent = {
      groupNrec: LEGACY_PI124_GROUP.nrec,
      currentInfo: { currentLesson: "", currentWeekType: 1 as const, name: "ПИ-124", semester: 5 },
      allLessons: [],
      fetchedAt: "2026-09-20T12:00:00Z"
    };
    writeGroupScheduleCache(recent);
    writeGroupScheduleCache({ ...recent, fetchedAt: "2026-09-08T12:00:00Z" });
    expect(readGroupScheduleCache(LEGACY_PI124_GROUP)?.fetchedAt).toBe(recent.fetchedAt);
    writeGroupScheduleCache({ ...recent, fetchedAt: "2026-09-21T12:00:00Z" });
    expect(readGroupScheduleCache(LEGACY_PI124_GROUP)?.fetchedAt).toBe("2026-09-21T12:00:00Z");
  });

  it("replaces a damaged cache entry even when its timestamp is newer", () => {
    const key = `lad.schedule.v2:${LEGACY_PI124_GROUP.nrec}`;
    localStorage.setItem(key, JSON.stringify({
      groupNrec: LEGACY_PI124_GROUP.nrec,
      fetchedAt: "2099-01-01T00:00:00Z",
      currentInfo: { name: "broken", currentWeekType: 1 },
      allLessons: [{ subject: "missing required fields" }]
    }));
    writeGroupScheduleCache({
      groupNrec: LEGACY_PI124_GROUP.nrec,
      currentInfo: { currentLesson: "", currentWeekType: 1, name: "ПИ-124", semester: 5 },
      allLessons: [],
      fetchedAt: "2026-09-28T08:00:00Z"
    });
    expect(readGroupScheduleCache(LEGACY_PI124_GROUP)?.fetchedAt).toBe("2026-09-28T08:00:00Z");
  });

  it("never displays a snapshot stored under another group's key", () => {
    const other = { ...LEGACY_PI124_GROUP, id: "other", nrec: "other", name: "ИВТ-101" };
    const schedule: ScheduleState = {
      groupNrec: LEGACY_PI124_GROUP.nrec,
      currentInfo: { currentLesson: "", currentWeekType: 1, name: "ПИ-124", semester: 5 },
      allLessons: [],
      fetchedAt: "2026-09-15T08:00:00.000Z"
    };
    localStorage.setItem("lad.schedule.v2:other", JSON.stringify(schedule));

    expect(readGroupScheduleCache(other)).toBeNull();
    expect(localStorage.getItem("lad.schedule.v2:other")).toBeTruthy();
  });

  it("does not migrate a legacy snapshot that belongs to another group", () => {
    const foreignSchedule: ScheduleState = {
      groupNrec: "other",
      currentInfo: { currentLesson: "", currentWeekType: 1, name: "ИВТ-101", semester: 1 },
      allLessons: [],
      fetchedAt: "2026-09-15T08:00:00.000Z"
    };
    localStorage.setItem("pi124.schedule.cache", JSON.stringify(foreignSchedule));

    expect(readGroupScheduleCache(LEGACY_PI124_GROUP)).toBeNull();
    expect(localStorage.getItem("pi124.schedule.cache")).toBeTruthy();
    expect(localStorage.getItem(`lad.schedule.v2:${LEGACY_PI124_GROUP.nrec}`)).toBeNull();
  });

  it("preserves a mismatched current PI-124 cache even when legacy data exists", () => {
    const key = `lad.schedule.v2:${LEGACY_PI124_GROUP.nrec}`;
    const mismatched = { groupNrec: "other", fetchedAt: "2026-09-15T08:00:00.000Z" };
    const old = { groupNrec: LEGACY_PI124_GROUP.nrec, fetchedAt: "2026-09-14T08:00:00.000Z" };
    localStorage.setItem(key, JSON.stringify(mismatched));
    localStorage.setItem("pi124.schedule.cache", JSON.stringify(old));

    expect(readGroupScheduleCache(LEGACY_PI124_GROUP)).toBeNull();
    expect(localStorage.getItem(key)).toBe(JSON.stringify(mismatched));
    expect(localStorage.getItem("pi124.schedule.cache")).toBe(JSON.stringify(old));
  });

  it("keeps recent and favorite groups as full offline profiles", () => {
    const other = { ...LEGACY_PI124_GROUP, id: "other", nrec: "other", name: "ИВТ-101" };
    writeSelectedGroup(other);
    toggleFavoriteGroup(other);

    expect(readRecentGroups()).toEqual([other]);
    expect(readFavoriteGroups()).toEqual([other]);
    expect(readKnownGroup("other", other.instituteId)).toEqual(other);
    expect(toggleFavoriteGroup(other)).toEqual([]);
  });
});
