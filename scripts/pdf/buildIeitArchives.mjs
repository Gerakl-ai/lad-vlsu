import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildReviewedDatedSnapshot } from '../spreadsheet/buildReviewedDatedSnapshot.mjs';

const args = process.argv.slice(2);
const value = (key) => args[args.indexOf(key) + 1];
for (const flag of ['--stage-dir', '--catalog', '--review', '--out']) if (!args.includes(flag)) throw new Error(`Missing ${flag}`);
const catalog = JSON.parse(await readFile(value('--catalog'), 'utf8'));
const reviews = JSON.parse(await readFile(value('--review'), 'utf8'));
for (const review of reviews.groups) {
  const stage = JSON.parse(await readFile(path.join(value('--stage-dir'), `${review.groupName}.stage.json`), 'utf8'));
  const snapshot = buildReviewedDatedSnapshot(stage, catalog, review);
  const output = path.join(value('--out'), `${review.groupNrec}.json`);
  let existing;
  try { existing = await readFile(output, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const content = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (existing && existing !== content) throw new Error(`Existing archive differs: ${review.groupName}`);
  await writeFile(output, content);
  console.log(JSON.stringify({ group: review.groupName, lessons: snapshot.schedule.length,
    unconfirmed: snapshot.schedule.filter((lesson) => lesson.timeStatus).length, output }));
}
