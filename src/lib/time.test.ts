import { describe, expect, it } from "vitest";
import { relativeDayLabel, selectDayLessons, selectedWeekModeForDate, vlsuWeekModeForDate, weekModeForDate, weekModeFromSnapshot } from "./time";
import { autumnTeachingWeekNumber } from "./academicWeek";
import { parseLessonText } from "./scheduleApi";
import type { LessonSlot } from "../types";

describe("relativeDayLabel", () => {
  it.each([
    ["2026-12-30T23:59:00", "Позавчера"],
    ["2026-12-31T23:59:00", "Вчера"],
    ["2027-01-01T23:59:00", "Сегодня"],
    ["2027-01-02T00:01:00", "Завтра"],
    ["2027-01-03T00:01:00", "Послезавтра"],
    ["2027-01-04T00:01:00", "Через 3 дня"],
    ["2026-12-28T00:01:00", "4 дня назад"],
    ["2027-02-01T00:01:00", "Через 31 день"]
  ])("labels %s across month/year boundaries", (target, expected) => {
    expect(relativeDayLabel(new Date(target), new Date("2027-01-01T00:01:00"))).toBe(expected);
  });
});

describe("weekModeForDate", () => {
  const base = new Date("2026-09-02T12:00:00");

  it("keeps the current mode inside the same week", () => {
    expect(weekModeForDate(new Date("2026-09-04T12:00:00"), "numerator", base)).toBe("numerator");
  });

  it("alternates modes for adjacent weeks in both directions", () => {
    expect(weekModeForDate(new Date("2026-09-09T12:00:00"), "numerator", base)).toBe("denominator");
    expect(weekModeForDate(new Date("2026-08-26T12:00:00"), "denominator", base)).toBe("numerator");
  });
});

describe("weekModeFromSnapshot", () => {
  it("advances a stale cached week type to the week being viewed", () => {
    expect(weekModeFromSnapshot(
      "denominator",
      "2026-09-09T13:40:00.000Z",
      new Date("2026-09-15T11:44:00")
    )).toBe("numerator");
  });

  it("keeps the reported type inside the snapshot week", () => {
    expect(weekModeFromSnapshot(
      "numerator",
      "2026-09-15T08:00:00.000Z",
      new Date("2026-09-18T12:00:00")
    )).toBe("numerator");
  });

  it("falls back to the reported type for legacy invalid timestamps", () => {
    expect(weekModeFromSnapshot("denominator", "invalid", new Date("2026-09-15T11:44:00"))).toBe("denominator");
  });
});

describe("selectedWeekModeForDate", () => {
  const now = new Date("2026-09-15T12:00:00");
  const nextWeek = new Date("2026-09-22T12:00:00");

  it("alternates the official current mode when navigating to another week", () => {
    expect(selectedWeekModeForDate(nextWeek, "numerator", "current", now)).toBe("denominator");
  });

  it("keeps an explicit numerator or denominator selection stable", () => {
    expect(selectedWeekModeForDate(nextWeek, "numerator", "numerator", now)).toBe("numerator");
    expect(selectedWeekModeForDate(nextWeek, "numerator", "denominator", now)).toBe("denominator");
  });
});

describe("vlsuWeekModeForDate", () => {
  it("uses the week containing September 1 as numerator", () => {
    expect(vlsuWeekModeForDate(new Date("2026-09-01T12:00:00"))).toBe("numerator");
    expect(vlsuWeekModeForDate(new Date("2026-09-06T12:00:00"))).toBe("numerator");
  });

  it("alternates official VLSU week modes without relying on stale API timestamps", () => {
    expect(vlsuWeekModeForDate(new Date("2026-09-09T12:00:00"))).toBe("denominator");
    expect(vlsuWeekModeForDate(new Date("2026-09-16T12:00:00"))).toBe("numerator");
  });
});

describe("autumn teaching week restrictions", () => {
  const date = (value: string) => new Date(`${value}T12:00:00`);
  const lesson = (rawText: string): LessonSlot => ({
    id: rawText,
    dayIndex: 3,
    dayName: "Среда",
    pairIndex: 1,
    start: "08:30",
    end: "10:00",
    rawText,
    weekMode: "all",
    ...parseLessonText(rawText)
  });

  it("counts September 1 as week one using calendar dates", () => {
    expect(autumnTeachingWeekNumber(date("2026-09-01"))).toBe(1);
    expect(autumnTeachingWeekNumber(date("2026-09-23"))).toBe(4);
    expect(autumnTeachingWeekNumber(date("2026-11-04"))).toBe(10);
    expect(autumnTeachingWeekNumber(date("2026-12-23"))).toBe(17);
    expect(autumnTeachingWeekNumber(date("2027-02-03"))).toBeNull();
  });

  it("hides lessons marked for weeks 10 through 16 outside that range", () => {
    const restricted = lesson("111-3, лб, Старовойтов Е.А., Базы данных (с 10 по 16 нед)");
    expect(selectDayLessons([restricted], 3, "all", date("2026-09-23"))).toHaveLength(0);
    expect(selectDayLessons([restricted], 3, "all", date("2026-11-04"))).toHaveLength(1);
    expect(selectDayLessons([restricted], 3, "all", date("2026-12-23"))).toHaveLength(0);
  });

  it("retains an unrestricted variant when another begins later", () => {
    const mixed = lesson("111-3, лб, Старовойтов Е.А., Базы данных (с 10 нед)\n119-3, пр, Галкин А.А., Методы оптимизации");
    const [visible] = selectDayLessons([mixed], 3, "all", date("2026-09-23"));
    expect(visible.subject).toBe("Методы оптимизации");
    expect(visible.variants).toHaveLength(1);
    expect(selectDayLessons([mixed], 3, "all", date("2026-11-04"))[0].variants).toHaveLength(2);
  });

  it("does not repeat a PDF semester outside its document period", () => {
    const dated = { ...lesson("111-3, лб, Базы данных"), validFrom: "2026-09-01", validThrough: "2026-12-30" };
    expect(selectDayLessons([dated], 3, "all", date("2026-08-26"))).toHaveLength(0);
    expect(selectDayLessons([dated], 3, "all", date("2026-09-23"))).toHaveLength(1);
    expect(selectDayLessons([dated], 3, "all", date("2027-02-03"))).toHaveLength(0);
  });

  it("switches subject variants at the printed week boundary", () => {
    const mixed = lesson("111-3, лк, Иванов И.И., Механика (по 8 нед)\n111-3, лк, Петров П.П., Машины (с 9 нед)");
    expect(selectDayLessons([mixed], 3, "all", date("2026-10-21"))[0].subject).toBe("Механика (по 8 нед)");
    expect(selectDayLessons([mixed], 3, "all", date("2026-10-28"))[0].subject).toBe("Машины (с 9 нед)");
  });

  it("shows a listed teaching week without filling the intervening weeks", () => {
    const restricted = lesson("111-3, лб, Иванов И.И., Дисциплина (2 нед, 6 нед, 10 нед, 14 нед)");
    expect(selectDayLessons([restricted], 3, "all", date("2026-09-09"))).toHaveLength(1);
    expect(selectDayLessons([restricted], 3, "all", date("2026-09-23"))).toHaveLength(0);
  });
});
