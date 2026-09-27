import { readFile, writeFile } from "node:fs/promises";

const DAY_NAMES = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];

export function createReviewTemplate(staging, catalog, { nrec, page, column }) {
  const staged = staging.groups?.find((item) => item.page === page && item.column === column);
  if (!staged) throw new Error("This PDF group column is not in the staging manifest");
  const institute = catalog.institutes?.find((item) => item.groups.some((group) => group.nrec === nrec));
  const group = institute?.groups.find((item) => item.nrec === nrec);
  if (!group) throw new Error("Group Nrec is not in the catalog");
  return {
    schemaVersion: 1,
    source: {
      title: "",
      url: "",
      sha256: staging.source.sha256,
      validFrom: "",
      validThrough: ""
    },
    group: { nrec, name: group.name, pdfHeader: "", instituteId: institute.id, page, column },
    review: { status: "draft", transcribedBy: "", verifiedBy: "", verifiedAt: "" },
    semester: null,
    schedule: DAY_NAMES.map((name) => ({
      type: "Lessons",
      name,
      ...Object.fromEntries(["n", "z"].flatMap((mode) =>
        Array.from({ length: 7 }, (_, index) => [`${mode}${index + 1}`, ""])))
    })),
    cells: []
  };
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag) => {
    const index = args.indexOf(flag);
    return index < 0 ? null : args[index + 1];
  };
  const stagingFile = value("--staging");
  const catalogFile = value("--catalog");
  const nrec = value("--nrec");
  const page = Number(value("--page"));
  const column = Number(value("--column"));
  const out = value("--out");
  if (!stagingFile || !catalogFile || !nrec || !Number.isInteger(page)
    || !Number.isInteger(column) || !out) {
    throw new Error("Use --staging <manifest.json> --catalog <catalog.json> --nrec <id> --page <n> --column <n> --out <review.json>");
  }
  const [staging, catalog] = await Promise.all([stagingFile, catalogFile]
    .map(async (file) => JSON.parse(await readFile(file, "utf8"))));
  const template = createReviewTemplate(staging, catalog, { nrec, page, column });
  await writeFile(out, `${JSON.stringify(template, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  console.log(`Created draft review ${out}; nothing has been published.`);
}

if (process.argv[1]?.endsWith("createReviewTemplate.mjs")) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
