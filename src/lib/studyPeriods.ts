import reviewed from "../data/studyPeriods.json";

export type StudyPeriodKind = "session" | "practice" | "final";
export interface StudyPeriod { kind: StudyPeriodKind; start: string; end: string }
interface StudyCalendar {
  name: string;
  nrec: string;
  sourceId: string;
  periods: StudyPeriod[];
}
const calendars = reviewed.groups as StudyCalendar[];
const sources: Record<string, { url: string; sha256: string; page: number }> = reviewed.sources;
const dateFormatter = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const titles: Record<StudyPeriodKind, string> = { session: "Сессия", practice: "Практика", final: "Подготовка и защита ВКР" };

export function groupStudyCalendar(groupNrec: string | undefined) {
  const calendar = calendars.find((entry) => entry.nrec === groupNrec);
  if (!calendar) return null;
  return { ...calendar, academicYear: reviewed.academicYear, sourceUrl: sources[calendar.sourceId].url };
}

export function visibleStudyPeriods(periods: StudyPeriod[], selectedDate: string) {
  const sorted = [...periods].sort((left, right) => left.start.localeCompare(right.start));
  const upcoming = sorted.filter((period) => period.end >= selectedDate);
  return upcoming.length ? upcoming.slice(0, 3) : sorted.slice(-3);
}

export function studyPeriodTitle(kind: StudyPeriodKind) { return titles[kind]; }

export function studyPeriodsOnDate(periods: StudyPeriod[], date: string) {
  return periods.filter((period) => period.start <= date && period.end >= date);
}

export function studyPeriodRange(period: StudyPeriod) {
  const format = (date: string) => dateFormatter.format(new Date(`${date}T12:00:00Z`)).replace(/\s*г\.$/, "");
  return `${format(period.start)} - ${format(period.end)}`;
}
