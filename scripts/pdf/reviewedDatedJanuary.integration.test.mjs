import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeStaticSnapshot, scheduleStateFromSnapshot } from '../../src/lib/staticData';
import { normalizeSchedule } from '../../src/lib/scheduleApi';
import { selectDayLessons, findCurrentAndNext } from '../../src/lib/time';
import { sha256, scheduleQuality } from '../snapshot/buildSnapshot.mjs';
import { buildUniversityBundle } from '../snapshot/buildUniversityBundle.mjs';

const reviews = JSON.parse(readFileSync(new URL('./reviewed-dated-iite-january-2026.json', import.meta.url), 'utf8')).groups;
const catalog = JSON.parse(readFileSync(new URL('../../public/data/catalog.json', import.meta.url), 'utf8'));
const snapshots = reviews.map((group) => JSON.parse(readFileSync(new URL(`../../public/data/reviewed-schedule/${group.groupNrec}.json`, import.meta.url), 'utf8')));
const byName = (name) => snapshots.find((snapshot) => snapshot.group.name === name);
const expectedExams = [10, 13, 13, 7, 13, 13, 10];

describe('seven reviewed January IITE archives', () => {
  it.each(snapshots.map((snapshot, index) => [snapshot.group.name, snapshot, reviews[index], expectedExams[index]]))('%s retains the reviewed intervals and its full source period', (_, snapshot, review, examCount) => {
    const normalized = normalizeStaticSnapshot(snapshot, review.groupNrec);
    const state = scheduleStateFromSnapshot(normalized, normalizeSchedule, 1);
    expect(state.allLessons).toHaveLength(review.lessonCount);
    expect(state.allLessons.filter((entry) => entry.scheduleKind === 'exam')).toHaveLength(examCount);
    expect(snapshot.quality).toEqual(scheduleQuality(snapshot.schedule));
    expect(snapshot.scheduleHash).toBe(sha256({ semester: null, schedule: snapshot.schedule }));
    const staged = snapshot.schedule.map(({ type, ...entry }, index) => ({ ...entry, evidence: snapshot.sourceCells.lessons[index] }));
    expect(sha256(staged)).toBe(review.lessonsSha256);
    expect(snapshot.sourceCells.locations[0]).toMatchObject({ headerText: review.groupName, validFrom: '2026-01-26', validThrough: '2026-01-31' });
    for (const lesson of state.allLessons) {
      expect(lesson.date >= review.validFrom && lesson.date <= review.validThrough).toBe(true);
      expect(lesson.room).toBeTruthy();
      if (lesson.kind !== 'собрание') expect(lesson.teacher).toBeTruthy();
    }
    expect(selectDayLessons(state.allLessons, 1, 'all', new Date('2026-02-02T12:00:00'))).toHaveLength(0);
  });

  it('retains the single shared source meeting in all seven groups without a fabricated teacher', () => {
    for (const snapshot of snapshots) {
      const first = normalizeSchedule(snapshot.schedule)[0];
      expect(first).toMatchObject({ date: '2026-01-26', start: '12:10', end: '13:40', room: 'Г-3', kind: 'собрание', subject: 'Организационное собрание' });
      expect(first.teacher).toBeUndefined();
    }
    expect(new Set(snapshots.map((snapshot) => snapshot.sourceCells.lessons[0].lessonBox.join(','))).size).toBe(1);
  });

  it('does not drop a printed lesson when it lies on either side of the group-column centre', () => {
    const lessons = normalizeSchedule(byName('ЗИСТд-125').schedule);
    expect(lessons.find((entry) => entry.date === '2026-01-26' && entry.start === '15:50')).toMatchObject({ subject: 'БЖ', room: '302 б-2' });
    expect(lessons.find((entry) => entry.date === '2026-01-28' && entry.start === '08:30')).toMatchObject({ subject: 'БЖ', room: '305 б-2' });
  });

  it('preserves both laboratory rooms and their source order in each exact date slot', () => {
    const lessons = normalizeSchedule(byName('ЗРТд-125').schedule);
    const early = lessons.find((entry) => entry.date === '2026-01-29' && entry.start === '12:10');
    const late = lessons.find((entry) => entry.date === '2026-01-29' && entry.start === '15:50');
    expect(early.variants.map((variant) => variant.room)).toEqual(['424-3', '425-3']);
    expect(late.variants.map((variant) => variant.room)).toEqual(['425-3', '424-3']);
  });

  it('keeps the printed sports-building room and reassessment annotation', () => {
    const lessons = normalizeSchedule(byName('ЗПИуд-125').schedule);
    const sport = lessons.find((entry) => entry.date === '2026-01-27' && entry.start === '08:30');
    expect(sport.variants.map((variant) => variant.room)).toEqual(['101-СК1', '101-СК1']);
    expect(sport.variants.map((variant) => variant.kind)).toEqual(['зач', 'переат']);
    const language = lessons.find((entry) => entry.date === '2026-01-26' && entry.start === '14:00');
    expect(language).toMatchObject({ subject: 'Иностранный язык (англ.)', kind: 'зач +п/а', scheduleKind: 'exam' });
  });

  it('retains the source break in a merged examination cell', () => {
    const lessons = normalizeSchedule(byName('ЗИСТуд-125').schedule);
    const state = findCurrentAndNext(lessons, 'all', new Date('2026-01-31T13:50:00'));
    expect(state.current).toBeUndefined();
    expect(state.next).toMatchObject({ start: '14:00', end: '15:30', scheduleKind: 'exam' });
  });

  it('includes all seven archived groups without treating old dates as the current semester', () => {
    const result = buildUniversityBundle(catalog, snapshots, new Date('2026-10-13T12:00:00Z'));
    expect(result.report.available).toBe(7);
    expect(result.report.rejected).toEqual([]);
    expect(Object.values(result.bundle.groups).reduce((sum, snapshot) => sum + snapshot.schedule.length, 0)).toBe(134);
    expect(new Set(snapshots.flatMap((snapshot) => snapshot.sourceCells.lessons.map((entry) =>
      `${entry.page}:${entry.table}:${entry.lessonBox.join(',')}`))).size).toBe(125);
  });
});
