import { readFile } from 'node:fs/promises';

const FORMS = new Set(['full-time', 'part-time', 'extramural']);

export async function readOptionalJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

/** Restore only failed institute/form requests, never confirmed removals. */
export function recoverCatalog(incoming, saved, status) {
  if (incoming?.schemaVersion !== 3 || !Array.isArray(incoming.institutes)) throw new Error('Invalid incoming catalog');
  if (saved?.schemaVersion !== 3 || !Array.isArray(saved.institutes) || !Array.isArray(status?.failures)
    || !incoming.capturedAt || incoming.capturedAt !== status.startedAt) return incoming;
  const ownership = new Map(incoming.institutes.flatMap((institute) => (institute.groups ?? []).map((group) => [group.nrec, institute.id])));
  const restored = new Set(incoming.recovery?.restoredGroupIds ?? []);
  let changed = false;
  const institutes = incoming.institutes.map((institute) => {
    const failedForms = new Set(status.failures.filter((failure) => failure.scope === 'groups'
      && (failure.instituteId ? failure.instituteId === institute.id : failure.institute === institute.name)
      && FORMS.has(failure.form)).map((failure) => failure.form));
    const previous = saved.institutes.find((item) => item.id === institute.id);
    if (!failedForms.size || !previous) return institute;
    const groups = new Map((institute.groups ?? []).map((group) => [group.nrec, group]));
    let instituteChanged = false;
    for (const old of previous.groups ?? []) {
      if (!/^[a-f\d]{32}$/i.test(old.nrec ?? '') || typeof old.name !== 'string' || !old.name.trim() || !Array.isArray(old.forms)) continue;
      const forms = old.forms.filter((form) => failedForms.has(form));
      if (!forms.length || ownership.has(old.nrec) && ownership.get(old.nrec) !== institute.id) continue;
      const current = groups.get(old.nrec);
      const missing = forms.filter((form) => !current?.forms?.includes(form));
      if (!missing.length) continue;
      groups.set(old.nrec, { ...(current ?? old), forms: [...new Set([...(current?.forms ?? []), ...missing])],
        catalogRecovery: { savedForms: [...new Set([...(current?.catalogRecovery?.savedForms ?? []), ...missing])],
          capturedAt: [current?.catalogRecovery?.capturedAt, old.catalogRecovery?.capturedAt ?? saved.capturedAt]
            .filter((value) => typeof value === 'string' && Number.isFinite(Date.parse(value))).sort()[0] ?? null } });
      if (!current) restored.add(old.nrec);
      instituteChanged = changed = true;
    }
    if (!instituteChanged) return institute;
    const items = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));
    return { ...institute, groups: items, groupCount: items.length };
  });
  if (!changed) return incoming;
  return { ...incoming, institutes, instituteCount: institutes.length,
    groupCount: institutes.reduce((sum, institute) => sum + institute.groups.length, 0),
    recovery: { restoredGroupIds: [...restored].sort(), reason: 'upstream-catalog-failure' } };
}
