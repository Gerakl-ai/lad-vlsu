import { describe, expect, it } from 'vitest';
import { buildOcrSnapshot } from './buildOcrSnapshot.mjs';

const nrec = 'a'.repeat(32);
const pdfSha256 = 'b'.repeat(64);
const dayNames = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница'];
const schedule = dayNames.map((name) => ({
  name, type: 'Lessons', pairLabels: [5, 6, 7],
  ...Object.fromEntries(['n', 'z'].flatMap((mode) =>
    Array.from({ length: 7 }, (_, index) => [`${mode}${index + 1}`, ''])))
}));
schedule[0].n5 = '111-3, лк, Пример П.П., Базы данных';
const draft = {
  schemaVersion: 1, purpose: 'ocr-draft-not-reviewed', groupNrec: nrec,
  sourcePdfSha256: pdfSha256, validFrom: '2026-09-01', validThrough: '2026-12-30',
  schedule, cells: [{ dayIndex: 1, pair: 5, modes: ['n'], rawText: schedule[0].n5,
    bounds: [100, 200, 300, 350], warnings: [] }]
};
const documents = {
  schemaVersion: 1, sources: { '027': { url: 'https://www.vlsu.ru/example.zip' } },
  groups: { [nrec]: { groupName: 'ВС-423', sourceId: '027', pdfSha256,
    member: 3, page: 7, column: 4 } }
};
const catalog = { schemaVersion: 3, institutes: [{ id: 'i', name: 'Институт', shortName: 'И',
  groups: [{ nrec, name: 'ВС-423', course: '4 курс', forms: ['part-time'] }] }] };

describe('OCR draft snapshot gate', () => {
  it('keeps evening pair numbers, source proof and unreviewed status', () => {
    const snapshot = buildOcrSnapshot(draft, documents, catalog);
    expect(snapshot.schedule[0].n5).toBe(schedule[0].n5);
    expect(snapshot.schedule[0].n1).toBe('');
    expect(snapshot.validThrough).toBe('2026-12-30');
    expect(snapshot.extraction).toMatchObject({ method: 'ocr', status: 'unreviewed',
      sourcePdfSha256: pdfSha256 });
    expect(snapshot.quality.warnings).toContain('ocr-unreviewed');
  });

  it.each([['030', '2026-09-29'], ['031', '2026-09-29'], ['032', '2026-09-30']])('dates revision %s by its actual order', (sourceId, capturedDate) => {
    const revised = { ...documents, sources: { [sourceId]: documents.sources['027'] },
      groups: { [nrec]: { ...documents.groups[nrec], sourceId } } };
    expect(buildOcrSnapshot(draft, revised, catalog).capturedAt).toBe(`${capturedDate}T00:00:00Z`);
  });

  it('rejects a draft with wrong source, period or missing visible cell', () => {
    expect(() => buildOcrSnapshot({ ...draft, sourcePdfSha256: 'c'.repeat(64) }, documents, catalog))
      .toThrow('official PDF');
    expect(() => buildOcrSnapshot({ ...draft, validThrough: '2026-08-01' }, documents, catalog))
      .toThrow('validity period');
    expect(() => buildOcrSnapshot({ ...draft, cells: [{ ...draft.cells[0], rawText: '' }] }, documents, catalog))
      .toThrow('unreadable PDF cell');
  });
});
