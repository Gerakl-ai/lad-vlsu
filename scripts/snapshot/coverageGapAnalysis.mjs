import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function analyzeCoverageGaps(catalog, coverage, documentIndex) {
  const available = coverage.groups ?? {};
  const indexedDocuments = documentIndex.groups ?? {};
  const byForm = {};
  const byInstitute = [];
  let catalogGroups = 0;
  let availableInCatalog = 0;
  let missing = 0;
  let missingWithIndexedDocument = 0;

  for (const institute of catalog.institutes ?? []) {
    let instituteMissing = 0;
    for (const group of institute.groups ?? []) {
      catalogGroups += 1;
      if (available[group.nrec]) {
        availableInCatalog += 1;
        continue;
      }
      missing += 1;
      instituteMissing += 1;
      if (indexedDocuments[group.nrec]) missingWithIndexedDocument += 1;
      for (const form of group.forms?.length ? group.forms : ['unknown']) {
        byForm[form] = (byForm[form] ?? 0) + 1;
      }
    }
    byInstitute.push({
      institute: institute.shortName || institute.name,
      total: institute.groups?.length ?? 0,
      missing: instituteMissing
    });
  }

  return {
    catalogGroups,
    availableInCatalog,
    missing,
    missingWithIndexedDocument,
    byForm,
    byInstitute: byInstitute.sort((a, b) => b.missing - a.missing || a.institute.localeCompare(b.institute, 'ru'))
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [catalogPath, coveragePath, documentsPath] = process.argv.slice(2);
  const files = [catalogPath || 'public/data/catalog.json', coveragePath || 'public/data/coverage.json', documentsPath || 'public/data/document-index.json'];
  const [catalog, coverage, documents] = await Promise.all(files.map(async (file) => JSON.parse(await readFile(file, 'utf8'))));
  console.log(JSON.stringify(analyzeCoverageGaps(catalog, coverage, documents), null, 2));
}
