import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeStaticSnapshot, scheduleStateFromSnapshot } from '../../src/lib/staticData';
import { normalizeSchedule } from '../../src/lib/scheduleApi';
import { selectDayLessons, findCurrentAndNext } from '../../src/lib/time';
import { sha256, scheduleQuality } from '../snapshot/buildSnapshot.mjs';
import { buildUniversityBundle } from '../snapshot/buildUniversityBundle.mjs';

const reviews = JSON.parse(readFileSync(new URL('./reviewed-spring-2026.json', import.meta.url), 'utf8'));
const catalog = JSON.parse(readFileSync(new URL('../../public/data/catalog.json', import.meta.url), 'utf8'));
const snapshots = reviews.groups.map((group) => JSON.parse(readFileSync(new URL(`../../public/data/reviewed-schedule/${group.groupNrec}.json`, import.meta.url), 'utf8')));

describe('six official dated archives', () => {
  it.each(snapshots.map((snapshot, index) => [snapshot.group.name, snapshot, reviews.groups[index]]))('%s has a traceable ordinary class for every extracted source cell', (_, snapshot, review) => {
    const normalized = normalizeStaticSnapshot(snapshot, review.groupNrec);
    const state = scheduleStateFromSnapshot(normalized, normalizeSchedule, 1);
    expect(state.allLessons).toHaveLength(review.lessonCount);
    expect(snapshot.scheduleHash).toBe(sha256({ semester: null, schedule: snapshot.schedule }));
    expect(snapshot.quality).toEqual(scheduleQuality(snapshot.schedule));
    expect(snapshot.sourceDocument.sha256).toBe(review.sourceSha256);
    expect(snapshot.sourceCells.lessons).toHaveLength(review.lessonCount);
    for (const lesson of state.allLessons) {
      expect(lesson.scheduleKind).toBe('classes');
      expect(lesson.date >= review.validFrom && lesson.date <= review.validThrough).toBe(true);
      for (const mode of ['numerator', 'denominator']) {
        expect(selectDayLessons(state.allLessons, lesson.dayIndex, mode, new Date(`${lesson.date}T12:00:00`)).some((entry) => entry.id === lesson.id)).toBe(true);
      }
      expect(lesson.subject).not.toContain(lesson.room);
      expect(lesson.teacher).toBeTruthy();
    }
    expect(selectDayLessons(state.allLessons, 1, 'all', new Date('2026-10-12T12:00:00'))).toHaveLength(0);
    const malformed = { ...snapshot, schedule: [{ ...snapshot.schedule[0], date: '2026-10-12' }] };
    expect(() => normalizeStaticSnapshot(malformed, review.groupNrec)).toThrow();
  });

  it('includes all six archives in the same universal offline bundle, without fabricated current classes', () => {
    const result = buildUniversityBundle(catalog, snapshots, new Date('2026-10-12T12:00:00Z'));
    expect(result.report.available).toBe(6);
    expect(result.report.rejected).toEqual([]);
    expect(Object.values(result.bundle.groups).reduce((sum, snapshot) => sum + snapshot.schedule.length, 0)).toBe(341);
    expect(snapshots.reduce((sum, snapshot) => sum + snapshot.sourceCells.distinctLessons, 0)).toBe(281);
    expect(new Set(snapshots.flatMap((snapshot) => snapshot.sourceCells.lessons.map((cell) =>
      `${snapshot.sourceDocument.url}:${snapshot.sourceCells.sheet}:${cell.lesson}`))).size).toBe(263);
  });

  it('keeps a subject-specific time printed inside the cell instead of the neighbouring group time', () => {
    const snapshot = snapshots.find((item) => item.group.name === 'ВПЛм-124');
    expect(snapshot.schedule.find((entry) => entry.date === '2026-03-02')).toMatchObject({ start: '15:50', end: '17:20' });
    const building = snapshots.find((item) => item.group.name === 'ВС-121');
    expect(building.schedule.find((entry) => entry.date === '2026-02-12').name).toContain('148-4, ,');
  });

  it('retains the printed break inside a merged subject cell, rather than inventing a continuous class', () => {
    const snapshot = snapshots.find((item) => item.group.name === 'ВС-121');
    const lessons = normalizeSchedule(snapshot.schedule);
    const date = new Date('2026-02-03T19:20:00');
    const day = selectDayLessons(lessons, 2, 'all', date);
    expect(day.map(({ start, end }) => [start, end])).toEqual([['17:40', '19:10'], ['19:30', '21:00']]);
    expect(findCurrentAndNext(lessons, 'all', date).current).toBeUndefined();
    expect(findCurrentAndNext(lessons, 'all', date).next.start).toBe('19:30');
  });
});
