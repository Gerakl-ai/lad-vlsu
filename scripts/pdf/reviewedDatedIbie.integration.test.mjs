import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeStaticSnapshot, scheduleStateFromSnapshot } from '../../src/lib/staticData';
import { normalizeSchedule } from '../../src/lib/scheduleApi';
import { selectDayLessons, findCurrentAndNext } from '../../src/lib/time';
import { lessonWithSelectedVariant } from '../../src/lib/lessonSelection';
import { sha256, scheduleQuality } from '../snapshot/buildSnapshot.mjs';
import { buildUniversityBundle } from '../snapshot/buildUniversityBundle.mjs';

const reviews = JSON.parse(readFileSync(new URL('./reviewed-dated-ibie-january-2026.json', import.meta.url), 'utf8')).groups;
const corrections = JSON.parse(readFileSync(new URL('./reviewed-dated-ibie-metadata.json', import.meta.url), 'utf8')).corrections;
const catalog = JSON.parse(readFileSync(new URL('../../public/data/catalog.json', import.meta.url), 'utf8'));
const snapshots = reviews.map((group) => JSON.parse(readFileSync(new URL(`../../public/data/reviewed-schedule/${group.groupNrec}.json`, import.meta.url), 'utf8')));
const byName = (name) => snapshots.find((snapshot) => snapshot.group.name === name);
const lessonsFor = (name) => normalizeSchedule(byName(name).schedule);
const expectedExams = [7, 8, 14, 19, 6, 5, 13];

describe('seven reviewed Institute of Natural Sciences January archives', () => {
  it.each(snapshots.map((snapshot, index) => [snapshot.group.name, snapshot, reviews[index], expectedExams[index]]))('%s retains every printed interval and the reviewed source hash', (_, snapshot, review, examCount) => {
    const normalized = normalizeStaticSnapshot(snapshot, review.groupNrec);
    const state = scheduleStateFromSnapshot(normalized, normalizeSchedule, 1);
    expect(state.allLessons).toHaveLength(review.lessonCount);
    expect(state.allLessons.filter((lesson) => lesson.scheduleKind === 'exam')).toHaveLength(examCount);
    expect(snapshot.quality).toEqual(scheduleQuality(snapshot.schedule));
    expect(snapshot.scheduleHash).toBe(sha256({ semester: null, schedule: snapshot.schedule }));
    const staged = snapshot.schedule.map(({ type, ...entry }, index) => ({ ...entry, evidence: snapshot.sourceCells.lessons[index] }));
    expect(sha256(staged)).toBe(review.lessonsSha256);
    expect(snapshot.sourceCells.locations[0]).toMatchObject({ headerText: review.groupName, validFrom: review.validFrom, validThrough: review.validThrough });
    expect(selectDayLessons(state.allLessons, 1, 'all', new Date('2026-02-02T12:00:00'))).toHaveLength(0);
    for (const lesson of state.allLessons) expect(lesson.date >= review.validFrom && lesson.date <= review.validThrough).toBe(true);
  });

  it('does not invent metadata for either assessment in the two incomplete source cells', () => {
    const lessons = lessonsFor('ЗХТуд-125');
    const combined = lessons.find((lesson) => lesson.date === '2026-01-21' && lesson.start === '15:50');
    expect(combined.variants).toHaveLength(2);
    expect(combined.variants[0]).toMatchObject({ room: '101-СК1', teacher: 'Стародубцева С.В.', subject: 'Физическая культура и спорт', kind: 'зач' });
    expect(combined.variants[1]).toMatchObject({ subject: 'Электротехника и промышленная электроника', kind: 'переат' });
    expect(combined.variants[1].room).toBeUndefined();
    expect(combined.variants[1].teacher).toBeUndefined();
    const selected = lessonWithSelectedVariant(combined, 1);
    expect(selected.room).toBeUndefined();
    expect(selected.teacher).toBeUndefined();
    const language = lessons.find((lesson) => lesson.date === '2026-01-23' && lesson.start === '12:10');
    expect(language.variants.map((variant) => variant.kind)).toEqual(['переат', 'зач']);
    expect(language.variants.map((variant) => variant.room)).toEqual(['303 а-1', '303 а-1']);
    expect(language.variants.map((variant) => variant.teacher)).toEqual([undefined, 'Шаломова Е.В.']);
  });

  it('retains every exact original reviewed cell and its canonical interpretation', () => {
    const snapshot = byName('ЗХТуд-125');
    for (const correction of corrections) {
      const index = snapshot.schedule.findIndex((entry) => entry.date === correction.date && entry.start === correction.start);
      expect(snapshot.schedule[index]).toMatchObject({ name: correction.name, end: correction.end, scheduleKind: correction.scheduleKind });
      expect(snapshot.sourceCells.lessons[index]).toMatchObject({ rawText: correction.expectedRawText,
        lessonBox: correction.lessonBox, metadataReviewId: correction.id });
      expect(snapshot.sourceDocument.sha256).toBe(correction.sourceSha256);
    }
  });

  it('preserves printed unusual initials, annotations, numeric meeting and split-line rooms', () => {
    const lessons = lessonsFor('ЗХТуд-125');
    expect(lessons[0]).toMatchObject({ room: '426-1', subject: 'Организационное собрание', kind: 'собрание', start: '08:30', end: '10:00' });
    expect(lessons[0].teacher).toBeUndefined();
    expect(lessons.find((entry) => entry.date === '2026-01-20' && entry.start === '14:00').teacher).toBe('Денисов Ил.В.');
    expect(lessons.find((entry) => entry.date === '2026-01-23' && entry.start === '14:00').kind).toBe('экз п/а');
    const second = lessonsFor('ЗХТуд-124');
    expect(second.find((entry) => entry.subject === 'Социология').room).toBe('315 а-3');
    expect(second.find((entry) => entry.subject === 'Информатика').room).toBe('427 а-2');
  });

  it('preserves the source break and does not merge neighbouring assessments', () => {
    const state = findCurrentAndNext(lessonsFor('ЗХТд-125'), 'all', new Date('2026-01-21T11:55:00'));
    expect(state.current).toBeUndefined();
    expect(state.next).toMatchObject({ start: '12:10', end: '13:40', subject: 'Общая и неорганическая химия' });
  });

  it('adds seven exact catalog identities with 143 intervals from 142 unique source cells', () => {
    const result = buildUniversityBundle(catalog, snapshots, new Date('2026-10-14T12:00:00Z'));
    expect(result.report.available).toBe(7);
    expect(result.report.rejected).toEqual([]);
    expect(snapshots.reduce((sum, snapshot) => sum + snapshot.schedule.length, 0)).toBe(143);
    expect(new Set(snapshots.flatMap((snapshot) => snapshot.sourceCells.lessons.map((entry) =>
      `${snapshot.sourceDocument.sha256}:${entry.page}:${entry.table}:${entry.lessonBox.join(',')}`))).size).toBe(142);
  });
});
