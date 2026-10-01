import { expect, it } from 'vitest';
import { buildUniversityBundle } from './buildUniversityBundle.mjs';
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
it('rejects ambiguous same-date content instead of silently picking a source', () => {
  const different = [{ ...schedule[0], n1: '111-3, лк, Пример П.П., Другой предмет' }];
  expect(() => buildUniversityBundle(catalog, [original, { ...original, schedule: different,
    scheduleHash: sha256({ semester: 5, schedule: different }) }])).toThrow('Conflicting');
});
