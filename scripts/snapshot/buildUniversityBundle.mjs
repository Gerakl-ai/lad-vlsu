import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scheduleQuality, sha256 } from './buildSnapshot.mjs';

function preferCandidate(current, candidate, asOf) {
  const currentPeriod = periodWindow(current, asOf)?.status;
  const candidatePeriod = periodWindow(candidate, asOf)?.status;
  if (currentPeriod === 'within' && ['before', 'after'].includes(candidatePeriod)) return false;
  if (candidatePeriod === 'within' && ['before', 'after'].includes(currentPeriod)) return true;
  if (currentPeriod === 'within' && candidatePeriod === 'within') {
    const currentPreliminary = qualityCategory(current) === 'preliminary';
    const candidatePreliminary = qualityCategory(candidate) === 'preliminary';
    if (currentPreliminary !== candidatePreliminary) return !candidatePreliminary;
  }
  if (snapshotTime(candidate) === snapshotTime(current) && candidate.scheduleHash !== current.scheduleHash) {
    throw new Error(`Conflicting same-date snapshots: ${candidate.group.nrec}`);
  }
  return snapshotTime(candidate) > snapshotTime(current);
}

function snapshotTime(snapshot) {
  return Date.parse(snapshot.capturedAt);
}

export function buildUniversityBundle(catalog, candidates, asOf = new Date()) {
  if (catalog?.schemaVersion !== 3 || !Array.isArray(catalog.institutes)) throw new Error('Invalid university catalog');
  const known = new Map();
  for (const institute of catalog.institutes) for (const group of institute.groups ?? []) {
    if (!/^[a-f\d]{32}$/i.test(group.nrec) || !group.name) throw new Error('Invalid catalog group');
    if (known.has(group.nrec)) throw new Error(`Ambiguous catalog group: ${group.nrec}`);
    known.set(group.nrec, { name: group.name, instituteId: institute.id });
  }
  if (!known.size) throw new Error('Empty university catalog');
  const groups = {};
  const rejected = [];
  for (const snapshot of candidates) {
    const id = snapshot?.group?.nrec;
    const group = known.get(id);
    if (!group || snapshot.schemaVersion !== 3 || snapshot.group.name !== group.name
      || snapshot.group.instituteId !== group.instituteId || snapshot.quality?.valid !== true
      || !scheduleQuality(snapshot.schedule) || !Number.isFinite(Date.parse(snapshot.capturedAt))
      || snapshot.scheduleHash !== sha256({ semester: snapshot.semester, schedule: snapshot.schedule })) {
      rejected.push({ groupNrec: id ?? null, reason: 'Invalid identity, content, hash or capture date' });
      continue;
    }
    const current = groups[id];
    if (!current || preferCandidate(current, snapshot, asOf)) groups[id] = snapshot;
  }
  return {
    bundle: { schemaVersion: 1, groups: Object.fromEntries(Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))) },
    report: { catalogGroups: known.size, available: Object.keys(groups).length,
      missing: [...known.keys()].filter((id) => !groups[id]), rejected }
  };
}

export function buildCoverageGapReport(catalog, bundle) {
  const institutes = catalog.institutes.map((institute) => {
    const groups = institute.groups ?? [];
    const missing = groups.filter((group) => !bundle.groups[group.nrec]).map((group) => ({
      nrec: group.nrec,
      name: group.name,
      course: group.course ?? null,
      forms: group.forms ?? []
    }));
    const missingByForm = {};
    for (const group of missing) for (const form of group.forms) {
      missingByForm[form] = (missingByForm[form] ?? 0) + 1;
    }
    return {
      id: institute.id,
      name: institute.name,
      shortName: institute.shortName,
      total: groups.length,
      available: groups.length - missing.length,
      missingCount: missing.length,
      missingByForm,
      missing
    };
  });
  return {
    schemaVersion: 1,
    catalogCapturedAt: catalog.capturedAt,
    total: institutes.reduce((sum, institute) => sum + institute.total, 0),
    available: institutes.reduce((sum, institute) => sum + institute.available, 0),
    missing: institutes.reduce((sum, institute) => sum + institute.missingCount, 0),
    institutes
  };
}

function qualityCategory(snapshot) {
  if (!snapshot) return 'missing';
  const warnings = snapshot.quality?.warnings;
  if (snapshot.extraction?.status === 'unreviewed'
    || (Array.isArray(warnings) && warnings.includes('ocr-unreviewed'))) return 'preliminary';
  if (snapshot.sourceDocument?.reviewedAt
    && Number.isFinite(Date.parse(snapshot.sourceDocument.reviewedAt))) return 'reviewedDocument';
  return 'otherAvailable';
}

function periodWindow(snapshot, asOf) {
  if (!snapshot) return null;
  let from = snapshot.validFrom;
  let through = snapshot.validThrough;
  let basis = 'declared';
  const validDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  if (from || through) {
    if (!validDate(from) || !validDate(through) || from > through) {
      return { status: 'unknown', basis: 'unknown' };
    }
  } else {
    const semester = snapshot.semester;
    const captured = new Date(snapshot.capturedAt);
    const weekly = snapshot.schedule?.some((day) => day?.type === 'Lessons');
    const exam = snapshot.schedule?.some((day) => day?.type === 'ExamSession');
    if (!weekly || exam || !Number.isInteger(semester) || semester < 1 || semester > 12
      || Number.isNaN(captured.getTime())) return { status: 'unknown', basis: 'unknown' };
    const year = captured.getUTCFullYear();
    const month = captured.getUTCMonth() + 1;
    const autumn = semester % 2 === 1;
    const termYear = autumn ? (month < 8 ? year - 1 : year) : (month >= 8 ? year + 1 : year);
    from = `${termYear}-${autumn ? '09-01' : '02-01'}`;
    through = `${termYear}-${autumn ? '12-31' : '06-30'}`;
    basis = 'estimated';
  }
  const today = asOf.toISOString().slice(0, 10);
  return { status: today < from ? 'before' : today > through ? 'after' : 'within',
    basis, validFrom: from, validThrough: through };
}

export function buildDataQualityReport(catalog, bundle, asOf = new Date()) {
  const categories = ['preliminary', 'reviewedDocument', 'otherAvailable', 'missing'];
  const periods = ['within', 'before', 'after', 'unknown'];
  const groups = {};
  const institutes = catalog.institutes.map((institute) => {
    const counts = Object.fromEntries(categories.map((category) => [category, 0]));
    const periodCounts = Object.fromEntries(periods.map((period) => [period, 0]));
    for (const group of institute.groups ?? []) {
      const snapshot = bundle.groups[group.nrec];
      const category = qualityCategory(snapshot);
      counts[category] += 1;
      const period = periodWindow(snapshot, asOf);
      if (period) periodCounts[period.status] += 1;
      groups[group.nrec] = {
        name: group.name,
        instituteId: institute.id,
        category,
        ...(snapshot ? { capturedAt: snapshot.capturedAt, period } : {})
      };
    }
    return { id: institute.id, name: institute.name, total: (institute.groups ?? []).length,
      ...counts, periodWindows: periodCounts };
  });
  return {
    schemaVersion: 1,
    catalogCapturedAt: catalog.capturedAt,
    assessedAt: asOf.toISOString(),
    total: institutes.reduce((sum, institute) => sum + institute.total, 0),
    ...Object.fromEntries(categories.map((category) => [category,
      institutes.reduce((sum, institute) => sum + institute[category], 0)])),
    periodWindows: Object.fromEntries(periods.map((period) => [period,
      institutes.reduce((sum, institute) => sum + institute.periodWindows[period], 0)])),
    institutes,
    groups
  };
}

async function readSnapshots(directory) {
  const files = await readdir(directory).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  return Promise.all(files.filter((file) => /^[a-f\d]{32}\.json$/i.test(file)).map(async (file) => {
    const snapshot = JSON.parse(await readFile(path.join(directory, file), 'utf8'));
    if (`${snapshot?.group?.nrec}.json` !== file) throw new Error(`Snapshot filename identity mismatch: ${file}`);
    return snapshot;
  }));
}

async function main() {
  const args = process.argv.slice(2);
  const dataDir = args.includes('--data-dir') ? args[args.indexOf('--data-dir') + 1] : null;
  if (!dataDir) throw new Error('Usage: --data-dir <catalog/schedule directory> [--fallback-dir <directory> ...]');
  const directories = [path.join(dataDir, 'schedule'), ...args.flatMap((arg, i) => arg === '--fallback-dir' ? [args[i + 1]] : [])];
  const catalog = JSON.parse(await readFile(path.join(dataDir, 'catalog.json'), 'utf8'));
  const candidates = (await Promise.all(directories.map(readSnapshots))).flat();
  const assessedAt = new Date();
  const { bundle, report } = buildUniversityBundle(catalog, candidates, assessedAt);
  if (!report.available) throw new Error('No valid schedules for university bundle');
  const publishDir = args.includes('--publish-dir') ? args[args.indexOf('--publish-dir') + 1] : dataDir;
  if (!publishDir) throw new Error('Missing --publish-dir value');
  await mkdir(path.join(publishDir, 'schedule'), { recursive: true });
  const coverage = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    catalogGroups: report.catalogGroups,
    available: report.available,
    groups: Object.fromEntries(Object.entries(bundle.groups).map(([id, snapshot]) => [id, {
      capturedAt: snapshot.capturedAt,
      semester: snapshot.semester,
      scheduleHash: snapshot.scheduleHash,
      ...(snapshot.validFrom && snapshot.validThrough ? { validFrom: snapshot.validFrom, validThrough: snapshot.validThrough } : {})
    }]))
  };
  const gaps = buildCoverageGapReport(catalog, bundle);
  const qualityReport = buildDataQualityReport(catalog, bundle, assessedAt);
  await Promise.all([
    writeFile(path.join(publishDir, 'catalog.json'), `${JSON.stringify(catalog)}\n`, 'utf8'),
    writeFile(path.join(publishDir, 'coverage.json'), `${JSON.stringify(coverage)}\n`, 'utf8'),
    writeFile(path.join(publishDir, 'gaps.json'), `${JSON.stringify(gaps)}\n`, 'utf8'),
    writeFile(path.join(publishDir, 'quality.json'), `${JSON.stringify(qualityReport)}\n`, 'utf8'),
    writeFile(path.join(publishDir, 'university-schedule.json'), `${JSON.stringify(bundle)}\n`, 'utf8'),
    ...Object.entries(bundle.groups).map(([id, snapshot]) => writeFile(path.join(publishDir, 'schedule', `${id}.json`), `${JSON.stringify(snapshot)}\n`, 'utf8'))
  ]);
  console.log(JSON.stringify({ ...report, missing: report.missing.length, rejected: report.rejected.length }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
