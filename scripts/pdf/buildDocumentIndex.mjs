import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ORDER_TITLES = {
  "029": "Очная форма ВО, приказ №029/20",
  "028": "КИТП и ОСПЮО, приказ №028/20",
  "027": "Очно-заочная форма ВО, приказ №027/20"
};

function orderId(url) {
  const match = url.match(/order_N(02[789])_20_/i);
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
        if (column.match?.status !== "unique-catalog-name") continue;
        const match = column.match.candidate;
        const group = known.get(match?.nrec);
        if (!group || group.name !== match.name || group.name !== column.header
          || group.instituteId !== match.instituteId
          || !Number.isInteger(document.member) || document.member < 0
          || !Number.isInteger(column.page) || column.page < 1 || column.page > document.pages
          || !Number.isInteger(column.column) || column.column < 1) continue;
        const location = {
          groupName: group.name,
          sourceId: id,
          pdfSha256: document.pdfSha256,
          member: document.member,
          page: column.page,
          column: column.column
        };
        const entries = candidates.get(match.nrec) ?? [];
        entries.push(location);
        candidates.set(match.nrec, entries);
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
