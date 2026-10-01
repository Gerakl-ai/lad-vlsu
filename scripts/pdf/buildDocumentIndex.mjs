import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ORDER_TITLES = {
  "029": "Очная форма ВО, приказ №029/20",
  "028": "КИТП и ОСПЮО, приказ №028/20",
  "027": "Очно-заочная форма ВО, приказ №027/20",
  "030": "Очная форма ВО, приказ №030/20",
  "031": "КИТП и ОСПЮО, приказ №031/20",
  "032": "Очно-заочная форма ВО, приказ №032/20"
};

function orderId(url) {
  const match = url.match(/order_N(\d{3})_20_/i);
  return match?.[1] ?? null;
}

export function buildDocumentIndex(catalog, inventories) {
  const known = new Map(catalog.institutes.flatMap((institute) => institute.groups.map((group) => [
    group.nrec,
    { name: group.name, instituteId: institute.id }
  ])));
  const sources = {};
  const candidates = new Map();

  for (const inventory of inventories) {
    const url = inventory?.source?.url;
    const id = typeof url === "string" ? orderId(url) : null;
    if (!id || !ORDER_TITLES[id] || !url.startsWith("https://www.vlsu.ru/fileadmin/class-schedule/")
      || !/^[a-f\d]{64}$/i.test(inventory.source.sha256)) {
      throw new Error("Unknown or unverified VLSU document source");
    }
    if (sources[id] && sources[id].sha256 !== inventory.source.sha256) {
      throw new Error(`Conflicting archive for order ${id}`);
    }
    sources[id] = { title: ORDER_TITLES[id], url, sha256: inventory.source.sha256 };

    for (const document of inventory.documents ?? []) {
      if (document.kind !== "schedule" || !/^[a-f\d]{64}$/i.test(document.pdfSha256)) continue;
      for (const column of document.groupColumns ?? []) {
        const shared = column.match?.status === "multi-group-column";
        const matches = shared ? column.match.candidates
          : column.match?.status === "unique-catalog-name" ? [column.match.candidate] : [];
        if (!Array.isArray(matches) || !matches.length
          || column.header !== matches.map((match) => match.name).join(" ")
          || !Number.isInteger(document.member) || document.member < 0
          || !Number.isInteger(column.page) || column.page < 1 || column.page > document.pages
          || !Number.isInteger(column.column) || column.column < 1) continue;
        if (matches.some((match) => {
          const group = known.get(match?.nrec);
          return !group || group.name !== match.name || group.instituteId !== match.instituteId;
        })) continue;
        for (const match of matches) {
          const location = {
            groupName: match.name,
            sourceId: id,
            pdfSha256: document.pdfSha256,
            member: document.member,
            page: column.page,
            column: column.column,
            ...(shared ? { sharedColumn: true, columnHeader: column.header } : {})
          };
          const entries = candidates.get(match.nrec) ?? [];
          entries.push(location);
          candidates.set(match.nrec, entries);
        }
      }
    }
  }

  const groups = Object.fromEntries([...candidates]
    .filter(([, locations]) => locations.length === 1)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([nrec, [location]]) => [nrec, location]));
  return { schemaVersion: 1, period: "Осень 2026", sources, groups };
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag) => args[args.indexOf(flag) + 1];
  if (!args.includes("--out") || !args.includes("--inventory")) {
    throw new Error("Usage: node buildDocumentIndex.mjs --out <file> --inventory <file> [--inventory <file> ...] [--catalog <file>]");
  }
  const inventories = await Promise.all(args.flatMap((arg, index) => arg === "--inventory" ? [args[index + 1]] : [])
    .map(async (file) => JSON.parse(await readFile(file, "utf8"))));
  const catalog = args.includes("--catalog")
    ? JSON.parse(await readFile(value("--catalog"), "utf8"))
    : JSON.parse(execFileSync("git", ["show", "origin/data:data/catalog.json"], { encoding: "utf8" }));
  const index = buildDocumentIndex(catalog, inventories);
  const target = value("--out");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  process.stdout.write(`Indexed ${Object.keys(index.groups).length} unambiguous groups\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
