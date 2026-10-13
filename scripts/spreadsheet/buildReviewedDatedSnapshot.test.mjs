import { describe, expect, it } from 'vitest';
import { buildReviewedDatedSnapshot } from './buildReviewedDatedSnapshot.mjs';
import { sha256 } from '../snapshot/buildSnapshot.mjs';

function fixtures() {
  const staging = { schemaVersion: 1, purpose: 'dated-spreadsheet-staging', groupName: 'ARCH-124', sheet: 'Source',
    source: { sha256: 'a'.repeat(64), url: 'https://www.vlsu.ru/schedule.xlsx', validFrom: '2026-02-02', validThrough: '2026-06-08', periodCell: 'A12' },
    errors: [], lessons: [{ date: '2026-02-02', start: '15:50', end: '19:10', name: '111-3, лк, Example E.E., Subject',
      evidence: { lessonCell: 'E20', rawText: 'Source subject', dateCell: 'A20', headerCell: 'E18', timeCells: { B20: '15.50-19.10' }, printedInterval: ['15:50', '19:10'] } }] };
  const review = { status: 'approved', groupName: staging.groupName, groupNrec: 'b'.repeat(32), sheet: staging.sheet,
    sourceSha256: staging.source.sha256, sourceUrl: staging.source.url, title: 'Official spring schedule',
    validFrom: staging.source.validFrom, validThrough: staging.source.validThrough, reviewedAt: '2026-10-12T14:08:03Z',
    lessonCount: 1, lessonsSha256: sha256(staging.lessons) };
  const catalog = { schemaVersion: 3, institutes: [{ id: 'institute', name: 'Institute', shortName: 'I', groups: [
    { nrec: review.groupNrec, name: review.groupName, forms: ['part-time'], course: null }
  ] }] };
  return { staging, review, catalog };
}

describe('reviewed dated spreadsheet import', () => {
  it('preserves dates, long hours, exact group identity and source references', () => {
    const { staging, review, catalog } = fixtures();
    const result = buildReviewedDatedSnapshot(staging, catalog, review);
    expect(result.semester).toBeNull();
    expect(result.schedule[0]).toMatchObject({ type: 'DatedLesson', date: '2026-02-02', start: '15:50', end: '19:10' });
    expect(result.quality).toMatchObject({ datedEntries: 1, examEntries: 0 });
    expect(result.sourceCells.lessons[0]).toMatchObject({ lesson: 'E20', group: 'E18', date: 'A20' });
  });

  it.each([{ sourceSha256: 'c'.repeat(64) }, { groupName: 'Other' }, { sheet: 'Other' },
    { validThrough: '2026-12-31' }, { status: 'pending' }, { lessonCount: 2 }, { lessonsSha256: 'c'.repeat(64) }])('rejects mismatched approval: %j', (change) => {
    const { staging, review, catalog } = fixtures();
    expect(() => buildReviewedDatedSnapshot(staging, catalog, { ...review, ...change })).toThrow();
  });

  it('rejects incomplete cells and invalid time even after a content signature is updated', () => {
    const { staging, review, catalog } = fixtures();
    expect(() => buildReviewedDatedSnapshot({ ...staging, errors: ['unreadable'] }, catalog, review)).toThrow();
    const broken = { ...staging, lessons: [{ ...staging.lessons[0], end: '14:00' }] };
    expect(() => buildReviewedDatedSnapshot(broken, catalog, { ...review, lessonsSha256: sha256(broken.lessons) })).toThrow();
  });
});

function pdfFixtures() {
  const result = fixtures();
  const box = [10, 20, 100, 40];
  result.staging.purpose = 'dated-pdf-grid-staging';
  result.staging.sheet = result.review.sheet = 'PDF';
  result.review.studyForm = 'extramural';
  result.catalog.institutes[0].groups[0].forms = ['extramural'];
  result.staging.source.locations = [{ page: 1, table: 1, headerBox: box, headerText: result.staging.groupName,
    periodBox: box, periodText: 'Source period', validFrom: result.review.validFrom, validThrough: result.review.validThrough }];
  const entry = result.staging.lessons[0];
  entry.scheduleKind = 'exam';
  entry.evidence = { page: 1, table: 1, lessonBox: box, headerBox: box, timeBox: box, dayBox: box,
    headerText: result.staging.groupName, rawText: 'Subject exam', timeText: '15:50-19:10', dayText: 'Monday 02.02', printedInterval: [entry.start, entry.end] };
  result.review.lessonsSha256 = sha256(result.staging.lessons);
  return result;
}

describe('reviewed dated PDF import', () => {
  it('keeps the assessment kind, explicit end and geometric evidence', () => {
    const { staging, catalog, review } = pdfFixtures();
    const result = buildReviewedDatedSnapshot(staging, catalog, review);
    expect(result.schedule[0]).toMatchObject({ scheduleKind: 'exam', end: '19:10' });
    expect(result.quality).toMatchObject({ datedEntries: 1, examEntries: 1 });
    expect(result.sourceCells).toMatchObject({ format: 'pdf-grid', distinctLessons: 1 });
  });

  it.each(['lessonBox', 'headerBox', 'dayBox', 'timeBox', 'headerText', 'timeText'])('rejects missing %s even with a signed content hash', (key) => {
    const { staging, catalog, review } = pdfFixtures();
    delete staging.lessons[0].evidence[key];
    review.lessonsSha256 = sha256(staging.lessons);
    expect(() => buildReviewedDatedSnapshot(staging, catalog, review)).toThrow();
  });

  it('does not allow changing study form or losing the group period', () => {
    const { staging, catalog, review } = pdfFixtures();
    expect(() => buildReviewedDatedSnapshot(staging, catalog, { ...review, studyForm: 'part-time' })).toThrow();
    staging.source.locations[0].validThrough = '2026-12-31';
    expect(() => buildReviewedDatedSnapshot(staging, catalog, review)).toThrow();
  });

  it('retains and counts both printed cells in a divided group column', () => {
    const { staging, catalog, review } = pdfFixtures();
    const evidence = staging.lessons[0].evidence;
    evidence.lessonBoxes = [evidence.lessonBox, [100, 20, 190, 40]];
    evidence.rawTexts = ['First source variant', 'Second source variant'];
    evidence.rawText = evidence.rawTexts.join('\n');
    review.lessonsSha256 = sha256(staging.lessons);
    const result = buildReviewedDatedSnapshot(staging, catalog, review);
    expect(result.sourceCells.distinctLessons).toBe(2);
    expect(result.sourceCells.lessons[0].lessonBoxes).toHaveLength(2);
    evidence.rawTexts.pop();
    review.lessonsSha256 = sha256(staging.lessons);
    expect(() => buildReviewedDatedSnapshot(staging, catalog, review)).toThrow();
  });
});
