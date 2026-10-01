import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { buildCoverageGapReport, buildUniversityBundle } from './buildUniversityBundle.mjs';
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
