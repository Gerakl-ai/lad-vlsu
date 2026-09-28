import { describe, expect, it } from "vitest";

import { freshnessNotice, preferNewerSchedule } from "./freshness";
import type { ScheduleState } from "../types";

const NOW = Date.parse("2026-09-18T12:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();
const daysAgo = (days: number) => hoursAgo(days * 24);

describe("freshnessNotice", () => {
  it("молчит, пока расписание свежее суток", () => {
    expect(freshnessNotice(hoursAgo(2), NOW)?.warn).toBe(false);
    expect(freshnessNotice(hoursAgo(23), NOW)?.warn).toBe(false);
  });

  it("предупреждает после суток без обновлений", () => {
    const notice = freshnessNotice(hoursAgo(30), NOW);
    expect(notice?.level).toBe("aging");
    expect(notice?.warn).toBe(true);
    expect(notice?.title).toContain("17 сентября");
  });

  it("после трёх суток добавляет возраст и совет свериться", () => {
    // Ровно тот случай, что наблюдался в проде: снимок десятидневной давности
    // подавался как обычное расписание.
    const notice = freshnessNotice(daysAgo(10), NOW);
    expect(notice?.level).toBe("stale");
    expect(notice?.title).toContain("8 сентября");
    expect(notice?.detail).toContain("10 дней");
    expect(notice?.detail).toContain("ВлГУ");
  });

  it("до трёх суток обходится одной строкой без подробностей", () => {
    // Сообщение важное, но не должно занимать четверть экрана.
    const notice = freshnessNotice(daysAgo(2), NOW);
    expect(notice?.level).toBe("aging");
    expect(notice?.title).toContain("Расписание от");
    expect(notice?.detail).toBe("");
  });

  it("склоняет дни по-русски", () => {
    // Возраст называется только в «устаревшем» состоянии, то есть с четвёртых суток.
    expect(freshnessNotice(daysAgo(5), NOW)?.detail).toContain("5 дней");
    expect(freshnessNotice(daysAgo(11), NOW)?.detail).toContain("11 дней");
    expect(freshnessNotice(daysAgo(21), NOW)?.detail).toContain("21 день");
    expect(freshnessNotice(daysAgo(22), NOW)?.detail).toContain("22 дня");
  });

  it("не падает на пустом и битом значении", () => {
    expect(freshnessNotice(undefined, NOW)).toBeNull();
    expect(freshnessNotice("не дата", NOW)).toBeNull();
  });

  it("не считает будущее отрицательным возрастом", () => {
    // Часы устройства могут отставать; это не повод пугать пользователя.
    expect(freshnessNotice(new Date(NOW + 3_600_000).toISOString(), NOW)?.warn).toBe(false);
  });
});

describe("preferNewerSchedule", () => {
  const schedule = (groupNrec: string, fetchedAt: string): ScheduleState => ({
    groupNrec,
    currentInfo: { currentLesson: "", currentWeekType: 1, name: groupNrec, semester: 5 },
    allLessons: [],
    fetchedAt
  });

  it("keeps a newer saved copy instead of replacing it with an older static file", () => {
    const saved = schedule("group", "2026-09-20T12:00:00Z");
    expect(preferNewerSchedule(saved, schedule("group", "2026-09-08T12:00:00Z"))).toBe(saved);
  });

  it("accepts newer data and does not compare timestamps across groups", () => {
    const saved = schedule("group", "2026-09-08T12:00:00Z");
    const fresh = schedule("group", "2026-09-20T12:00:00Z");
    expect(preferNewerSchedule(saved, fresh)).toBe(fresh);
    expect(preferNewerSchedule(saved, schedule("other", "2026-09-01T12:00:00Z")).groupNrec).toBe("other");
  });
});
