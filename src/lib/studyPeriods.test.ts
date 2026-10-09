import { describe, expect, it } from "vitest";
import catalog from "../../public/data/catalog.json";
import reviewed from "../data/studyPeriods.json";
import { groupStudyCalendar, studyPeriodRange, studyPeriodsOnDate, visibleStudyPeriods } from "./studyPeriods";
import { schedulePeriodContains } from "./schedulePeriod";

describe("официальный учебный календарь", () => {
  it("сопоставляет каждую сверенную группу с каталогом и источником", () => {
    const known = catalog.institutes.flatMap((institute) => institute.groups);
    expect(reviewed.groups).toHaveLength(14);
    expect(new Set(reviewed.groups.map((group) => group.nrec)).size).toBe(14);
    for (const group of reviewed.groups) {
      expect(known.find((entry) => entry.nrec === group.nrec)?.name).toBe(group.name);
      const source = reviewed.sources[group.sourceId as keyof typeof reviewed.sources];
      expect(source.url).toMatch(/^https:\/\/uu\.vlsu\.ru\/images\/stories\/Files\//);
      expect(source.sha256).toMatch(/^[a-f\d]{64}$/);
      for (const period of group.periods) {
        expect(["session", "practice", "final"]).toContain(period.kind);
        expect(period.start <= period.end).toBe(true);
        for (const date of [period.start, period.end]) {
          expect(new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10)).toBe(date);
          expect(date >= "2026-09-01" && date <= "2027-08-31").toBe(true);
        }
      }
    }
  });

  it("показывает практику, текущую сессию и ближайшие периоды без потери архива", () => {
    const calendar = groupStudyCalendar("b7348799e3b73ea57b363d1edcf9a30a")!;
    expect(visibleStudyPeriods(calendar.periods, "2026-11-20")[0].kind).toBe("practice");
    expect(visibleStudyPeriods(calendar.periods, "2027-01-15")[0].start).toBe("2027-01-11");
    expect(visibleStudyPeriods(calendar.periods, "2027-09-01")).toHaveLength(3);
    expect(studyPeriodRange(calendar.periods[1])).toBe("11 января 2027 - 30 января 2027");
    expect(groupStudyCalendar("unknown")).toBeNull();
  });

  it("включает обе границы сессии и не переносит её на соседний день", () => {
    const periods = groupStudyCalendar("751fe4ad3947f2ea2f0a8ea1e54f3357")!.periods;
    expect(studyPeriodsOnDate(periods, "2027-01-10")).toHaveLength(0);
    expect(studyPeriodsOnDate(periods, "2027-01-11")).toHaveLength(1);
    expect(studyPeriodsOnDate(periods, "2027-01-30")).toHaveLength(1);
    expect(studyPeriodsOnDate(periods, "2027-01-31")).toHaveLength(0);
  });

  it("не считает дату свободной за пределами известного семестра", () => {
    expect(schedulePeriodContains("2026-09-01", "2026-09-01", "2026-12-31")).toBe(true);
    expect(schedulePeriodContains("2026-12-31", "2026-09-01", "2026-12-31")).toBe(true);
    expect(schedulePeriodContains("2027-01-01", "2026-09-01", "2026-12-31")).toBe(false);
    expect(schedulePeriodContains("2026-08-31", "2026-09-01", "2026-12-31")).toBe(false);
  });
});
