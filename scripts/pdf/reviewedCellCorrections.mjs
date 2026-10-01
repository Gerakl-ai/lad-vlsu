import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('./reviewedCellCorrections.json', import.meta.url), 'utf8'));

export function applyReviewedCellCorrections(draft, location, corrections = manifest.corrections) {
  const result = structuredClone(draft);
  const applied = [];
  for (const correction of corrections) {
    if (correction.sourcePdfSha256 !== draft.sourcePdfSha256 || correction.sourceId !== location.sourceId
      || correction.member !== location.member || correction.page !== location.page) continue;
    const cell = result.cells.find((item) => item.dayIndex === correction.dayIndex && item.pair === correction.pair
      && JSON.stringify(item.modes) === JSON.stringify(correction.modes)
      && JSON.stringify(item.bounds) === JSON.stringify(correction.bounds));
    if (!cell) continue;
    if (cell.rawText !== correction.expectedRawText) throw new Error(`Source cell changed: ${correction.id}`);
    if (!Array.isArray(correction.replacementLines) || !correction.replacementLines.length
      || correction.replacementLines.some((line) => typeof line !== 'string' || !line.trim() || line.includes('\n'))) {
      throw new Error(`Invalid reviewed transcription: ${correction.id}`);
    }
    const replacement = correction.replacementLines.join('\n');
    for (const mode of cell.modes) {
      const key = `${mode}${cell.pair}`;
      const slot = result.schedule[cell.dayIndex - 1]?.[key];
      if (typeof slot !== 'string') throw new Error(`Slot changed: ${correction.id}`);
      const lines = slot.split('\n');
      if (lines.filter((line) => line === cell.rawText).length !== 1) throw new Error(`Slot changed: ${correction.id}`);
      result.schedule[cell.dayIndex - 1][key] = lines.map((line) => line === cell.rawText ? replacement : line).join('\n');
    }
    cell.originalRawText = cell.rawText;
    cell.rawText = replacement;
    cell.reviewCorrectionId = correction.id;
    applied.push(correction.id);
  }
  return { draft: result, correctionIds: applied };
}
