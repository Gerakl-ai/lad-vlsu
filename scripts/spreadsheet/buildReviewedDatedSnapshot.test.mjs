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
