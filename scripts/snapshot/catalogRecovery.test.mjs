import { expect, it } from 'vitest';
import { recoverCatalog } from './catalogRecovery.mjs';
import { buildCatalog } from './buildSnapshot.mjs';

const stamp = '2026-10-14T08:43:41.207Z';
const group = (letter, forms = ['full-time']) => ({ nrec: letter.repeat(32), name: `${letter}-125`, course: '1 курс', forms });
const institute = (id, groups) => ({ id, name: id, groups, groupCount: groups.length });
const catalog = (institutes, capturedAt = stamp) => ({ schemaVersion: 3, capturedAt, institutes, instituteCount: institutes.length,
  groupCount: institutes.reduce((sum, item) => sum + item.groups.length, 0) });
const failure = (id, form = 'full-time') => ({ scope: 'groups', institute: id, form, reason: 'fetch failed' });

it('records the precise failed request during collection and retains only its saved membership', async () => {
  const report = { startedAt: stamp, failures: [] };
  const collected = await buildCatalog({ institutes: Infinity, groups: Infinity }, report, {
    fetchInstitutes: async () => [{ id: 'I', name: 'I' }],
    fetchGroups: async (_id, form) => {
      if (form === 0) throw new Error('fetch failed');
      return form === 1 ? [group('b', ['extramural'])] : [];
    }
  });
  expect(report.failures).toEqual([{ scope: 'groups', instituteId: 'I', institute: 'I', form: 'full-time', reason: 'fetch failed' }]);
  const result = recoverCatalog(catalog(collected), catalog([institute('I', [group('a'), group('c', ['part-time'])])]), report);
  expect(result.institutes[0].groups.map((item) => item.nrec)).toEqual(['a'.repeat(32), 'b'.repeat(32)]);
});

it('restores failed forms without restoring successfully removed forms or replacing fresh names', () => {
  const current = catalog([institute('I', [{ ...group('a'), name: 'Fresh name', course: '2 курс' }])]);
  const saved = catalog([institute('I', [group('a', ['full-time', 'extramural']), group('b', ['extramural']), group('c', ['part-time'])])], '2026-10-01T00:00:00Z');
  const result = recoverCatalog(current, saved, { startedAt: stamp, failures: [failure('I', 'extramural')] });
  expect(result.groupCount).toBe(2);
  expect(result.institutes[0].groups.find((item) => item.nrec === 'a'.repeat(32))).toMatchObject({ name: 'Fresh name', course: '2 курс', forms: ['full-time', 'extramural'] });
  expect(result.institutes[0].groups.some((item) => item.nrec === 'c'.repeat(32))).toBe(false);
  expect(result.recovery.restoredGroupIds).toEqual(['b'.repeat(32)]);
  expect(current.institutes[0].groups).toHaveLength(1);
});

it('restores a whole empty institute after all three requests fail, scoped by stable institute id', () => {
  const saved = catalog([institute('I', [group('a'), group('b', ['extramural']), group('c', ['part-time'])])]);
  const incoming = catalog([{ ...institute('I', []), name: 'Renamed I' }, institute('II', [])]);
  const result = recoverCatalog(incoming, saved, { startedAt: stamp, failures: ['full-time', 'extramural', 'part-time']
    .map((form) => ({ ...failure('Old name', form), instituteId: 'I' })) });
  expect(result.institutes[0].groups).toHaveLength(3);
  expect(result.institutes[1].groups).toEqual([]);
  expect(recoverCatalog(result, saved, { startedAt: stamp, failures: [failure('Renamed I')] })).toBe(result);
});

it('does not resurrect removed institutes, moved group identities or unrelated failures', () => {
  const saved = catalog([institute('I', [group('a'), group('b')]), institute('Deleted', [group('c')])]);
  const incoming = catalog([institute('I', []), institute('II', [group('a')])]);
  const result = recoverCatalog(incoming, saved, { startedAt: stamp, failures: [failure('I'), failure('Deleted')] });
  expect(result.institutes).toHaveLength(2);
  expect(result.institutes[0].groups.map((item) => item.nrec)).toEqual(['b'.repeat(32)]);
  expect(recoverCatalog(incoming, saved, { startedAt: stamp, failures: [{ scope: 'schedule', institute: 'I', form: 'full-time' }] })).toBe(incoming);
});

it.each([null, { startedAt: 'older', failures: [failure('I')] }, { startedAt: stamp, failures: [] }])('ignores missing or outdated failure evidence: %j', (status) => {
  const incoming = catalog([institute('I', [])]);
  expect(recoverCatalog(incoming, catalog([institute('I', [group('a')])]), status)).toBe(incoming);
});

it('does not fabricate fallback profiles from invalid ids or undocumented forms', () => {
  const incoming = catalog([institute('I', [])]);
  const saved = catalog([institute('I', [{ ...group('a'), nrec: 'bad' }, { ...group('b'), forms: ['made-up'] }])]);
  expect(recoverCatalog(incoming, saved, { startedAt: stamp, failures: [failure('I')] })).toBe(incoming);
});

it('does not make saved profiles look newly captured after repeated failed crawls', () => {
  const saved = catalog([institute('I', [group('a')])], '2026-10-01T00:00:00Z');
  const first = recoverCatalog(catalog([institute('I', [])]), saved, { startedAt: stamp, failures: [failure('I')] });
  const nextStamp = '2026-10-15T10:00:00Z';
  const next = recoverCatalog(catalog([institute('I', [])], nextStamp), first, { startedAt: nextStamp, failures: [failure('I')] });
  expect(next.institutes[0].groups[0].catalogRecovery.capturedAt).toBe('2026-10-01T00:00:00Z');
});
