import { describe, expect, it } from "vitest";

import { vlsuWeekModeForDate, weekStartForMode } from "./academicWeek";

describe("weekStartForMode", () => {
  const thursday = new Date(2026, 8, 24);

  it("keeps the current week when its mode matches", () => {
    const monday = weekStartForMode("denominator", thursday);
    expect([monday.getFullYear(), monday.getMonth(), monday.getDate()]).toEqual([2026, 8, 21]);
    expect(vlsuWeekModeForDate(monday)).toBe("denominator");
  });

  it("uses the next week for the opposite mode", () => {
    const monday = weekStartForMode("numerator", thursday);
    expect([monday.getFullYear(), monday.getMonth(), monday.getDate()]).toEqual([2026, 8, 28]);
    expect(vlsuWeekModeForDate(monday)).toBe("numerator");
  });

  it("does not move all-week or exam schedules", () => {
    expect(weekStartForMode("all", thursday).getDate()).toBe(21);
    expect(thursday.getDate()).toBe(24);
  });

  it("keeps the first autumn week when its Monday falls in August", () => {
    const firstSeptember = new Date(2020, 8, 1);
    expect(vlsuWeekModeForDate(new Date(2020, 7, 31))).toBe("numerator");
    const monday = weekStartForMode("numerator", firstSeptember);
    expect([monday.getFullYear(), monday.getMonth(), monday.getDate()]).toEqual([2020, 7, 31]);
  });

  it("does not pull the previous week into the new academic year", () => {
    expect(vlsuWeekModeForDate(new Date(2025, 7, 31))).toBe(
      vlsuWeekModeForDate(new Date(2025, 7, 25))
    );
    expect(vlsuWeekModeForDate(new Date(2026, 7, 31))).toBe("numerator");
    expect(vlsuWeekModeForDate(new Date(2026, 8, 1))).toBe("numerator");
  });
});
