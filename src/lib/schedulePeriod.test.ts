import { describe, expect, it } from "vitest";
import type { ScheduleState } from "../types";
import { selectDayLessons } from "./time";
import { withEstimatedSemesterPeriod } from "./schedulePeriod";

const weekly: ScheduleState = {
  groupNrec: "group",
  currentInfo: { currentLesson: "", currentWeekType: 1, name: "ПИ-124", semester: 5 },
  fetchedAt: "2026-10-01T10:00:00.000Z",
  allLessons: [{
    id: "monday-1", dayIndex: 1, dayName: "Понедельник", pairIndex: 1,
    start: "08:30", end: "10:00", subject: "Базы данных", rawText: "Базы данных", weekMode: "all"
  }]
};

describe("границы недатированного расписания", () => {
  it("не повторяет осенние пары в следующем семестре", () => {
    const state = withEstimatedSemesterPeriod(weekly);
    expect(state).toMatchObject({ validFrom: "2026-09-01", validThrough: "2026-12-31", periodEstimated: true });
    expect(selectDayLessons(state.allLessons, 1, "numerator", new Date(2026, 9, 5))).toHaveLength(1);
    expect(selectDayLessons(state.allLessons, 1, "numerator", new Date(2027, 1, 1))).toHaveLength(0);
    expect(withEstimatedSemesterPeriod(state)).toEqual(state);
  });

  it("ограничивает весенний снимок его учебным полугодием", () => {
    const state = withEstimatedSemesterPeriod({ ...weekly,
      currentInfo: { ...weekly.currentInfo, semester: 6 }, fetchedAt: "2027-03-01T10:00:00.000Z" });
    expect(state).toMatchObject({ validFrom: "2027-02-01", validThrough: "2027-06-30" });
  });

  it("не переносит старый весенний снимок в следующий год при повторной загрузке осенью", () => {
    const state = withEstimatedSemesterPeriod({ ...weekly,
      currentInfo: { ...weekly.currentInfo, semester: 6 }, fetchedAt: "2026-10-05T10:00:00.000Z" });
    expect(state).toMatchObject({ validFrom: "2026-02-01", validThrough: "2026-06-30", periodEstimated: true });
    expect(selectDayLessons(state.allLessons, 1, "numerator", new Date(2027, 1, 1))).toHaveLength(0);
    const cachedWithOldEstimate = { ...state, validFrom: "2027-02-01", validThrough: "2027-06-30",
      allLessons: state.allLessons.map((lesson) => ({ ...lesson,
        validFrom: "2027-02-01", validThrough: "2027-06-30" })) };
    expect(withEstimatedSemesterPeriod(cachedWithOldEstimate)).toMatchObject({
      validFrom: "2026-02-01", validThrough: "2026-06-30",
      allLessons: [{ validFrom: "2026-02-01", validThrough: "2026-06-30" }]
    });
  });

  it("сохраняет явные границы документа и датированные экзамены", () => {
    const documented = { ...weekly, validFrom: "2026-09-05", validThrough: "2027-01-20" };
    expect(withEstimatedSemesterPeriod(documented)).toBe(documented);
    const exam = { ...weekly, allLessons: [{ ...weekly.allLessons[0], date: "2027-01-12", scheduleKind: "exam" as const }] };
    expect(withEstimatedSemesterPeriod(exam)).toBe(exam);
  });

  it("не придумывает период без достоверного номера семестра", () => {
    const state = { ...weekly, currentInfo: { ...weekly.currentInfo, semester: 0 } };
    expect(withEstimatedSemesterPeriod(state)).toBe(state);
  });
});
