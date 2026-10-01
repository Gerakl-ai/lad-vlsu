import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyReviewedCellCorrections } from './reviewedCellCorrections.mjs';

const correction = JSON.parse(readFileSync(new URL('./reviewedCellCorrections.json', import.meta.url), 'utf8')).corrections
  .find((item) => item.dayIndex === 2 && item.pair === 7 && item.modes.length === 1 && item.modes[0] === 'n');
const location = { sourceId: correction.sourceId, member: correction.member, page: correction.page };
function fixture() {
  return {
    sourcePdfSha256: correction.sourcePdfSha256,
    schedule: [{}, { n7: correction.expectedRawText, z7: 'Другая пара' }],
    cells: [{ dayIndex: correction.dayIndex, pair: correction.pair, modes: [...correction.modes],
      bounds: [...correction.bounds], rawText: correction.expectedRawText, warnings: [] }]
  };
}

describe('source-bound reviewed corrections', () => {
  it('splits only the exact cell and preserves the source draft', () => {
    const original = fixture();
    const result = applyReviewedCellCorrections(original, location);
    expect(result.draft.schedule[1].n7.split('\n')).toEqual(correction.replacementLines);
    expect(result.draft.schedule[1].z7).toBe('Другая пара');
    expect(result.draft.cells[0].originalRawText).toBe(correction.expectedRawText);
    expect(result.correctionIds).toEqual([correction.id]);
    expect(original.schedule[1].n7).toBe(correction.expectedRawText);
  });
  it('does not apply to another PDF, page or geometry', () => {
    expect(applyReviewedCellCorrections({ ...fixture(), sourcePdfSha256: 'a'.repeat(64) }, location).correctionIds).toEqual([]);
    expect(applyReviewedCellCorrections(fixture(), { ...location, page: location.page + 1 }).correctionIds).toEqual([]);
    const changed = fixture();
    changed.cells[0].bounds[0]++;
    expect(applyReviewedCellCorrections(changed, location).correctionIds).toEqual([]);
  });
  it('requires another review when the source text or slot has changed', () => {
    const changed = fixture();
    changed.cells[0].rawText += '!';
    expect(() => applyReviewedCellCorrections(changed, location)).toThrow('Source cell changed');
    const missing = fixture();
    missing.schedule[1].n7 = 'Не та строка';
    expect(() => applyReviewedCellCorrections(missing, location)).toThrow('Slot changed');
  });
});
