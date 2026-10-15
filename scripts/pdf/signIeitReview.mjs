import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from '../snapshot/buildSnapshot.mjs';

// Signs only the reviewed, fixed nine-column archive, not arbitrary staged data.
const SOURCE_SHA = 'f3a227e0f26fa2ea6542eb5eaede60f5d55ab9a67cf138ab37df20e31d1ddb5a';
const args = process.argv.slice(2);
const value = (key) => args[args.indexOf(key) + 1];
for (const flag of ['--stage-dir', '--catalog', '--out']) if (!args.includes(flag)) throw new Error(`Missing ${flag}`);
const catalog = JSON.parse(await readFile(value('--catalog'), 'utf8'));
const expected = { 'ЗБИмд-125': 5, 'ЗГДуд-125': 14, 'ЗГМУмд-125': 9, 'ЗМНмупд-125': 5, 'ЗТРуд-125': 18,
  'ЗУКд-125': 15, 'ЗЭБд-125': 13, 'ЗЭБуд-125': 20, 'ЗЭКмд-125': 7 };
const groups = [];
for (const [name, count] of Object.entries(expected)) {
  const stage = JSON.parse(await readFile(path.join(value('--stage-dir'), `${name}.stage.json`), 'utf8'));
  const matches = catalog.institutes.flatMap((institute) => institute.groups.filter((group) => group.name === name));
  if (matches.length !== 1 || !matches[0].forms.includes('extramural') || stage.purpose !== 'dated-pdf-grid-staging'
    || stage.source.sha256 !== SOURCE_SHA || stage.errors.length || stage.lessons.length !== count
    || stage.source.validFrom !== '2026-01-19' || stage.source.validThrough !== '2026-01-24'
    || stage.source.styles[0]?.ignoredWhiteCharacters !== 3917) throw new Error(`Reviewed source changed: ${name}`);
  groups.push({ status: 'approved', groupName: name, groupNrec: matches[0].nrec, studyForm: 'extramural', sheet: 'PDF',
    sourceUrl: stage.source.url, sourceSha256: SOURCE_SHA,
    title: 'Расписание экзаменационной сессии Института экономики и туризма, осенний семестр 2025/2026, 19-24 января',
    validFrom: '2026-01-19', validThrough: '2026-01-24', reviewedAt: '2026-10-14T13:49:20Z',
    lessonCount: count, lessonsSha256: sha256(stage.lessons),
    ...(stage.lessons.some((entry) => entry.evidence.timingReview) ? { timingReviewIds: stage.lessons
      .filter((entry) => entry.evidence.timingReview).map((entry) => entry.evidence.timingReview.id) } : {}) });
}
const content = `${JSON.stringify({ schemaVersion: 1, groups }, null, 2)}\n`;
let existing;
try { existing = await readFile(value('--out'), 'utf8'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (existing && existing !== content) throw new Error('Previously reviewed lessons changed; do not overwrite approval');
await writeFile(value('--out'), content);
console.log(JSON.stringify({ groups: groups.length, intervals: Object.values(expected).reduce((a, b) => a + b, 0), output: value('--out') }));
