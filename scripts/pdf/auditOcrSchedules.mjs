import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { teachingWeekRestriction } from '../../src/lib/teachingWeeks.ts';

const snapshots = 'public/data/ocr-schedule';
const output = 'artifacts/pdf-staging/verification/content-audit.json';
const knownKinds = new Set(['лк', 'лб', 'пр', 'срп', 'индзан']);
const counts = { groups: 0, slots: 0, lines: 0, resolvedPeriods: 0, ambiguousPeriods: 0, unsupportedPeriods: 0, unusualKinds: 0 };
const flaggedGroups = new Set();
const issues = [];

for (const filename of (await readdir(snapshots)).sort()) {
  if (!/^[a-f\d]{32}\.json$/i.test(filename)) continue;
  const snapshot = JSON.parse(await readFile(path.join(snapshots, filename), 'utf8'));
  counts.groups++;
  for (const day of snapshot.schedule) {
    for (const [slot, value] of Object.entries(day)) {
      if (!/^[nz][1-7]$/.test(slot) || !value.trim()) continue;
      counts.slots++;
      for (const rawText of value.split('\n')) {
        counts.lines++;
        const restriction = teachingWeekRestriction(rawText);
        const flags = [];
        if (restriction.status === 'resolved') counts.resolvedPeriods++;
        if (restriction.status === 'ambiguous') {
          counts.ambiguousPeriods++;
          flags.push('multiple-periods-in-one-line');
        }
        if (restriction.status === 'unsupported') {
          counts.unsupportedPeriods++;
          flags.push('unparsed-teaching-period');
        }
        const parts = rawText.split(',');
        if (parts.length >= 4 && !knownKinds.has(parts[1].trim())) {
          counts.unusualKinds++;
          flags.push('unrecognized-lesson-kind-or-merged-text');
        }
        if (!flags.length) continue;
        flaggedGroups.add(snapshot.group.nrec);
        issues.push({ groupNrec: snapshot.group.nrec, groupName: snapshot.group.name,
          institute: snapshot.group.instituteShortName, day: day.name, slot, flags, rawText,
          source: snapshot.extraction });
      }
    }
  }
}
const report = { schemaVersion: 1, counts: { ...counts, flaggedGroups: flaggedGroups.size }, issues };
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report.counts, output }, null, 2));
