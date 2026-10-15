import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { prepareUniversityData, writeUniversityData } from './buildUniversityBundle.mjs';
import { universityDataPlugin } from './universityDataPlugin.mjs';
import { sha256 } from './buildSnapshot.mjs';

const nrec = 'a'.repeat(32);
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lad-data-test-'));
  const dataDir = path.join(root, 'public', 'data');
  const reviewedDir = path.join(dataDir, 'reviewed-schedule');
  await mkdir(reviewedDir, { recursive: true });
  await mkdir(path.join(dataDir, 'schedule'), { recursive: true });
  const catalog = { schemaVersion: 3, institutes: [{ id: 'institute', name: 'Institute', shortName: 'I', groups: [
    { nrec, name: 'TEST-124', forms: ['part-time'], course: null }
  ] }] };
  const schedule = [{ type: 'DatedLesson', name: '111-3, лк, Example E.E., Subject', date: '2026-02-02', start: '15:50', end: '19:10' }];
  const snapshot = { schemaVersion: 3, group: { ...catalog.institutes[0].groups[0], instituteId: 'institute' },
    semester: null, schedule, scheduleHash: sha256({ semester: null, schedule }), quality: { valid: true },
    capturedAt: '2026-10-12T14:36:09Z', validFrom: '2026-02-02', validThrough: '2026-06-08' };
  const catalogPath = path.join(dataDir, 'catalog.json');
  const snapshotPath = path.join(reviewedDir, `${nrec}.json`);
  await writeFile(catalogPath, JSON.stringify(catalog));
  await writeFile(snapshotPath, JSON.stringify(snapshot));
  return { root, dataDir, snapshot, catalogPath, snapshotPath };
}

it('prepares and writes reviewed fallbacks without rewriting source files', async () => {
  const source = await fixture();
  const before = await readFile(source.snapshotPath, 'utf8');
  const prepared = await prepareUniversityData(source.dataDir, undefined, new Date('2026-10-13T10:00:00Z'));
  expect(prepared.report.available).toBe(1);
  expect(prepared.files['coverage.json'].groups[nrec].validThrough).toBe('2026-06-08');
  expect(prepared.files['university-schedule.json'].groups[nrec]).toEqual(source.snapshot);
  const output = path.join(source.root, 'dist', 'data');
  await writeUniversityData(prepared, output);
  expect(JSON.parse(await readFile(path.join(output, 'schedule', `${nrec}.json`), 'utf8'))).toEqual(source.snapshot);
  expect(await readFile(source.snapshotPath, 'utf8')).toBe(before);
  expect(JSON.parse(await readFile(source.catalogPath, 'utf8')).institutes[0].groups).toHaveLength(1);
});

it('recovers failed catalog forms before validating archived schedules, but rejects stale failure evidence', async () => {
  const source = await fixture();
  const fallback = path.join(source.root, 'saved-catalog.json');
  const saved = JSON.parse(await readFile(source.catalogPath, 'utf8'));
  const capturedAt = '2026-10-15T10:00:00Z';
  await writeFile(fallback, JSON.stringify({ ...saved, capturedAt: '2026-10-01T00:00:00Z' }));
  const incomplete = { ...saved, capturedAt, institutes: [{ ...saved.institutes[0], groups: [] }], groupCount: 0 };
  await writeFile(source.catalogPath, JSON.stringify(incomplete));
  const statusPath = path.join(source.dataDir, 'status.json');
  const status = { startedAt: capturedAt, failures: [{ scope: 'groups', instituteId: 'institute', form: 'part-time' }] };
  await writeFile(statusPath, JSON.stringify(status));
  const prepared = await prepareUniversityData(source.dataDir, undefined, new Date(capturedAt), fallback);
  expect(prepared.report.available).toBe(1);
  expect(prepared.report.catalogGroups).toBe(1);
  expect(prepared.files['catalog.json'].recovery.restoredGroupIds).toEqual([nrec]);
  expect(prepared.files['catalog.json'].institutes[0].groups[0].catalogRecovery).toEqual({ savedForms: ['part-time'], capturedAt: '2026-10-01T00:00:00Z' });
  expect(JSON.parse(await readFile(source.catalogPath, 'utf8'))).toEqual(incomplete);
  await writeFile(statusPath, JSON.stringify({ ...status, startedAt: 'older' }));
  await expect(prepareUniversityData(source.dataDir, undefined, new Date(capturedAt), fallback)).rejects.toThrow('Empty university catalog');
});

it('rejects unsafe output paths', async () => {
  const source = await fixture();
  await expect(writeUniversityData({ files: { '../outside.json': {} } }, path.join(source.root, 'dist', 'data'))).rejects.toThrow('filename');
});

it.each(['/', '/lad-vlsu/'])('serves the same compiled documents under base %s and updates without a page reload', async (base) => {
  const source = await fixture();
  const plugin = universityDataPlugin();
  const watcher = new EventEmitter();
  const lifecycle = new EventEmitter();
  const updates = [];
  const logs = [];
  let middleware;
  plugin.configResolved({ root: source.root, publicDir: path.join(source.root, 'public'), base,
    command: 'serve', build: { outDir: 'dist' } });
  await plugin.configureServer({ watcher, httpServer: lifecycle, middlewares: { use: (handler) => { middleware = handler; } },
    ws: { send: (message) => updates.push(message) }, config: { logger: { error: (message) => logs.push(message) } } });
  const server = createServer((request, response) => middleware(request, response, () => { response.statusCode = 404; response.end(); }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const coverage = await (await fetch(`${origin}${base}data/coverage.json`)).json();
    expect(coverage.available).toBe(1);
    const response = await fetch(`${origin}${base}data/schedule/${nrec}.json?cache=old`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(source.snapshot);
    expect((await fetch(`${origin}${base}data/coverage.json`, { method: 'HEAD' })).headers.get('content-length')).toBeTruthy();
    expect((await fetch(`${origin}${base}data/coverage.json`, { method: 'POST' })).status).toBe(404);
    expect((await fetch(`${origin}${base}data/unknown.json`)).status).toBe(404);
    const updatedSchedule = [{ ...source.snapshot.schedule[0], name: '111-3, лк, Example E.E., Updated subject' }];
    const updated = { ...source.snapshot, schedule: updatedSchedule,
      scheduleHash: sha256({ semester: null, schedule: updatedSchedule }), capturedAt: '2026-10-13T10:00:00Z' };
    await writeFile(source.snapshotPath, JSON.stringify(updated));
    await expect.poll(() => updates.length).toBe(1);
    expect(updates[0]).toEqual({ type: 'custom', event: 'lad-static-data-updated',
      data: { type: 'static-schedule-updated', pathname: `${base}data/university-schedule.json` } });
    expect(await (await fetch(`${origin}${base}data/schedule/${nrec}.json`)).json()).toEqual(updated);
    expect(logs).toEqual([]);
    lifecycle.emit('close');
    expect(watcher.listenerCount('change')).toBe(0);
  } finally { server.close(); await once(server, 'close'); }
});

it('uses the same compiler during a normal Vite build', async () => {
  const source = await fixture();
  const plugin = universityDataPlugin();
  plugin.configResolved({ root: source.root, publicDir: path.join(source.root, 'public'), command: 'build', build: { outDir: 'dist' } });
  await plugin.buildStart();
  await plugin.writeBundle();
  expect(JSON.parse(await readFile(path.join(source.root, 'dist', 'data', 'coverage.json'), 'utf8')).available).toBe(1);
  expect(JSON.parse(await readFile(path.join(source.root, 'dist', 'data', 'schedule', `${nrec}.json`), 'utf8'))).toEqual(source.snapshot);
});
