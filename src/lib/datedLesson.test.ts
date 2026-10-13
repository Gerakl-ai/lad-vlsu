import { describe, expect, it } from "vitest";
import { isDatedLesson, type DatedLessonDto } from "./datedLesson";
import { normalizeSchedule } from "./scheduleApi";
import { selectDayLessons } from "./time";

const entry: DatedLessonDto = { type: "DatedLesson", date: "2026-02-02", start: "15:50", end: "19:10",
  name: "223-3, лк/пр, Преподаватель А.Б., Проверка источника" };

describe("dated classes", () => {
  it("keeps an explicit long interval and ordinary class metadata", () => {
    expect(isDatedLesson(entry)).toBe(true);
    expect(normalizeSchedule([entry])[0]).toMatchObject({ date: "2026-02-02", dayIndex: 1,
      start: "15:50", end: "19:10", scheduleKind: "classes", weekMode: "all", room: "223-3",
      teacher: "Преподаватель А.Б.", kind: "лк/пр", subject: "Проверка источника" });
  });

  it("does not repeat a dated class next week or turn it into an exam", () => {
    const lessons = normalizeSchedule([entry]);
    for (const mode of ["numerator", "denominator"] as const) {
      expect(selectDayLessons(lessons, 1, mode, new Date("2026-02-02T12:00:00"))).toHaveLength(1);
      expect(selectDayLessons(lessons, 1, mode, new Date("2026-02-09T12:00:00"))).toHaveLength(0);
    }
    expect(lessons[0].isConsultation).toBeUndefined();
  });

  it.each([
    { date: "2026-02-30" }, { date: "02.02.2026" }, { start: "24:00" }, { start: "15.50" },
    { end: "15:50" }, { end: "15:00" }, { name: " " }
  ])("rejects a malformed dated record: %j", (change) => {
    expect(isDatedLesson({ ...entry, ...change })).toBe(false);
  });

  it("preserves an unknown lesson type instead of guessing", () => {
    expect(normalizeSchedule([{ ...entry, name: "148-4, , Преподаватель А.Б., Проверка источника" }])[0])
      .toMatchObject({ kind: undefined, subject: "Проверка источника" });
  });

  it("keeps a printed assessment interval without assigning a default exam duration", () => {
    const assessment = { ...entry, start: "14:00", end: "15:30", scheduleKind: "exam" as const,
      name: "308-1, экз, Преподаватель А.Б., Иностранный язык" };
    expect(normalizeSchedule([assessment])[0]).toMatchObject({ scheduleKind: "exam", start: "14:00", end: "15:30" });
    expect(isDatedLesson({ ...entry, scheduleKind: "meeting" })).toBe(false);
  });

  it.each([null, ["exam"], { toString: "exam" }])("rejects a non-string assessment kind: %j", (scheduleKind) => {
    expect(isDatedLesson({ ...entry, scheduleKind })).toBe(false);
  });
});
