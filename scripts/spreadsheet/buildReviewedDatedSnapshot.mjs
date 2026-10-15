import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scheduleQuality, sha256 } from '../snapshot/buildSnapshot.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validBox(box) {
  return Array.isArray(box) && box.length === 4 && box.every(Number.isFinite)
    && box[0] >= 0 && box[1] >= 0 && box[0] < box[2] && box[1] < box[3];
}

function hasPdfEvidence(entry, groupName) {
  const evidence = entry.evidence;
  return evidence && Number.isInteger(evidence.page) && evidence.page > 0
    && Number.isInteger(evidence.table) && evidence.table > 0
    && ['lessonBox', 'timeBox', 'dayBox', 'headerBox'].every((key) => validBox(evidence[key]))
    && evidence.rawText?.trim() && evidence.timeText?.trim() && evidence.dayText?.trim()
    && evidence.headerText === groupName
    && (evidence.lessonBoxes === undefined && evidence.rawTexts === undefined || Array.isArray(evidence.lessonBoxes) && evidence.lessonBoxes.length > 1
      && evidence.lessonBoxes.every(validBox) && Array.isArray(evidence.rawTexts)
      && evidence.rawTexts.length === evidence.lessonBoxes.length && evidence.rawTexts.every((raw) => typeof raw === 'string' && raw.trim())
      && JSON.stringify(evidence.lessonBox) === JSON.stringify(evidence.lessonBoxes[0])
      && evidence.rawText === evidence.rawTexts.join('\n'));
}

function timePrefix(value) {
  const match = /^\s*(\d{1,2}:[0-5]\d)\s+/.exec(value ?? '');
  return match ? match[1].padStart(5, '0') : null;
}

function retainsReviewedTime(entry, staging, review, timingIds) {
  const evidence = entry.evidence;
  const resolution = evidence.timingReview;
  const interval = evidence.printedInterval;
  if (!resolution) return entry.timeStatus === undefined && interval?.[0] === entry.start && interval?.[1] === entry.end;
  if (staging.purpose !== 'dated-pdf-grid-staging' || !review.timingReviewIds?.includes(resolution.id)
    || timingIds.has(resolution.id) || resolution.sourceSha256 !== staging.source.sha256
    || resolution.groupName !== staging.groupName || resolution.page !== evidence.page
    || resolution.date !== entry.date || resolution.gridStart !== interval?.[0] || resolution.gridEnd !== interval?.[1]
    || JSON.stringify(resolution.lessonBox) !== JSON.stringify(evidence.lessonBox)
    || resolution.expectedRawText !== evidence.rawText || resolution.expectedVisibleText !== (evidence.visibleText ?? evidence.rawText)
    || !resolution.reason?.trim() || resolution.printedStart !== entry.start
    || timePrefix(evidence.visibleText ?? evidence.rawText) !== entry.start) return false;
  let valid = false;
  if (resolution.mode === 'printed-start') {
    valid = entry.timeStatus === undefined && entry.end === interval[1] && interval[0] < entry.start && entry.start < interval[1];
  } else if (resolution.mode === 'unconfirmed' && entry.timeStatus === 'unconfirmed' && entry.end === undefined) {
    if (resolution.conflict === 'outside-grid') valid = entry.start < interval[0] || entry.start >= interval[1];
    if (resolution.conflict === 'coincident-start') {
      const related = resolution.relatedCell;
      const match = /^\s*(\d{1,2}:[0-5]\d)\s*[-\u2013\u2014]\s*(\d{1,2}:[0-5]\d)\s*$/.exec(related?.timeText ?? '');
      const from = match?.[1].padStart(5, '0');
      const through = match?.[2].padStart(5, '0');
      valid = interval[0] <= entry.start && entry.start < interval[1] && related?.page === evidence.page && related?.table === evidence.table
        && ['lessonBox', 'timeBox', 'dayBox'].every((key) => validBox(related[key]))
        && related.expectedRawText?.trim() && related.expectedVisibleText?.trim() && related.dayText === evidence.dayText
        && timePrefix(related.expectedVisibleText) === entry.start && from && through && from < through
        && (entry.start < from || entry.start >= through);
    }
  }
  if (valid) timingIds.add(resolution.id);
  return Boolean(valid);
}

export function buildReviewedDatedSnapshot(staging, catalog, review) {
  assert(staging?.schemaVersion === 1 && ['dated-spreadsheet-staging', 'dated-pdf-grid-staging'].includes(staging.purpose), 'Unknown dated staging');
  const pdf = staging.purpose === 'dated-pdf-grid-staging';
  assert(catalog?.schemaVersion === 3 && review?.status === 'approved', 'Catalog or source review is missing');
  assert(Array.isArray(staging.errors) && !staging.errors.length, 'Source cells were not fully extracted');
  assert(staging.source?.sha256 === review.sourceSha256 && /^[a-f\d]{64}$/i.test(review.sourceSha256), 'Source hash mismatch');
  assert(staging.source.url === review.sourceUrl && staging.source.url.startsWith('https://www.vlsu.ru/'), 'Official source URL mismatch');
  assert(staging.sheet === review.sheet && staging.groupName === review.groupName, 'Wrong worksheet or group');
  assert(validDate(review.validFrom) && validDate(review.validThrough) && review.validFrom <= review.validThrough
    && staging.source.validFrom === review.validFrom && staging.source.validThrough === review.validThrough, 'Source period mismatch');
  assert(typeof review.reviewedAt === 'string' && Number.isFinite(Date.parse(review.reviewedAt)), 'Review date is missing');
  assert(typeof review.title === 'string' && review.title.trim(), 'Source title is missing');
  const institute = catalog.institutes.find((item) => item.groups.some((group) => group.nrec === review.groupNrec));
  const group = institute?.groups.find((item) => item.nrec === review.groupNrec);
  const studyForm = pdf ? review.studyForm : 'part-time';
  assert(['full-time', 'part-time', 'extramural'].includes(studyForm)
    && group?.name === review.groupName && group.forms?.includes(studyForm), 'Group or study form does not match the catalog');
  if (pdf) {
    assert(Array.isArray(staging.source.locations) && staging.source.locations.length > 0
      && staging.source.locations.every((location) => Number.isInteger(location.page) && location.page > 0
        && Number.isInteger(location.table) && location.table > 0 && validBox(location.headerBox) && validBox(location.periodBox)
        && location.headerText === review.groupName && location.periodText?.trim()
        && location.validFrom === review.validFrom && location.validThrough === review.validThrough), 'PDF group period evidence is missing');
  }
  assert(Array.isArray(staging.lessons) && staging.lessons.length === review.lessonCount
    && sha256(staging.lessons) === review.lessonsSha256, 'Reviewed lessons changed');
  const seen = new Set();
  const timingIds = new Set();
  const schedule = staging.lessons.map((entry) => {
    assert(pdf ? hasPdfEvidence(entry, review.groupName) : entry?.evidence?.lessonCell && entry.evidence.rawText?.trim()
      && entry.evidence.dateCell && entry.evidence.headerCell && Object.keys(entry.evidence.timeCells ?? {}).length,
    'Lesson has no cell evidence');
    assert(validDate(entry.date) && entry.date >= review.validFrom && entry.date <= review.validThrough, 'Lesson is outside the declared period');
    assert(retainsReviewedTime(entry, staging, review, timingIds),
      'Lesson does not retain its printed interval');
    const identity = `${entry.date}:${entry.start}:${entry.end}:${entry.name}`;
    assert(!seen.has(identity), 'Duplicate dated lesson');
    seen.add(identity);
    assert(!pdf || ['classes', 'exam'].includes(entry.scheduleKind), 'Dated PDF lesson kind is missing');
    return { type: 'DatedLesson', date: entry.date, start: entry.start,
      ...(entry.timeStatus === 'unconfirmed' ? { timeStatus: entry.timeStatus } : { end: entry.end }), name: entry.name,
      ...(pdf ? { scheduleKind: entry.scheduleKind } : {}) };
  });
  assert(JSON.stringify([...timingIds].sort()) === JSON.stringify([...(review.timingReviewIds ?? [])].sort()), 'Reviewed timing IDs changed');
  const quality = scheduleQuality(schedule);
  assert(quality && quality.datedEntries === schedule.length, 'Invalid dates or explicit time intervals');
  return {
    schemaVersion: 3,
    group: { ...group, instituteId: institute.id, instituteName: institute.name, instituteShortName: institute.shortName },
    semester: null,
    schedule, quality, scheduleHash: sha256({ semester: null, schedule }),
    capturedAt: review.reviewedAt,
    validFrom: review.validFrom, validThrough: review.validThrough,
    sourceDocument: { title: review.title, url: review.sourceUrl, sha256: review.sourceSha256, reviewedAt: review.reviewedAt },
    sourceCells: pdf ? { format: 'pdf-grid', locations: staging.source.locations,
      ...(staging.source.bodyTextFilter ? { bodyTextFilter: staging.source.bodyTextFilter, styles: staging.source.styles } : {}),
      distinctLessons: new Set(staging.lessons.flatMap(({ evidence }) => (evidence.lessonBoxes ?? [evidence.lessonBox])
        .map((box) => `${evidence.page}:${evidence.table}:${box.join(',')}`))).size,
      lessons: staging.lessons.map(({ evidence }) => evidence) } : { sheet: staging.sheet, period: staging.source.periodCell,
      distinctLessons: new Set(staging.lessons.map(({ evidence }) => evidence.lessonCell)).size,
      lessons: staging.lessons.map(({ evidence }) => ({ lesson: evidence.lessonCell, date: evidence.dateCell,
        group: evidence.headerCell, times: Object.keys(evidence.timeCells), timeInsideLesson: evidence.timeInsideLesson })) },
    provenance: null
  };
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag) => args[args.indexOf(flag) + 1];
  for (const flag of ['--stage', '--catalog', '--review', '--out']) assert(args.includes(flag), `Missing ${flag}`);
  const [staging, catalog, reviews] = await Promise.all(['--stage', '--catalog', '--review'].map(async (flag) => JSON.parse(await readFile(value(flag), 'utf8'))));
  const review = reviews.groups.find((group) => group.groupName === staging.groupName);
  const snapshot = buildReviewedDatedSnapshot(staging, catalog, review);
  await mkdir(value('--out'), { recursive: true });
  const output = path.join(value('--out'), `${snapshot.group.nrec}.json`);
  await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ group: snapshot.group.name, lessons: snapshot.schedule.length, output }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
