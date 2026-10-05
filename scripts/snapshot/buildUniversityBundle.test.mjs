import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { buildCoverageGapReport, buildDataQualityReport, buildUniversityBundle } from './buildUniversityBundle.mjs';
import { sha256 } from './buildSnapshot.mjs';

const nrec = 'a'.repeat(32);
const catalog = { schemaVersion: 3, institutes: [{ id: 'iite', groups: [{ nrec, name: 'ПИ-124' }] }] };
const schedule = [{ type: 'Lessons', name: 'Понедельник', n1: '111-3, лб, Пример П.П., Базы данных' }];
const original = { schemaVersion: 3, group: { nrec, name: 'ПИ-124', instituteId: 'iite' }, semester: 5,
  schedule, scheduleHash: sha256({ semester: 5, schedule }), quality: { valid: true }, capturedAt: '2026-09-03T00:00:00Z' };
it('retains the newer valid snapshot regardless of input order, without altering metadata', () => {
  const newer = { ...original, capturedAt: '2026-10-01T00:00:00Z', provenance: { commit: 'verified' } };
  for (const snapshots of [[original, newer], [newer, original]]) {
    expect(buildUniversityBundle(catalog, snapshots).bundle.groups[nrec]).toEqual(newer);
  }
});
it('does not let a newer unreviewed OCR replace an available API schedule for the same semester', () => {
  const unreviewed = { ...original, capturedAt: '2026-10-02T00:00:00Z',
    extraction: { method: 'ocr', status: 'unreviewed' },
    quality: { valid: true, warnings: ['ocr-unreviewed'] } };
  for (const candidates of [[original, unreviewed], [unreviewed, original]]) {
    expect(buildUniversityBundle(catalog, candidates, new Date('2026-10-05T12:00:00Z'))
      .bundle.groups[nrec]).toEqual(original);
  }
});
it('can use the current semester preliminary document when the API snapshot belongs to an older semester', () => {
  const currentSemester = { ...original, semester: 7, capturedAt: '2027-09-03T00:00:00Z',
    scheduleHash: sha256({ semester: 7, schedule }),
    extraction: { method: 'ocr', status: 'unreviewed' },
    quality: { valid: true, warnings: ['ocr-unreviewed'] } };
  expect(buildUniversityBundle(catalog, [original, currentSemester], new Date('2027-10-05T12:00:00Z'))
    .bundle.groups[nrec]).toEqual(currentSemester);
});
it('does not mistake an autumn recapture of old spring data for next spring', () => {
  const staleSpring = { ...original, semester: 6, capturedAt: '2026-10-05T00:00:00Z',
    scheduleHash: sha256({ semester: 6, schedule }) };
  const currentAutumn = { ...original, semester: 7, capturedAt: '2026-09-03T00:00:00Z',
    scheduleHash: sha256({ semester: 7, schedule }),
    extraction: { method: 'ocr', status: 'unreviewed' },
    quality: { valid: true, warnings: ['ocr-unreviewed'] } };
  for (const candidates of [[staleSpring, currentAutumn], [currentAutumn, staleSpring]]) {
    expect(buildUniversityBundle(catalog, candidates, new Date('2026-10-05T12:00:00Z'))
      .bundle.groups[nrec]).toEqual(currentAutumn);
  }
});
it.each([{ schedule: [] }, { scheduleHash: 'b'.repeat(64) }, { capturedAt: 'broken' },
  { group: { ...original.group, instituteId: 'other' } }, { quality: { valid: false } }])('preserves a valid fallback when a newer candidate is invalid: %j', (fields) => {
  const result = buildUniversityBundle(catalog, [original, { ...original, capturedAt: '2026-10-01T00:00:00Z', ...fields }]);
  expect(result.bundle.groups[nrec]).toEqual(original);
  expect(result.report.rejected).toHaveLength(1);
});
it('reports missing groups, not fabricated empty schedules', () => {
  const result = buildUniversityBundle(catalog, []);
  expect(result.report.missing).toEqual([nrec]);
  expect(result.bundle.groups).toEqual({});
});
it('publishes a per-institute and per-form gap report without counting available groups as missing', () => {
  const absent = 'b'.repeat(32);
  const secondCatalog = { schemaVersion: 3, capturedAt: '2026-10-01T00:00:00Z', institutes: [
    { id: 'iite', name: 'ИИТЭ', shortName: 'ИИТЭ', groups: [
      { nrec, name: 'ПИ-124', forms: ['full-time'], course: '3 курс' },
      { nrec: absent, name: 'ЗИСТд-126', forms: ['extramural', 'part-time'], course: '1 курс' }
    ] }
  ] };
  const { bundle } = buildUniversityBundle(secondCatalog, [original]);
  const gaps = buildCoverageGapReport(secondCatalog, bundle);
  expect(gaps).toMatchObject({ total: 2, available: 1, missing: 1 });
  expect(gaps.institutes[0]).toMatchObject({ total: 2, available: 1, missingCount: 1,
    missingByForm: { extramural: 1, 'part-time': 1 } });
  expect(gaps.institutes[0].missing).toEqual([{ nrec: absent, name: 'ЗИСТд-126',
    course: '1 курс', forms: ['extramural', 'part-time'] }]);
});
it('distinguishes preliminary, reviewed and other available snapshots without claiming verification', () => {
  const preliminaryId = 'b'.repeat(32);
  const reviewedId = 'c'.repeat(32);
  const missingId = 'd'.repeat(32);
  const testCatalog = { schemaVersion: 3, capturedAt: '2026-10-02T00:00:00Z', institutes: [{
    id: 'iite', name: 'ИИТЭ', groups: [
      { nrec, name: 'ПИ-124' },
      { nrec: preliminaryId, name: 'ПИ-125' },
      { nrec: reviewedId, name: 'ПИ-126' },
      { nrec: missingId, name: 'ПИ-127' }
    ]
  }] };
  const cloneFor = (id, name) => ({ ...original, group: { ...original.group, nrec: id, name } });
  const { bundle } = buildUniversityBundle(testCatalog, [
    original,
    { ...cloneFor(preliminaryId, 'ПИ-125'), extraction: { status: 'unreviewed' } },
    { ...cloneFor(reviewedId, 'ПИ-126'), sourceDocument: { reviewedAt: '2026-10-01T00:00:00Z' } }
  ]);
  const report = buildDataQualityReport(testCatalog, bundle);
  expect(report).toMatchObject({ total: 4, preliminary: 1, reviewedDocument: 1,
    otherAvailable: 1, missing: 1 });
  expect(report.groups[preliminaryId]).toMatchObject({ category: 'preliminary', instituteId: 'iite' });
  expect(report.groups[missingId]).toEqual({ name: 'ПИ-127', instituteId: 'iite', category: 'missing' });
  expect(report.institutes[0]).toMatchObject({ total: 4, preliminary: 1, reviewedDocument: 1,
    otherAvailable: 1, missing: 1 });
  expect(buildDataQualityReport(testCatalog, { groups: {
    [nrec]: { ...original, quality: { valid: true, warnings: null }, sourceDocument: { reviewedAt: 'broken' } }
  } }).groups[nrec].category).toBe('otherAvailable');
});
it('reports declared and estimated semester windows separately from content quality', () => {
  const declaredId = 'b'.repeat(32);
  const examId = 'c'.repeat(32);
  const periodCatalog = { schemaVersion: 3, institutes: [{ id: 'iite', name: 'ИИТЭ', groups: [
    { nrec, name: 'ПИ-124' }, { nrec: declaredId, name: 'ПИ-125' }, { nrec: examId, name: 'ПИ-126' }
  ] }] };
  const snapshots = { groups: {
    [nrec]: original,
    [declaredId]: { ...original, validFrom: '2026-10-01', validThrough: '2026-10-31' },
    [examId]: { ...original, schedule: [{ type: 'ExamSession', date: '2026-10-10' }] }
  } };
  const report = buildDataQualityReport(periodCatalog, snapshots, new Date('2027-01-05T12:00:00Z'));
  expect(report.periodWindows).toEqual({ within: 0, before: 0, after: 2, unknown: 1 });
  expect(report.groups[nrec].period).toEqual({ status: 'after', basis: 'estimated',
    validFrom: '2026-09-01', validThrough: '2026-12-31' });
  expect(report.groups[declaredId].period).toEqual({ status: 'after', basis: 'declared',
    validFrom: '2026-10-01', validThrough: '2026-10-31' });
  expect(report.groups[examId].period).toEqual({ status: 'unknown', basis: 'unknown' });
  expect(buildDataQualityReport(periodCatalog, snapshots, new Date('2026-10-01T12:00:00Z'))
    .periodWindows).toEqual({ within: 2, before: 0, after: 0, unknown: 1 });
  expect(buildDataQualityReport(periodCatalog, snapshots, new Date('2026-08-31T12:00:00Z'))
    .periodWindows).toEqual({ within: 0, before: 2, after: 0, unknown: 1 });
  expect(buildDataQualityReport(periodCatalog, { groups: {
    [nrec]: { ...original, validFrom: '2026-02-31', validThrough: '2026-06-30' }
  } }, new Date('2026-03-01T12:00:00Z')).groups[nrec].period)
    .toEqual({ status: 'unknown', basis: 'unknown' });
  expect(buildDataQualityReport(periodCatalog, { groups: {
    [nrec]: { ...original, semester: 6, capturedAt: '2027-01-10T00:00:00Z' }
  } }, new Date('2027-05-01T12:00:00Z')).groups[nrec].period)
    .toEqual({ status: 'within', basis: 'estimated',
      validFrom: '2027-02-01', validThrough: '2027-06-30' });
  expect(buildDataQualityReport(periodCatalog, { groups: {
    [nrec]: { ...original, semester: 6, capturedAt: '2026-10-05T00:00:00Z' }
  } }, new Date('2026-10-05T12:00:00Z')).groups[nrec].period)
    .toEqual({ status: 'after', basis: 'estimated',
      validFrom: '2026-02-01', validThrough: '2026-06-30' });
});
it('rejects ambiguous same-date content instead of silently picking a source', () => {
  const different = [{ ...schedule[0], n1: '111-3, лк, Пример П.П., Другой предмет' }];
  expect(() => buildUniversityBundle(catalog, [original, { ...original, schedule: different,
    scheduleHash: sha256({ semester: 5, schedule: different }) }])).toThrow('Conflicting');
});

it('keeps the published gap report aligned with the catalog and coverage', async () => {
  const [publishedCatalog, coverage, gaps] = await Promise.all([
    readFile('public/data/catalog.json', 'utf8').then(JSON.parse),
    readFile('public/data/coverage.json', 'utf8').then(JSON.parse),
    readFile('public/data/gaps.json', 'utf8').then(JSON.parse)
  ]);
  const missingIds = publishedCatalog.institutes.flatMap((institute) => institute.groups)
    .filter((group) => !coverage.groups[group.nrec]).map((group) => group.nrec).sort();
  const reportedIds = gaps.institutes.flatMap((institute) => institute.missing.map((group) => group.nrec)).sort();
  expect(reportedIds).toEqual(missingIds);
  expect(gaps.total).toBe(coverage.catalogGroups);
  expect(gaps.available).toBe(coverage.available);
  expect(gaps.missing).toBe(missingIds.length);
  expect(gaps.institutes.map((institute) => institute.total))
    .toEqual(publishedCatalog.institutes.map((institute) => institute.groups.length));
});
