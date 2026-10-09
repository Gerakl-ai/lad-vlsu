import type { ScheduleState } from "../types";

export function schedulePeriodContains(date: string, validFrom?: string, validThrough?: string) {
  return (!validFrom || date >= validFrom) && (!validThrough || date <= validThrough);
}

/** A safety boundary for undated weekly API data, not an official validity period. */
export function withEstimatedSemesterPeriod(state: ScheduleState): ScheduleState {
  if (((state.validFrom || state.validThrough) && !state.periodEstimated) || !state.allLessons.length
    || state.allLessons.some((lesson) => lesson.date || lesson.scheduleKind === "exam")) return state;

  const semester = state.currentInfo.semester;
  const captured = new Date(state.fetchedAt);
  if (!Number.isInteger(semester) || semester < 1 || semester > 12
    || Number.isNaN(captured.getTime())) return state;

  const year = captured.getUTCFullYear();
  const month = captured.getUTCMonth() + 1;
  const autumn = semester % 2 === 1;
  const termYear = autumn && month < 8 ? year - 1 : year;
  const validFrom = `${termYear}-${autumn ? "09-01" : "02-01"}`;
  const validThrough = `${termYear}-${autumn ? "12-31" : "06-30"}`;

  if (state.periodEstimated && state.validFrom === validFrom && state.validThrough === validThrough
    && state.allLessons.every((lesson) => lesson.validFrom === validFrom && lesson.validThrough === validThrough)) {
    return state;
  }

  return {
    ...state,
    validFrom,
    validThrough,
    periodEstimated: true,
    allLessons: state.allLessons.map((lesson) => ({ ...lesson, validFrom, validThrough }))
  };
}
