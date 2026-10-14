import { describe, expect, it } from "vitest";
import { isDatedLesson, type DatedLessonDto } from "./datedLesson";
import { normalizeCachedSchedule, normalizeSchedule } from "./scheduleApi";
import { dayTimeLabel, findCurrentAndNext, hasConfirmedLessonTime, lessonProgress, lessonTimeLabel, lessonTimingState, minutesUntilEnd } from "./time";
import { eventsForDate, buildIcs } from "../features/notes/SmartCalendarSheet";
import { heroCopy } from "./heroCopy";
import { createLessonNoteContext } from "../features/notes/noteLinking";
import { buildSubjectOptions } from "../features/notes/noteClassifier";
import type { SmartNote } from "../features/notes/noteTypes";

const pending: DatedLessonDto = { type: "DatedLesson", date: "2026-01-21", start: "16:00", timeStatus: "unconfirmed",
  name: "306-6, экз, Примеров А.А., Предмет с конфликтом времени", scheduleKind: "exam" };
const confirmed: DatedLessonDto = { type: "DatedLesson", date: "2026-01-21", start: "10:20", end: "11:50",
  name: "101-6, зач, Примеров Б.Б., Подтверждённый предмет" };

describe("unconfirmed dated times", () => {
  it("retains the explicit start without a fabricated end", () => {
    expect(isDatedLesson(pending)).toBe(true);
    const [lesson] = normalizeSchedule([pending]);
    expect(lesson).toMatchObject({ date: pending.date, start: "16:00", timeStatus: "unconfirmed" });
    expect(lesson.end).toBeUndefined();
    expect(hasConfirmedLessonTime(lesson)).toBe(false);
    expect(lessonTimeLabel(lesson)).toBe("16:00 · время уточняется");
  });

  it.each([{ timeStatus: undefined }, { timeStatus: "guessed" }, { timeStatus: null }, { end: "17:20" },
    { end: null }, { date: "2026-01-32" }, { start: "25:00" }])("rejects a malformed unconfirmed record: %j", (change) => {
    expect(isDatedLesson({ ...pending, ...change })).toBe(false);
  });

  it.each(["2026-01-21T15:55:00", "2026-01-21T16:05:00", "2026-01-21T23:59:00", "2026-01-22T09:00:00"])
  ("does not infer completion or progress at %s", (stamp) => {
    const [lesson] = normalizeSchedule([pending]);
    const now = new Date(stamp);
    expect(lessonTimingState(lesson, now)).toBe("unconfirmed");
    expect(lessonProgress(lesson, now)).toBe(0);
    expect(minutesUntilEnd(lesson, now)).toBe(0);
    expect(findCurrentAndNext([lesson], "all", now).current).toBeUndefined();
  });

  it("keeps confirmed current/next logic and surfaces a pending lesson after its start", () => {
    const lessons = normalizeSchedule([confirmed, pending]);
    expect(findCurrentAndNext(lessons, "all", new Date("2026-01-21T10:30:00")).current?.subject).toBe("Подтверждённый предмет");
    const after = findCurrentAndNext(lessons, "all", new Date("2026-01-21T18:00:00"));
    expect(after.current).toBeUndefined();
    expect(after.next).toBeUndefined();
    expect(after.unconfirmed?.subject).toBe("Предмет с конфликтом времени");
    expect(dayTimeLabel(lessons)).toBe("10:20 · время уточняется");
  });

  it("preserves the explicit unknown state in device cache and rejects invalid dates there", () => {
    const state = { groupNrec: "a".repeat(32), currentInfo: { currentLesson: "", currentWeekType: 1, name: "Group", semester: 1 },
      allLessons: normalizeSchedule([pending]), fetchedAt: "2026-10-14T05:00:00Z" };
    expect(normalizeCachedSchedule(JSON.parse(JSON.stringify(state)))?.allLessons[0].end).toBeUndefined();
    expect(normalizeCachedSchedule(JSON.parse(JSON.stringify(state)))?.allLessons[0].timeStatus).toBe("unconfirmed");
    expect(normalizeCachedSchedule({ ...state, allLessons: [{ ...state.allLessons[0], date: "2026-01-32" }] })).toBeNull();
    expect(normalizeCachedSchedule({ ...state, allLessons: [{ ...state.allLessons[0], timeStatus: undefined }] })).toBeNull();
  });

  it("shows both subjects in the app calendar but exports only confirmed intervals", () => {
    const lessons = normalizeSchedule([confirmed, pending]);
    const events = eventsForDate(lessons, [], new Date("2026-01-21T12:00:00"), "all", []);
    expect(events).toHaveLength(2);
    const unknown = events.find((event) => event.title === "Предмет с конфликтом времени")!;
    expect(unknown.detail).toContain("Время уточняется");
    expect(unknown.end).toBeUndefined();
    const ics = buildIcs(events, "Проверка").replace(/\r\n[ \t]/g, "");
    expect(ics).toContain("SUMMARY:Подтверждённый предмет");
    expect(ics).not.toContain("Предмет с конфликтом времени");
    expect(ics.split("BEGIN:VEVENT")).toHaveLength(2);
  });

  it("does not label the uncertain hero as live, loading, completed or counting down", () => {
    const copy = heroCopy({ mode: "unconfirmed", isSelectedToday: true, lessonProgress: 0, minutesToNext: 20,
      minutesRemaining: 0, nextStart: "16:00", completedCount: 1, lessonCount: 2, hasLoadedLessons: true,
      formatDuration: (minutes) => `${minutes} мин` });
    expect(copy).toEqual({ sigilLabel: "Начало", sigilValue: "16:00", showProgressRow: false });
  });

  it("does not infer the next deadline of an uncertain subject", () => {
    const options = buildSubjectOptions(normalizeSchedule([pending]), "all", new Date("2026-01-21T12:00:00"));
    expect(options).toHaveLength(1);
    expect(options[0].nextAt).toBeUndefined();
  });

  it("preserves uncertain timing in linked notes even without a loaded timetable", () => {
    const [lesson] = normalizeSchedule([pending]);
    const context = createLessonNoteContext(lesson, new Date("2026-01-21T12:00:00"), "note");
    expect(context.timeStatus).toBe("unconfirmed");
    const note: SmartNote = { id: "note", text: "Проверка", title: "Проверка", kind: "note", space: "Учёба", confidence: 1,
      status: "open", pinned: false, createdAt: "2026-01-21T12:00:00Z", updatedAt: "2026-01-21T12:00:00Z",
      classificationSource: "local", lessonContext: context };
    const [event] = eventsForDate([], [note], new Date("2026-01-21T12:00:00"), "all", []);
    expect(event.timeStatus).toBe("unconfirmed");
    expect(event.end).toBeUndefined();
    expect(buildIcs([event], "Проверка")).not.toContain("BEGIN:VEVENT");
    const explicit = { ...note, dueAt: "2026-01-22T12:00:00Z", dueManual: true };
    expect(eventsForDate([], [explicit], new Date("2026-01-21T12:00:00"), "all", [])).toHaveLength(0);
    const due = eventsForDate([], [explicit], new Date("2026-01-22T12:00:00"), "all", []);
    expect(due).toHaveLength(1);
    expect(due[0].end).toBeDefined();
    expect(due[0].timeStatus).toBeUndefined();
  });
});
