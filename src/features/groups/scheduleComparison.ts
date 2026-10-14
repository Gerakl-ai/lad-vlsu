import type { LessonSlot, ScheduleState, WeekMode } from "../../types";
import { activeWeekMode } from "../../lib/scheduleApi";
import { currentDayIndex, dateKeyFromDate, hasConfirmedLessonTime, minutesFromTime, selectDayLessons, vlsuWeekModeForDate, weekModeFromSnapshot } from "../../lib/time";
import { schedulePeriodContains } from "../../lib/schedulePeriod";
import { lessonWithSelectedVariant } from "../../lib/lessonSelection";
import type { SubgroupChoice } from "../../lib/subgroup";

export interface ComparisonDay {
  availability: "ready" | "missing" | "outside-period";
  lessons: LessonSlot[];
  weekMode?: WeekMode;
}

export interface TimeWindow { start: string; end: string; minutes: number }
export type ComparisonChoice = (lesson: LessonSlot, mode: WeekMode) => SubgroupChoice;
export const COMPARISON_RANGE = { start: "08:00", end: "20:00" };
const COUNT_RULES = new Intl.PluralRules("ru-RU");

export function comparisonLessonCount(count: number) {
  const rule = COUNT_RULES.select(count);
  return `${count} ${rule === "one" ? "занятие" : rule === "few" ? "занятия" : "занятий"}`;
}

export function comparisonDay(state: ScheduleState | null, date: Date, choice?: ComparisonChoice): ComparisonDay {
  if (!state) return { availability: "missing", lessons: [] };
  const key = dateKeyFromDate(date);
  if (!schedulePeriodContains(key, state.validFrom, state.validThrough)) {
    return { availability: "outside-period", lessons: [] };
  }
  const weekMode = state.allLessons.some((lesson) => lesson.scheduleKind === "exam")
    ? weekModeFromSnapshot(activeWeekMode(state.currentInfo.currentWeekType), state.weekTypeAsOf ?? state.fetchedAt, date)
    : vlsuWeekModeForDate(date);
  const lessons = selectDayLessons(state.allLessons, currentDayIndex(date), weekMode, date)
    .map((lesson) => lessonWithSelectedVariant(lesson, choice?.(lesson, weekMode) ?? "all"));
  // A date-only table with no declared period cannot prove that an omitted day is free.
  if (!lessons.length && state.allLessons.some((lesson) => lesson.date) && (!state.validFrom || !state.validThrough)) {
    return { availability: "outside-period", lessons: [], weekMode };
  }
  return { availability: "ready", lessons, weekMode };
}

function clock(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function compareScheduleDays(left: ComparisonDay, right: ComparisonDay, range = COMPARISON_RANGE, minimumMinutes = 20) {
  const leftOverlaps = new Set<string>();
  const rightOverlaps = new Set<string>();
  for (const a of left.lessons.filter(hasConfirmedLessonTime)) {
    for (const b of right.lessons.filter(hasConfirmedLessonTime)) {
      if (Math.max(minutesFromTime(a.start), minutesFromTime(b.start)) < Math.min(minutesFromTime(a.end), minutesFromTime(b.end))) {
        leftOverlaps.add(a.id);
        rightOverlaps.add(b.id);
      }
    }
  }
  const unavailable = left.availability !== "ready" || right.availability !== "ready";
  const unconfirmed = [...left.lessons, ...right.lessons].some((lesson) => !hasConfirmedLessonTime(lesson));
  if (unavailable || unconfirmed) return { windows: null, reason: unavailable ? "missing" as const : "unconfirmed" as const, leftOverlaps, rightOverlaps };

  const start = minutesFromTime(range.start);
  const end = minutesFromTime(range.end);
  const occupied = [...left.lessons, ...right.lessons].filter(hasConfirmedLessonTime)
    .map((lesson) => [Math.max(start, minutesFromTime(lesson.start)), Math.min(end, minutesFromTime(lesson.end))])
    .filter(([from, to]) => from < to).sort(([a], [b]) => a - b);
  const windows: TimeWindow[] = [];
  let cursor = start;
  const append = (to: number) => {
    if (to - cursor >= minimumMinutes) windows.push({ start: clock(cursor), end: clock(to), minutes: to - cursor });
  };
  for (const [from, to] of occupied) {
    append(from);
    cursor = Math.max(cursor, to);
  }
  append(end);
  return { windows, reason: null, leftOverlaps, rightOverlaps };
}
