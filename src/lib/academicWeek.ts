import type { WeekMode } from "../types";

/**
 * Учебная неделя ВлГУ, посчитанная от календаря.
 *
 * Модуль намеренно не имеет зависимостей: его используют и разбор расписания,
 * и чтение статических снимков, а через time.ts он оказался бы в цикле
 * импортов.
 *
 * Правило ВлГУ: неделя, в которую попадает 1 сентября, — числитель.
 * Считать неделю от календаря, а не из ответа API, важно: иначе старый снимок
 * переворачивает неделю и показывает студенту чужие пары.
 */

export function academicDayIndex(date: Date) {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

export function mondayOf(date: Date) {
  const monday = new Date(date);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() + (1 - academicDayIndex(date)));
  return monday;
}

function calendarWeekDelta(date: Date, start: Date) {
  const monday = mondayOf(date);
  const firstMonday = mondayOf(start);
  const dayStamp = (value: Date) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  return Math.round((dayStamp(monday) - dayStamp(firstMonday)) / 604_800_000);
}

/** Осенний семестр: неделя с 1 сентября считается первой. */
export function autumnTeachingWeekNumber(date: Date): number | null {
  if (date.getMonth() < 8 || date.getMonth() > 11) return null;
  return calendarWeekDelta(date, new Date(date.getFullYear(), 8, 1)) + 1;
}

export function vlsuWeekModeForDate(date = new Date()): WeekMode {
  const thisYear = date.getFullYear();
  const firstAcademicMonday = mondayOf(new Date(thisYear, 8, 1));
  const academicYear = date >= firstAcademicMonday ? thisYear : thisYear - 1;
  const firstSeptember = new Date(academicYear, 8, 1);
  firstSeptember.setHours(0, 0, 0, 0);
  const weekDelta = calendarWeekDelta(date, firstSeptember);
  return Math.abs(weekDelta) % 2 === 0 ? "numerator" : "denominator";
}

/** Тип недели в терминах API ВлГУ: 1 — числитель, 2 — знаменатель. */
export function vlsuWeekTypeForDate(date = new Date()): 1 | 2 {
  return vlsuWeekModeForDate(date) === "numerator" ? 1 : 2;
}

/** Nearest upcoming Monday whose calendar parity matches the requested timetable. */
export function weekStartForMode(mode: WeekMode, baseDate = new Date()): Date {
  const monday = mondayOf(baseDate);
  if (mode !== "all" && vlsuWeekModeForDate(monday) !== mode) {
    monday.setDate(monday.getDate() + 7);
  }
  return monday;
}
