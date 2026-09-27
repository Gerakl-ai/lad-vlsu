import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { collectCoverage, scheduleQuality, sha256 } from "../snapshot/buildSnapshot.mjs";

const DAY_NAMES = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
const HASH = /^[a-f\d]{64}$/i;
const NREC = /^[a-f\d]{32}$/i;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

export function buildReviewedSnapshot(review, staging, catalog, verification) {
  assert(review?.schemaVersion === 1 && staging?.schemaVersion === 1 && catalog?.schemaVersion === 3,
    "Unknown review, staging, or catalog version");
  const source = review.source;
  assert(source && HASH.test(source.sha256) && source.sha256 === staging.source?.sha256,
    "Source PDF hash does not match staging");
  assert(typeof source.title === "string" && source.title.trim(), "Source title is required");
  assert(typeof source.url === "string" && source.url.startsWith("https://"), "Official source URL is required");
  assert(validDateKey(source.validFrom) && validDateKey(source.validThrough)
    && source.validFrom <= source.validThrough, "Invalid document validity period");
  const group = review.group;
  assert(group && NREC.test(group.nrec) && Number.isInteger(group.page)
    && Number.isInteger(group.column), "Group identity and PDF position are required");
  const staged = staging.groups?.find((item) => item.page === group.page && item.column === group.column);
  assert(staged && staged.days?.length === 5, "Group column is absent from staging");
  const institute = catalog.institutes.find((item) => item.groups.some((candidate) => candidate.nrec === group.nrec));
  const catalogGroup = institute?.groups.find((candidate) => candidate.nrec === group.nrec);
  assert(institute && catalogGroup && catalogGroup.name === group.name,
    "Group name and Nrec must match the official catalog");
  assert(group.pdfHeader === group.name, "PDF column header must be explicitly verified");
  assert(institute.id === group.instituteId, "Institute ID must match the catalog");

  const approval = review.review;
  assert(approval?.status === "approved" && typeof approval.transcribedBy === "string"
    && approval.transcribedBy.trim(), "An approved transcription and its author are required");
  assert(verification?.schemaVersion === 1 && verification.reviewHash === sha256(review),
    "Verification must match the exact reviewed transcription hash");
  assert(typeof verification.verifiedBy === "string" && verification.verifiedBy.trim()
    && approval.transcribedBy.trim() !== verification.verifiedBy.trim()
    && validTimestamp(verification.verifiedAt),
  "A separate reviewer and verification time are required");
  assert(Number.isInteger(review.semester) && review.semester > 0, "Semester is required");

  const schedule = review.schedule;
  assert(Array.isArray(schedule) && schedule.length === DAY_NAMES.length, "Exactly six weekdays are required");
  const requiredCells = new Map();
  for (const [index, day] of schedule.entries()) {
    assert(day?.type === "Lessons" && day.name === DAY_NAMES[index], `Day ${index + 1} is invalid`);
    for (const mode of ["n", "z"]) {
      for (let pair = 1; pair <= 7; pair += 1) {
        const key = `${mode}${pair}`;
        assert(typeof day[key] === "string", `Missing string cell ${index + 1}/${key}`);
        if (day[key].trim()) requiredCells.set(`${index + 1}/${key}`, day[key]);
      }
    }
  }
  assert(scheduleQuality(schedule), "Reviewed timetable has no valid lessons");
  assert(Array.isArray(review.cells) && review.cells.length === requiredCells.size,
    "Every non-empty cell needs one source reference");

  const seen = new Set();
  for (const cell of review.cells) {
    const key = `${cell.dayIndex}/${cell.mode}${cell.pairIndex}`;
    assert(requiredCells.get(key) === cell.rawText && !seen.has(key), `Cell ${key} is missing or duplicated`);
    seen.add(key);
    const day = staged.days.find((item) => item.day === cell.dayIndex);
    assert(day && [day.groupImage, day.contextImage].includes(cell.sourceImage),
      `Cell ${key} has no matching PDF crop`);
    const [left, top, right, bottom] = cell.pageBounds ?? [];
    const [groupLeft, dayTop, groupRight, dayBottom] = day.bounds;
    assert([left, top, right, bottom].every(Number.isFinite)
      && left < right && top < bottom
      && left < groupRight && right > groupLeft
      && top >= dayTop && bottom <= dayBottom,
    `Cell ${key} has invalid page bounds`);
  }

  const semester = review.semester;
  const quality = scheduleQuality(schedule);
  return {
    schemaVersion: 3,
    group: {
      nrec: catalogGroup.nrec,
      name: catalogGroup.name,
      course: catalogGroup.course || null,
      forms: catalogGroup.forms,
      instituteId: institute.id,
      instituteName: institute.name,
      instituteShortName: institute.shortName
    },
    semester,
    schedule,
    quality,
    scheduleHash: sha256({ semester, schedule }),
    capturedAt: verification.verifiedAt,
    validFrom: source.validFrom,
    validThrough: source.validThrough,
    sourceDocument: {
      title: source.title.trim(),
      url: source.url,
      sha256: source.sha256,
      reviewedAt: verification.verifiedAt
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
  const reviewPath = value("--review");
  const stagingPath = value("--staging");
  const catalogPath = value("--catalog");
  const verificationPath = value("--verification");
  const out = value("--out");
  const write = args.includes("--write");
  if (!reviewPath || !stagingPath || !catalogPath || !verificationPath || (write && !out)) {
    throw new Error("Use --review <json> --verification <json> --staging <manifest.json> --catalog <catalog.json> [--out <data-dir> --write]");
  }
  const [review, staging, catalog, verification] = await Promise.all([reviewPath, stagingPath, catalogPath, verificationPath]
    .map(async (file) => JSON.parse(await readFile(file, "utf8"))));
  const snapshot = buildReviewedSnapshot(review, staging, catalog, verification);
  console.log(`Verified ${snapshot.group.name}: ${snapshot.quality.lessonDays} days, ${review.cells.length} non-empty cells, ${snapshot.validFrom}..${snapshot.validThrough}`);
  if (!write) {
    console.log("Dry run only. No schedule or coverage files were written.");
    return;
  }
  const dataDir = path.resolve(out);
  assert(path.resolve(catalogPath) === path.join(dataDir, "catalog.json"),
    "For --write, catalog.json must belong to the output data directory");
  const target = path.join(dataDir, "schedule", `${snapshot.group.nrec}.json`);
  try {
    await readFile(target, "utf8");
    throw new Error("Refusing to replace an existing group snapshot");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  const coverage = await collectCoverage(dataDir, catalog.institutes);
  await writeFile(path.join(dataDir, "coverage.json"), `${JSON.stringify(coverage, null, 2)}\n`, "utf8");
  console.log(`Wrote ${target} and coverage.json; publication still requires source-rights approval.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
