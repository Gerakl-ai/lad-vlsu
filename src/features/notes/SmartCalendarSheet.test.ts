import { describe, expect, it } from "vitest";
import { buildIcs, eventsForDate } from "./SmartCalendarSheet";
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
    expect(events[0].end?.getMinutes()).toBe(40);
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

describe("iCalendar serialization", () => {
  const event = { id: "personal-1", title: "Встреча", detail: "Описание", location: "Аудитория",
    start: new Date("2026-01-21T12:50:00Z"), end: new Date("2026-01-21T14:20:00Z"), type: "personal" as const };
  const unfold = (value: string) => value.replace(/\r\n[ \t]/g, "");

  it("folds long UTF-8 lines without breaking code points or truncating content", () => {
    const title = "Технологические добавки " + "предмет\u{1f4da}".repeat(20);
    const id = "dated-" + "исходное-расписание".repeat(20);
    const content = buildIcs([{ ...event, title, id }], "Название календаря".repeat(10));
    for (const line of content.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(content).not.toContain("\ufffd");
    expect(unfold(content)).toContain(`SUMMARY:${title}\r\n`);
    expect(unfold(content)).toContain(`UID:${id}@lad-vlsu\r\n`);
    expect(content.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("escapes Windows and Unix newlines without injecting content lines", () => {
    const content = unfold(buildIcs([{ ...event, detail: "Строка 1\r\nBEGIN:VEVENT\rСтрока 3\nСтрока 4, ; \\" }], "ЛАД"));
    expect(content.split("\r\n").filter((line) => line === "BEGIN:VEVENT")).toHaveLength(1);
    expect(content).toContain("DESCRIPTION:Строка 1\\nBEGIN:VEVENT\\nСтрока 3\\nСтрока 4\\, \\; \\\\");
  });

  it("retains UTC boundaries and omits unknown locations", () => {
    const content = unfold(buildIcs([{ ...event, location: undefined }], "ЛАД"));
    expect(content).toContain("DTSTART:20260121T125000Z\r\n");
    expect(content).toContain("DTEND:20260121T142000Z\r\n");
    expect(content).not.toContain("LOCATION:");
  });
});
