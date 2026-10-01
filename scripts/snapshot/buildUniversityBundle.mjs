import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scheduleQuality, sha256 } from './buildSnapshot.mjs';

export function buildUniversityBundle(catalog, candidates) {
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
    if (!current || Date.parse(snapshot.capturedAt) > Date.parse(current.capturedAt)) groups[id] = snapshot;
    else if (snapshot.capturedAt === current.capturedAt && snapshot.scheduleHash !== current.scheduleHash) {
      throw new Error(`Conflicting same-date snapshots: ${id}`);
    }
  }
  return {
    bundle: { schemaVersion: 1, groups: Object.fromEntries(Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))) },
    report: { catalogGroups: known.size, available: Object.keys(groups).length,
      missing: [...known.keys()].filter((id) => !groups[id]), rejected }
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
  const { bundle, report } = buildUniversityBundle(catalog, candidates);
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
  await Promise.all([
    writeFile(path.join(publishDir, 'catalog.json'), `${JSON.stringify(catalog)}\n`, 'utf8'),
    writeFile(path.join(publishDir, 'coverage.json'), `${JSON.stringify(coverage)}\n`, 'utf8'),
    writeFile(path.join(publishDir, 'university-schedule.json'), `${JSON.stringify(bundle)}\n`, 'utf8'),
    ...Object.entries(bundle.groups).map(([id, snapshot]) => writeFile(path.join(publishDir, 'schedule', `${id}.json`), `${JSON.stringify(snapshot)}\n`, 'utf8'))
  ]);
  console.log(JSON.stringify({ ...report, missing: report.missing.length, rejected: report.rejected.length }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
