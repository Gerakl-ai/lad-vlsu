import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeStaticSnapshot, scheduleStateFromSnapshot } from '../../src/lib/staticData';
import { normalizeSchedule } from '../../src/lib/scheduleApi';
import { selectDayLessons, findCurrentAndNext } from '../../src/lib/time';
import { buildIcs, eventsForDate } from '../../src/features/notes/SmartCalendarSheet';
import { compareScheduleDays, comparisonDay } from '../../src/features/groups/scheduleComparison';
import { sha256, scheduleQuality } from '../snapshot/buildSnapshot.mjs';
import { buildUniversityBundle } from '../snapshot/buildUniversityBundle.mjs';
import { buildReviewedDatedSnapshot } from '../spreadsheet/buildReviewedDatedSnapshot.mjs';

const reviews = JSON.parse(readFileSync(new URL('./reviewed-dated-ieit-january-2026.json', import.meta.url), 'utf8')).groups;
const metadata = JSON.parse(readFileSync(new URL('./reviewed-dated-ieit-metadata.json', import.meta.url), 'utf8')).corrections;
const timing = JSON.parse(readFileSync(new URL('./reviewed-dated-ieit-timing.json', import.meta.url), 'utf8')).corrections;
const catalog = JSON.parse(readFileSync(new URL('../../public/data/catalog.json', import.meta.url), 'utf8'));
const snapshots = reviews.map((review) => JSON.parse(readFileSync(new URL(`../../public/data/reviewed-schedule/${review.groupNrec}.json`, import.meta.url), 'utf8')));
const byName = (name) => snapshots.find((snapshot) => snapshot.group.name === name);
const lessonsFor = (name) => normalizeSchedule(byName(name).schedule);

describe('nine reviewed January Institute of Economics and Tourism archives', () => {
  it.each(snapshots.map((snapshot, index) => [snapshot.group.name, snapshot, reviews[index]]))('%s preserves all intervals, source identities and approval', (_, snapshot, review) => {
    const normalized = normalizeStaticSnapshot(snapshot, review.groupNrec);
    const state = scheduleStateFromSnapshot(normalized, normalizeSchedule, 1);
    expect(state.allLessons).toHaveLength(review.lessonCount);
    expect(snapshot.quality).toEqual(scheduleQuality(snapshot.schedule));
    expect(snapshot.scheduleHash).toBe(sha256({ semester: null, schedule: snapshot.schedule }));
    const stage = { schemaVersion: 1, purpose: 'dated-pdf-grid-staging', groupName: review.groupName, sheet: 'PDF', errors: [],
      source: { url: review.sourceUrl, sha256: review.sourceSha256, validFrom: review.validFrom, validThrough: review.validThrough,
        locations: snapshot.sourceCells.locations, bodyTextFilter: snapshot.sourceCells.bodyTextFilter, styles: snapshot.sourceCells.styles },
      lessons: snapshot.schedule.map(({ type, ...entry }, index) => ({ ...entry, evidence: snapshot.sourceCells.lessons[index] })) };
    expect(sha256(stage.lessons)).toBe(review.lessonsSha256);
    expect(buildReviewedDatedSnapshot(stage, catalog, review)).toEqual(snapshot);
    expect(state.allLessons.every((lesson) => lesson.date >= '2026-01-19' && lesson.date <= '2026-01-24')).toBe(true);
    expect(selectDayLessons(state.allLessons, 3, 'all', new Date('2026-10-14T12:00:00'))).toEqual([]);
    expect(snapshot.sourceCells.styles).toEqual([{ page: 1, ignoredWhiteCharacters: 3917, whiteBodyBackground: true }]);
    expect(state.allLessons.every((lesson) => !/M\d{8,}|\d{10}/.test(lesson.subject))).toBe(true);
  });

  it('retains the five shifted starts and four unresolved starts, never a guessed 17:30', () => {
    expect(timing).toHaveLength(9);
    expect(timing.filter((entry) => entry.mode === 'printed-start')).toHaveLength(5);
    for (const entry of timing) {
      const snapshot = byName(entry.groupName);
      const index = snapshot.sourceCells.lessons.findIndex((evidence) => evidence.timingReview?.id === entry.id);
      expect(snapshot.schedule[index].start).toBe('16:00');
      expect(snapshot.sourceCells.lessons[index].timingReview).toEqual(entry);
      if (entry.mode === 'unconfirmed') {
        expect(snapshot.schedule[index].timeStatus).toBe('unconfirmed');
        expect(snapshot.schedule[index]).not.toHaveProperty('end');
      } else expect(snapshot.schedule[index].end).toBe('17:20');
    }
  });

  it.each([['ЗГМУмд-125', '2026-01-21'], ['ЗМНмупд-125', '2026-01-20']])('%s keeps both conflicting subjects visible without false completion, calendar end or free windows', (name, key) => {
    const date = new Date(`${key}T18:00:00`);
    const lessons = lessonsFor(name);
    const info = findCurrentAndNext(lessons, 'all', date);
    expect(info.todayLessons.filter((lesson) => lesson.timeStatus)).toHaveLength(2);
    expect(info.current).toBeUndefined();
    expect(info.unconfirmed).toBeDefined();
    const events = eventsForDate(lessons, [], date, 'all', []);
    expect(events.filter((event) => !event.end)).toHaveLength(2);
    expect(buildIcs(events, name).split('BEGIN:VEVENT').length - 1).toBe(events.length - 2);
    const state = scheduleStateFromSnapshot(normalizeStaticSnapshot(byName(name), byName(name).group.nrec), normalizeSchedule, 1);
    expect(compareScheduleDays(comparisonDay(state, date), { availability: 'ready', lessons: [] })).toMatchObject({ windows: null, reason: 'unconfirmed' });
  });

  it('retains missing assessment kinds, both sports subjects and exact reassessment initials', () => {
    for (const entry of metadata) {
      const snapshot = byName(entry.groupName);
      const index = snapshot.sourceCells.lessons.findIndex((evidence) => evidence.metadataReviewId === entry.id);
      expect(snapshot.schedule[index].name).toBe(entry.name);
      expect(snapshot.sourceCells.lessons[index].rawText).toBe(entry.expectedRawText);
    }
    const sport = lessonsFor('ЗГДуд-125').find((lesson) => lesson.date === '2026-01-23' && lesson.start === '12:10');
    expect(sport.variants).toHaveLength(2);
    expect(sport.variants.every((variant) => variant.room === '101-СК1' && variant.teacher === 'Репникова Е.А.' && variant.kind === undefined)).toBe(true);
    expect(lessonsFor('ЗТРуд-125').find((lesson) => lesson.date === '2026-01-20' && lesson.start === '12:10').teacher).toBe('Стрельцов Р.В.');
    expect(lessonsFor('ЗГДуд-125').find((lesson) => lesson.date === '2026-01-22' && lesson.start === '15:50').teacher).toBe('Стрельцов Р.С.');
    expect(lessonsFor('ЗЭКмд-125').find((lesson) => lesson.date === '2026-01-21' && lesson.start === '12:10').subject).toBe('Функционально-стоимостной анализ деятельности фирмы');
  });

  it('preserves shared meetings without filling other groups blank cells', () => {
    for (const name of ['ЗУКд-125', 'ЗЭБд-125', 'ЗЭБуд-125', 'ЗЭКмд-125']) {
      const meeting = lessonsFor(name)[0];
      expect(meeting).toMatchObject({ date: '2026-01-19', start: '08:30', end: '10:00', room: '107-6', subject: 'Организационное собрание' });
      expect(meeting.teacher).toBeUndefined();
    }
    for (const name of ['ЗГДуд-125', 'ЗТРуд-125']) expect(lessonsFor(name)[0]).toMatchObject({ start: '14:00', room: '214-6' });
    expect(lessonsFor('ЗБИмд-125').some((lesson) => lesson.subject === 'Организационное собрание')).toBe(false);
  });

  it('adds nine catalog identities, 106 intervals from 101 source cells, with four explicit uncertainties', () => {
    const result = buildUniversityBundle(catalog, snapshots);
    expect(result.report.available).toBe(9);
    expect(result.report.rejected).toEqual([]);
    expect(snapshots.reduce((sum, snapshot) => sum + snapshot.schedule.length, 0)).toBe(106);
    expect(snapshots.reduce((sum, snapshot) => sum + (snapshot.quality.unconfirmedTimeEntries ?? 0), 0)).toBe(4);
    expect(new Set(snapshots.flatMap((snapshot) => snapshot.sourceCells.lessons.map((entry) => `${entry.page}:${entry.table}:${entry.lessonBox.join(',')}`))).size).toBe(101);
  });
});
