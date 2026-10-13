import { describe, expect, it } from "vitest";
import { eventsForDate } from "./SmartCalendarSheet";
import { normalizeSchedule } from "../../lib/scheduleApi";
import { selectedLessonVariant, setLessonSelection } from "../../lib/lessonSelection";
import type { WeekMode } from "../../types";

describe("calendar uses the same lesson choices as Today and Week", () => {
  it("keeps the chosen room of an exact dated slot and does not change source records", () => {
    const lessons = normalizeSchedule([{ type: "DatedLesson", date: "2026-01-29", start: "12:10", end: "13:40",
      name: "424-3, лб, Примеров А.А., Физика\n425-3, лб, Примеров А.А., Физика" }]);
    const before = JSON.stringify(lessons);
    const choices = setLessonSelection({}, lessons[0], "all", 1);
    const events = eventsForDate(lessons, [], new Date("2026-01-29T12:00:00"), "all", [],
      (lesson, mode) => selectedLessonVariant(lesson, mode, choices));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ title: "Физика", location: "425-3" });
    expect(events[0].start.getHours()).toBe(12);
    expect(events[0].end.getMinutes()).toBe(40);
    expect(JSON.stringify(lessons)).toBe(before);
    expect(eventsForDate(lessons, [], new Date("2026-02-05T12:00:00"), "all", [])).toHaveLength(0);
  });

  it("uses the week of each calendar date, including weekly alternation", () => {
    const a = "111-3, лб, Примеров А.А., Предмет А";
    const b = "112-3, лб, Примеров Б.Б., Предмет Б";
    const lessons = normalizeSchedule([{ type: "Lessons", name: "Вторник", n1: `${b}\n${a}`, z1: `${a}\n${b}` }]);
    const denominator = lessons.find((lesson) => lesson.weekMode === "denominator")!;
    const choices = setLessonSelection({}, denominator, "denominator", 0);
    const resolver = (lesson: typeof denominator, mode: WeekMode) => selectedLessonVariant(lesson, mode, choices,
      lessons.find((candidate) => candidate.weekMode !== lesson.weekMode));
    expect(eventsForDate(lessons, [], new Date("2026-10-06T12:00:00"), "numerator", [], resolver)[0])
      .toMatchObject({ title: "Предмет А", location: "111-3" });
    expect(eventsForDate(lessons, [], new Date("2026-10-13T12:00:00"), "numerator", [], resolver)[0])
      .toMatchObject({ title: "Предмет Б", location: "112-3" });
  });

  it("keeps all printed variants when no choice resolver was supplied", () => {
    const lessons = normalizeSchedule([{ type: "DatedLesson", date: "2026-01-29", start: "12:10", end: "13:40",
      name: "424-3, лб, Примеров А.А., Физика\n425-3, лб, Примеров А.А., Физика" }]);
    expect(eventsForDate(lessons, [], new Date("2026-01-29T12:00:00"), "all", [])[0].location).toBe("424-3 / 425-3");
  });
});
