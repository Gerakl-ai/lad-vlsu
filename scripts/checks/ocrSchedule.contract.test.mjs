import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('public/data/ocr-schedule');
const documents = JSON.parse(await readFile('public/data/document-index.json', 'utf8'));
const index = JSON.parse(await readFile(path.join(root, 'index.json'), 'utf8'));
const nrecs = Object.keys(index.groups);

describe('published provisional schedules', () => {
  it('bundles every available group with identical data for unvisited offline access', async () => {
    const bundle = JSON.parse(await readFile(path.join(root, 'bundle.json'), 'utf8'));
    expect(bundle.schemaVersion).toBe(1);
    expect(Object.keys(bundle.groups).sort()).toEqual([...nrecs].sort());
    for (const nrec of nrecs) {
      expect(bundle.groups[nrec]).toEqual(JSON.parse(await readFile(path.join(root, `${nrec}.json`), 'utf8')));
    }
  });
  it('contains one structured schedule for every verified document column', async () => {
    const files = (await readdir(root)).filter((name) => /^[a-f\d]{32}\.json$/i.test(name));
    expect(index.schemaVersion).toBe(1);
    expect(nrecs.length).toBe(633);
    expect(files.length).toBe(nrecs.length);
    expect(nrecs.sort()).toEqual(Object.keys(documents.groups).sort());
  });

  it('keeps group identity, source hash, period and provisional status intact', async () => {
    for (const nrec of nrecs) {
      const item = JSON.parse(await readFile(path.join(root, `${nrec}.json`), 'utf8'));
      const source = documents.groups[nrec];
      expect(item.group.nrec).toBe(nrec);
      expect(item.group.name).toBe(source.groupName);
      expect(item.extraction).toMatchObject({
        method: 'ocr', status: 'unreviewed', sourcePdfSha256: source.pdfSha256,
        member: source.member, page: source.page, column: source.column
      });
      expect(item.quality.valid).toBe(true);
      expect(item.quality.warnings).toContain('ocr-unreviewed');
      expect(item.validFrom).toBe(index.groups[nrec].validFrom);
      expect(item.validThrough).toBe(index.groups[nrec].validThrough);
      expect(item.validFrom <= item.validThrough).toBe(true);
      expect(item.schedule.some((day) => ['n', 'z'].some((mode) =>
        Array.from({ length: 7 }, (_, offset) => day[`${mode}${offset + 1}`]).some((value) => value?.trim())))).toBe(true);
    }
  });
});
