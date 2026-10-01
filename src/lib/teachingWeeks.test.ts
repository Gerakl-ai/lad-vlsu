import { describe, expect, it } from "vitest";
import { appliesToTeachingWeek, teachingWeekRestriction } from "./teachingWeeks";

describe("printed teaching week restrictions", () => {
  it("includes the last week and stops after it", () => {
    expect(appliesToTeachingWeek("Дисциплина (по 8 нед)", 8)).toBe(true);
    expect(appliesToTeachingWeek("Дисциплина (по 8 нед)", 9)).toBe(false);
  });
  it("keeps the gaps in an explicit list of weeks", () => {
    for (const week of [2, 6, 10, 14]) expect(appliesToTeachingWeek("Пара (2 нед, 6 нед, 10 нед, 14 нед)", week)).toBe(true);
    for (const week of [1, 4, 8, 12, 16]) expect(appliesToTeachingWeek("Пара (2 нед, 6 нед, 10 нед, 14 нед)", week)).toBe(false);
  });
  it("handles a single week", () => {
    expect(appliesToTeachingWeek("Пара (13 нед)", 13)).toBe(true);
    expect(appliesToTeachingWeek("Пара (13 нед)", 12)).toBe(false);
  });
  it("handles a list combined with an open range", () => {
    expect(appliesToTeachingWeek("Пара (12 нед, с 16 нед)", 12)).toBe(true);
    expect(appliesToTeachingWeek("Пара (12 нед, с 16 нед)", 14)).toBe(false);
    expect(appliesToTeachingWeek("Пара (12 нед, с 16 нед)", 17)).toBe(true);
  });
  it("accepts compact printing and Latin c from recognition", () => {
    expect(appliesToTeachingWeek("Пара (с9по 15 нед)", 16)).toBe(false);
    expect(appliesToTeachingWeek("Пара (c 9 нед)", 8)).toBe(false);
    expect(appliesToTeachingWeek("Пара (2. нед, 4 нед)", 4)).toBe(true);
  });
  it("does not apply one subject's range to a merged source cell", () => {
    const raw = "Механика (по 6 нед) Строительные машины (с 7 по 10 нед)";
    expect(teachingWeekRestriction(raw).status).toBe("ambiguous");
    expect(appliesToTeachingWeek(raw, 8)).toBe(true);
  });
  it("does not mistake a teacher's period for the whole subject", () => {
    expect(teachingWeekRestriction("Пара (Киласханова Р.М. с 8 нед.)").status).toBe("unsupported");
  });
  it("retains unfamiliar or invalid expressions for review", () => {
    for (const suffix of ["(110 6 нед)", "(с 16 по 9 нед)", "(0 нед)"]) {
      expect(teachingWeekRestriction(`Пара ${suffix}`).status).toBe("unsupported");
    }
  });
  it("does not match the word inside a discipline name", () => {
    expect(teachingWeekRestriction("Безопасность жизнедеятельности").status).toBe("unrestricted");
  });
});
