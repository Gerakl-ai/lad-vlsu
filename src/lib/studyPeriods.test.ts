import { describe, expect, it } from "vitest";
import catalog from "../../public/data/catalog.json";
import reviewed from "../data/studyPeriods.json";
import { groupStudyCalendar, studyPeriodRange, studyPeriodsOnDate, visibleStudyPeriods } from "./studyPeriods";
import { schedulePeriodContains } from "./schedulePeriod";

describe("официальный учебный календарь", () => {
  it("сопоставляет каждую сверенную группу с каталогом и источником", () => {
    const known = catalog.institutes.flatMap((institute) => institute.groups);
    expect(reviewed.groups).toHaveLength(59);
    expect(new Set(reviewed.groups.map((group) => group.nrec)).size).toBe(59);
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

  it("сохраняет различия выпускных групп ИИТЭ и не придумывает отсутствующую группу", () => {
    const ist = groupStudyCalendar("ccfede0a6161e83cf079475e02324ac5")!;
    const pi = groupStudyCalendar("9e8a25a033119117261f01f3bc44ab4f")!;
    expect(ist.periods.find((period) => period.kind === "session" && period.start === "2027-03-22")?.end).toBe("2027-04-02");
    expect(pi.periods.find((period) => period.kind === "session" && period.start === "2027-03-22")?.end).toBe("2027-03-31");
    expect(groupStudyCalendar("638ac902af6655c9c0396fce84f6ed7c")?.periods.find((period) => period.kind === "final")?.end).toBe("2027-02-27");
    expect(groupStudyCalendar("9ebff683431e93bb6ff1b1b3e445d704")).toBeNull();
  });

  it("показывает проверенные сессии первокурсников ГИ без выдуманных практик", () => {
    const firstYear = reviewed.groups.filter((group) => group.sourceId === "gi-dot-first");
    expect(firstYear).toHaveLength(13);
    for (const group of firstYear) {
      expect(group.periods).toEqual([
        { kind: "session", start: "2027-01-18", end: "2027-01-29" },
        { kind: "session", start: "2027-06-21", end: "2027-06-30" }
      ]);
    }
    expect(studyPeriodsOnDate(groupStudyCalendar(firstYear[0].nrec)!.periods, "2027-01-30")).toHaveLength(0);
  });

  it("различает практики и защиту выпускной группы ИФКСХ", () => {
    const firstYear = reviewed.groups.filter((group) => group.sourceId === "ifksh-dot");
    expect(firstYear).toHaveLength(5);
    const graduate = groupStudyCalendar("09e5d59b4a6c048ceca6b5c3dd426293")!;
    expect(studyPeriodsOnDate(graduate.periods, "2026-10-11").map((period) => period.kind)).toEqual(["practice"]);
    expect(studyPeriodsOnDate(graduate.periods, "2027-06-30").map((period) => period.kind)).toEqual(["final"]);
    expect(studyPeriodsOnDate(graduate.periods, "2027-07-01")).toHaveLength(0);
  });
});
