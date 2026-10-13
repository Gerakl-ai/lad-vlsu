import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeStaticSnapshot, scheduleStateFromSnapshot } from '../../src/lib/staticData';
import { normalizeSchedule } from '../../src/lib/scheduleApi';
import { selectDayLessons, findCurrentAndNext } from '../../src/lib/time';
import { sha256, scheduleQuality } from '../snapshot/buildSnapshot.mjs';
import { buildUniversityBundle } from '../snapshot/buildUniversityBundle.mjs';

const reviews = JSON.parse(readFileSync(new URL('./reviewed-dated-iite-2025.json', import.meta.url), 'utf8')).groups;
const catalog = JSON.parse(readFileSync(new URL('../../public/data/catalog.json', import.meta.url), 'utf8'));
const snapshots = reviews.map((group) => JSON.parse(readFileSync(new URL(`../../public/data/reviewed-schedule/${group.groupNrec}.json`, import.meta.url), 'utf8')));

describe('official dated IITE PDF archives', () => {
  it.each(snapshots.map((snapshot, index) => [snapshot.group.name, snapshot, reviews[index]]))('%s preserves all reviewed source intervals and kinds', (_, snapshot, review) => {
    const normalized = normalizeStaticSnapshot(snapshot, review.groupNrec);
    const state = scheduleStateFromSnapshot(normalized, normalizeSchedule, 1);
    expect(state.allLessons).toHaveLength(28);
    expect(state.allLessons.filter((entry) => entry.scheduleKind === 'exam')).toHaveLength(12);
    expect(snapshot.quality).toEqual(scheduleQuality(snapshot.schedule));
    expect(snapshot.scheduleHash).toBe(sha256({ semester: null, schedule: snapshot.schedule }));
    const staged = snapshot.schedule.map(({ type, ...entry }, index) => ({ ...entry, evidence: snapshot.sourceCells.lessons[index] }));
    expect(sha256(staged)).toBe(review.lessonsSha256);
    for (const lesson of state.allLessons) {
      expect(lesson.date >= review.validFrom && lesson.date <= review.validThrough).toBe(true);
      expect(lesson.teacher).toBeTruthy();
      expect(lesson.room).toBeTruthy();
      for (const mode of ['numerator', 'denominator']) {
        expect(selectDayLessons(state.allLessons, lesson.dayIndex, mode, new Date(`${lesson.date}T12:00:00`)).some((entry) => entry.id === lesson.id)).toBe(true);
      }
    }
    expect(selectDayLessons(state.allLessons, 1, 'all', new Date('2025-12-08T12:00:00'))).toHaveLength(0);
    expect(selectDayLessons(state.allLessons, 2, 'all', new Date('2026-10-13T12:00:00'))).toHaveLength(0);
  });

  it('retains the three printed language choices for both groups, with two choices in the next interval', () => {
    for (const snapshot of snapshots) {
      const lessons = normalizeSchedule(snapshot.schedule);
      const first = lessons.find((entry) => entry.date === '2025-12-03' && entry.start === '14:00');
      expect(first.variants.map(({ room, subject }) => [room, subject])).toEqual([
        ['308-1', 'Иностранный язык (нем.)'], ['408-1', 'Иностранный язык (англ.)'], ['418-1', 'Иностранный язык (англ.)']
      ]);
      const next = lessons.find((entry) => entry.date === '2025-12-03' && entry.start === '15:50');
      expect(next.variants).toHaveLength(2);
    }
  });

  it('does not invent a continuous exam across the break in the merged source cell', () => {
    const lessons = normalizeSchedule(snapshots[0].schedule);
    const state = findCurrentAndNext(lessons, 'all', new Date('2025-12-06T15:40:00'));
    expect(state.current).toBeUndefined();
    expect(state.next).toMatchObject({ start: '15:50', end: '17:20', scheduleKind: 'exam', subject: 'Управление данными' });
  });

  it('includes both groups in a universal bundle without converting old classes into recurring ones', () => {
    const result = buildUniversityBundle(catalog, snapshots, new Date('2026-10-13T12:00:00Z'));
    expect(result.report.available).toBe(2);
    expect(result.report.rejected).toEqual([]);
    expect(Object.values(result.bundle.groups).reduce((sum, snapshot) => sum + snapshot.schedule.length, 0)).toBe(56);
    expect(new Set(snapshots.flatMap((snapshot) => snapshot.sourceCells.lessons.map((entry) =>
      `${entry.page}:${entry.table}:${entry.lessonBox.join(',')}`))).size).toBe(53);
  });
});
