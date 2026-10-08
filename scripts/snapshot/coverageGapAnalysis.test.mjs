import { describe, expect, it } from 'vitest';
import { analyzeCoverageGaps } from './coverageGapAnalysis.mjs';

describe('coverage gap analysis', () => {
  it('counts catalog gaps by form and official document availability', () => {
    const catalog = { institutes: [
      { name: 'A', groups: [
        { nrec: 'one', forms: ['full-time'] },
        { nrec: 'two', forms: ['extramural'] }
      ] },
      { name: 'B', groups: [{ nrec: 'three', forms: ['part-time'] }] }
    ] };
    const coverage = { groups: { one: {}, removed: {} } };
    const documents = { groups: { two: {} } };
    expect(analyzeCoverageGaps(catalog, coverage, documents)).toEqual({
      catalogGroups: 3,
      availableInCatalog: 1,
      missing: 2,
      missingWithIndexedDocument: 1,
      byForm: { extramural: 1, 'part-time': 1 },
      byInstitute: [
        { institute: 'A', total: 2, missing: 1 },
        { institute: 'B', total: 1, missing: 1 }
      ]
    });
  });
});
