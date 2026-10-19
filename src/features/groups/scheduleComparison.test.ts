import { describe, expect, it } from "vitest";
import type { LessonSlot, ScheduleState } from "../../types";
import { compareDayRows, compareScheduleDays, comparisonDay, comparisonLessonCount, type ComparisonDay } from "./scheduleComparison";

const lesson = (id: string, start: string, end?: string): LessonSlot => ({ id, start, end, dayIndex: 2, dayName: "Вторник", pairIndex: 1,
  subject: id, rawText: id, weekMode: "all", ...(!end ? { timeStatus: "unconfirmed" } : {}) });
const day = (...lessons: LessonSlot[]): ComparisonDay => ({ availability: "ready", lessons });
const state = (lessons: LessonSlot[]): ScheduleState => ({ groupNrec: "a", allLessons: lessons, currentInfo: { currentLesson: "", currentWeekType: 2, semester: 5, name: "A" },
  fetchedAt: "2026-10-06T10:00:00Z", validFrom: "2026-09-01", validThrough: "2026-12-31" });

describe("schedule comparison", () => {
  it("aligns classes by pair and time, distinguishing shared subject, room and building", () => {
    const left = day(
      { ...lesson("one", "08:30", "10:00"), subject: "Базы данных", room: "120-3" },
      { ...lesson("two", "10:20", "11:50"), pairIndex: 2, room: "120-3" },
      { ...lesson("three", "12:10", "13:40"), pairIndex: 3, room: "111-3" }
    );
    const right = day(
      { ...lesson("other", "08:30", "10:00"), subject: "Базы данных", room: "999-1" },
      { ...lesson("four", "10:20", "11:50"), pairIndex: 2, room: "120-3" },
      { ...lesson("five", "12:10", "13:40"), pairIndex: 3, room: "210-3" },
      { ...lesson("six", "14:00", "15:30"), pairIndex: 4 }
    );
    expect(compareDayRows(left, right).map((row) => row.match)).toEqual(["same-subject", "same-room", "same-building", "one-sided"]);
  });
  it("does not assert a match for subgroup alternatives, unknown times or unavailable days", () => {
    const variants = { ...lesson("A", "08:30", "10:00"), variants: [{ subject: "ИИ", rawText: "ИИ" }, { subject: "Архитектура", rawText: "Архитектура" }] };
    expect(compareDayRows(day(variants), day(lesson("A", "08:30", "10:00")))[0].match).toBe("uncertain");
    expect(compareDayRows(day(lesson("A", "08:30")), day(lesson("A", "08:30", "10:00")))[0].match).toBe("uncertain");
    expect(compareDayRows({ availability: "missing", lessons: [] }, day())).toEqual([]);
  });
  it("labels the number of classes without broken declensions", () => {
    expect([1, 2, 5, 11, 21].map(comparisonLessonCount)).toEqual(["1 занятие", "2 занятия", "5 занятий", "11 занятий", "21 занятие"]);
  });
  it("merges overlapping, nested and adjacent lessons without inventing gaps", () => {
    const result = compareScheduleDays(day(lesson("a", "08:30", "10:00"), lesson("b", "09:00", "09:30")),
      day(lesson("c", "09:30", "11:00"), lesson("d", "11:00", "12:00"), lesson("e", "15:00", "16:00")));
    expect(result.windows).toEqual([{ start: "08:00", end: "08:30", minutes: 30 }, { start: "12:00", end: "15:00", minutes: 180 }, { start: "16:00", end: "20:00", minutes: 240 }]);
    expect([...result.leftOverlaps]).toEqual(["a"]);
    expect([...result.rightOverlaps]).toEqual(["c"]);
  });
  it("clips to the stated range, counts 20 minutes and ignores shorter gaps", () => {
    expect(compareScheduleDays(day(lesson("a", "07:00", "08:10"), lesson("b", "08:30", "19:50")), day()).windows)
      .toEqual([{ start: "08:10", end: "08:30", minutes: 20 }]);
    expect(compareScheduleDays(day(lesson("a", "07:00", "21:00")), day()).windows).toEqual([]);
  });
  it("does not count touching ends as a collision", () => {
    const result = compareScheduleDays(day(lesson("a", "08:30", "10:00")), day(lesson("b", "10:00", "11:00")));
    expect(result.leftOverlaps.size).toBe(0);
  });
  it("shows an empty verified day as free, but never missing data", () => {
    expect(compareScheduleDays(day(), day()).windows).toEqual([{ start: "08:00", end: "20:00", minutes: 720 }]);
    for (const availability of ["missing", "outside-period"] as const) {
      expect(compareScheduleDays(day(), { availability, lessons: [] })).toMatchObject({ windows: null, reason: "missing" });
    }
  });
  it("refuses exact windows when a lesson end is unconfirmed", () => {
    expect(compareScheduleDays(day(lesson("a", "16:00")), day())).toMatchObject({ windows: null, reason: "unconfirmed" });
  });
  it("uses the academic calendar for classes, ignoring a stale or conflicting API week anchor", () => {
    const a = state([{ ...lesson("ИИ", "08:30", "10:00"), weekMode: "denominator" }, { ...lesson("Архитектура", "08:30", "10:00"), weekMode: "numerator" }]);
    expect(comparisonDay(a, new Date(2026, 9, 6)).lessons.map((item) => item.subject)).toEqual(["ИИ"]);
    expect(comparisonDay(a, new Date(2026, 9, 13)).lessons.map((item) => item.subject)).toEqual(["Архитектура"]);
    const b = { ...a, currentInfo: { ...a.currentInfo, currentWeekType: 1 as const }, fetchedAt: "2026-10-01T10:00:00Z" };
    expect(comparisonDay(b, new Date(2026, 9, 6)).lessons.map((item) => item.subject)).toEqual(["ИИ"]);
    expect(comparisonDay(b, new Date(2026, 9, 13)).lessons.map((item) => item.subject)).toEqual(["Архитектура"]);
  });
  it("keeps explicit dates, period boundaries and uncertainty", () => {
    const a = state([{ ...lesson("Сессия", "16:00"), date: "2026-10-06", scheduleKind: "exam" }]);
    expect(comparisonDay(a, new Date(2026, 9, 6)).lessons).toHaveLength(1);
    expect(comparisonDay(a, new Date(2026, 9, 7)).availability).toBe("ready");
    expect(comparisonDay(a, new Date(2027, 0, 1)).availability).toBe("outside-period");
    expect(comparisonDay({ ...a, validFrom: undefined, validThrough: undefined }, new Date(2026, 9, 7)).availability).toBe("outside-period");
    expect(comparisonDay(null, new Date()).availability).toBe("missing");
  });
  it("uses a subject choice without mutating the source or dropping teaching-week restrictions", () => {
    const a = state([{ ...lesson("a", "08:30", "10:00"), variants: [
      { subject: "ИИ", rawText: "ИИ" }, { subject: "Архитектура", rawText: "Архитектура" }
    ] }]);
    const selected = comparisonDay(a, new Date(2026, 9, 6), () => 1);
    expect(selected.lessons[0].subject).toBe("Архитектура");
    expect(a.allLessons[0].subject).toBe("a");
    expect(comparisonDay(a, new Date(2026, 9, 4)).lessons).toEqual([]);
  });
});
