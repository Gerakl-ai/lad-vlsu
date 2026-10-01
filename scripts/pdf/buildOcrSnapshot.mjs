import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { scheduleQuality, sha256 } from '../snapshot/buildSnapshot.mjs';
import { applyReviewedCellCorrections } from './reviewedCellCorrections.mjs';

const DAY_NAMES = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
const SOURCE_DATES = { '029': '2026-09-03', '028': '2026-09-03', '027': '2026-08-18',
  '030': '2026-09-29', '031': '2026-09-29', '032': '2026-09-30' };
// These four geometries were checked against the rendered source columns.
const VERIFIED_BLANKS = new Set([
  '3b3b53d4d091f5049e09b6a5a1c86b77:3:1:n:632.2,1520.7,802.3,1563.23',
  '6fdf18a1154723d5aa443d534d6de1e7:4:1:n,z:901.53,1861.6,1057.45,1946.65',
  '75c7984a7798decb7f672e6db0fdec98:5:1:n:584.01,2372.61,739.93,2415.13',
  'cdfae4c96f157c39ef706a1f01048ea8:1:2:n:584.01,413.64,739.93,456.16'
]);
const VERIFIED_BLANK_SOURCES = {
  '3b3b53d4d091f5049e09b6a5a1c86b77': '054e4baadf70f3a131a294223f2027778e38d5f40eb9ee279eada1f134dca3f3',
  '6fdf18a1154723d5aa443d534d6de1e7': '0193bc8d5528f49cac627b106ef9fa3fcef0acabbbc4ba0b9a43d864cf9e24c7',
  '75c7984a7798decb7f672e6db0fdec98': '854883ecd1317821ef54f18220e0a7d454858393217136affe4271b562b1836c',
  'cdfae4c96f157c39ef706a1f01048ea8': '854883ecd1317821ef54f18220e0a7d454858393217136affe4271b562b1836c'
};

function verifiedBlank(groupNrec, cell, sourcePdfSha256) {
  const key = `${groupNrec}:${cell.dayIndex}:${cell.pair}:${cell.modes.join(',')}:${cell.bounds.join(',')}`;
  return cell.warnings.includes('visible-text-ocr-empty') && VERIFIED_BLANKS.has(key)
    && VERIFIED_BLANK_SOURCES[groupNrec] === sourcePdfSha256;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function buildOcrSnapshot(draft, documents, catalog) {
  assert(draft?.schemaVersion === 1 && draft.purpose === 'ocr-draft-not-reviewed', 'Unknown OCR draft');
  assert(documents?.schemaVersion === 1 && catalog?.schemaVersion === 3, 'Unknown source index or catalog');
  const location = documents.groups?.[draft.groupNrec];
  assert(location && location.pdfSha256 === draft.sourcePdfSha256, 'OCR source does not match the official PDF');
  const corrected = applyReviewedCellCorrections(draft, location);
  draft = corrected.draft;
  const source = documents.sources?.[location.sourceId];
  assert(source && source.url.startsWith('https://www.vlsu.ru/'), 'Official source is missing');
  assert(validDate(SOURCE_DATES[location.sourceId]), 'Unknown official revision date');
  assert(validDate(draft.validFrom) && validDate(draft.validThrough)
    && draft.validFrom <= draft.validThrough, 'Group column has no verified validity period');
  const institute = catalog.institutes.find((item) => item.groups.some((group) => group.nrec === draft.groupNrec));
  const group = institute?.groups.find((item) => item.nrec === draft.groupNrec);
  assert(group && group.name === location.groupName, 'PDF group does not match the catalog');
  assert(Array.isArray(draft.schedule) && [5, 6].includes(draft.schedule.length), 'Invalid weekdays');
  const schedule = draft.schedule.map((day, index) => {
    assert(day?.type === 'Lessons' && day.name === DAY_NAMES[index], 'Day order does not match the PDF');
    assert(Array.isArray(day.pairLabels) && day.pairLabels.every((pair) => Number.isInteger(pair)
      && pair >= 1 && pair <= 7), 'Pair numbers were not verified');
    const result = { name: day.name, type: 'Lessons' };
    for (const mode of ['n', 'z']) {
      for (let pair = 1; pair <= 7; pair++) {
        const key = `${mode}${pair}`;
        assert(typeof day[key] === 'string', `Missing ${day.name}/${key}`);
        result[key] = day[key];
      }
    }
    return result;
  });
  assert(Array.isArray(draft.cells) && draft.cells.every((cell) =>
    cell && Number.isInteger(cell.dayIndex) && cell.dayIndex >= 1
    && cell.dayIndex <= schedule.length && Number.isInteger(cell.pair)
    && cell.pair >= 1 && cell.pair <= 7 && Array.isArray(cell.modes)
    && cell.modes.length > 0 && cell.modes.every((mode) => mode === 'n' || mode === 'z')
    && typeof cell.rawText === 'string'
    && Array.isArray(cell.warnings)
    && Array.isArray(cell.bounds) && cell.bounds.length === 4
    && (cell.rawText.trim() || verifiedBlank(draft.groupNrec, cell, draft.sourcePdfSha256))), 'OCR left an unreadable PDF cell');
  for (const cell of draft.cells) {
    if (!cell.rawText.trim()) continue;
    for (const mode of cell.modes) {
      assert(schedule[cell.dayIndex - 1][`${mode}${cell.pair}`].includes(cell.rawText),
        'OCR cell does not match its schedule slot');
    }
  }
  const quality = scheduleQuality(schedule);
  assert(quality, 'OCR extracted no lessons');
  quality.warnings = ['ocr-unreviewed'];
  const course = Number.parseInt(group.course, 10);
  const semester = Number.isInteger(course) ? course * 2 - 1 : null;
  return {
    schemaVersion: 3,
    group: {
      nrec: group.nrec, name: group.name, course: group.course,
      forms: group.forms, instituteId: institute.id, instituteName: institute.name,
      instituteShortName: institute.shortName
    },
    semester,
    schedule, quality,
    scheduleHash: sha256({ semester, schedule }),
    capturedAt: `${SOURCE_DATES[location.sourceId]}T00:00:00Z`,
    validFrom: draft.validFrom,
    validThrough: draft.validThrough,
    extraction: {
      method: 'ocr', status: 'unreviewed',
      sourceUrl: source.url, sourcePdfSha256: location.pdfSha256,
      member: location.member, page: location.page, column: location.column,
      flaggedCells: draft.cells.filter((cell) => cell.warnings.length).length,
      ...(corrected.correctionIds.length ? { reviewedCorrectionIds: corrected.correctionIds } : {})
    },
    provenance: null
  };
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag) => {
    const index = args.indexOf(flag);
    return index < 0 ? null : args[index + 1];
  };
  const draftsDir = path.resolve(value('--drafts') || 'artifacts/pdf-staging/bulk');
  const out = path.resolve(value('--out') || 'artifacts/pdf-staging/compiled');
  const documents = JSON.parse(await readFile(value('--index') || 'public/data/document-index.json', 'utf8'));
  const catalog = value('--catalog')
    ? JSON.parse(await readFile(value('--catalog'), 'utf8'))
    : JSON.parse(execFileSync('git', ['show', 'origin/data:data/catalog.json'], { encoding: 'utf8' }));
  const report = { built: 0, rejected: [] };
  const available = {};
  const bundled = {};
  await mkdir(out, { recursive: true });
  for (const name of await readdir(draftsDir)) {
    if (!/^[a-f\d]{32}\.json$/i.test(name)) continue;
    try {
      const draft = JSON.parse(await readFile(path.join(draftsDir, name), 'utf8'));
      const snapshot = buildOcrSnapshot(draft, documents, catalog);
      await writeFile(path.join(out, name), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
      available[snapshot.group.nrec] = {
        validFrom: snapshot.validFrom,
        validThrough: snapshot.validThrough
      };
      bundled[snapshot.group.nrec] = snapshot;
      report.built++;
    } catch (error) {
      report.rejected.push({ name, error: error.message });
    }
  }
  await writeFile(path.join(out, 'index.json'), `${JSON.stringify({
    schemaVersion: 1,
    groups: Object.fromEntries(Object.entries(available).sort(([left], [right]) => left.localeCompare(right)))
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(out, 'bundle.json'), `${JSON.stringify({
    schemaVersion: 1,
    groups: Object.fromEntries(Object.entries(bundled).sort(([left], [right]) => left.localeCompare(right)))
  })}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
