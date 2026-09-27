import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createReviewTemplate } from "./createReviewTemplate.mjs";

function inside(bounds, outer) {
  const [left, top, right, bottom] = bounds ?? [];
  const [outerLeft, outerTop, outerRight, outerBottom] = outer ?? [];
  return [left, top, right, bottom, outerLeft, outerTop, outerRight, outerBottom].every(Number.isFinite)
    && left < right && top < bottom && left < outerRight && right > outerLeft
    && top >= outerTop && bottom <= outerBottom;
}

export function createReviewDraft(candidates, staging, catalog, nrec) {
  if (candidates?.schemaVersion !== 1 || candidates.purpose !== "draft-transcription-only"
    || candidates.source?.pdfSha256 !== staging?.source?.sha256) {
    throw new Error("Candidate source does not match the staged PDF");
  }
  const { page, column } = candidates.group ?? {};
  const review = createReviewTemplate(staging, catalog, { nrec, page, column });
  const staged = staging.groups.find((item) => item.page === page && item.column === column);
  if (!Array.isArray(candidates.days) || candidates.days.length !== 5
    || new Set(candidates.days.map((day) => day.dayIndex)).size !== 5) {
    throw new Error("Candidates must contain five distinct PDF days");
  }

  const byCell = new Map();
  for (const day of candidates.days) {
    const stagedDay = staged.days.find((item) => item.day === day.dayIndex);
    if (!stagedDay || !Array.isArray(day.suggestions)
      || day.sourceImage !== stagedDay.groupImage || day.contextImage !== stagedDay.contextImage
      || day.pairCount !== stagedDay.pairCount) {
      throw new Error(`Candidate day ${day.dayIndex} does not match staging`);
    }
    for (const suggestion of day.suggestions) {
      const key = `${day.dayIndex}/${suggestion.modeHint}${suggestion.pairIndexHint}`;
      if (!byCell.has(key)) byCell.set(key, []);
      byCell.get(key).push({ day, stagedDay, suggestion });
    }
  }

  const unresolved = [];
  for (const [key, entries] of byCell) {
    for (const { day, stagedDay, suggestion } of entries) {
      const validKey = /^[1-5]\/([nz][1-7])$/.exec(key);
      const rawText = suggestion.rawTextHint?.trim();
      const reasons = [
        ...(Array.isArray(suggestion.warnings) ? suggestion.warnings : ["invalid-warnings"]),
        ...(entries.length > 1 ? ["multiple-blocks-in-cell"] : []),
        ...(!validKey ? ["invalid-cell-key"] : []),
        ...(!rawText ? ["empty-text"] : []),
        ...(!inside(suggestion.pageBounds, stagedDay.bounds) ? ["invalid-page-bounds"] : [])
      ];
      if (reasons.length) {
        unresolved.push({ key, rawTextHint: rawText || "", reasons: [...new Set(reasons)] });
        continue;
      }
      review.schedule[day.dayIndex - 1][validKey[1]] = rawText;
      review.cells.push({
        dayIndex: day.dayIndex,
        mode: suggestion.modeHint,
        pairIndex: suggestion.pairIndexHint,
        rawText,
        sourceImage: day.sourceImage,
        pageBounds: suggestion.pageBounds
      });
    }
  }
  review.draftDiagnostics = { prefilledCells: review.cells.length, unresolved };
  return review;
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag) => {
    const index = args.indexOf(flag);
    return index < 0 ? null : args[index + 1];
  };
  const files = ["--candidates", "--staging", "--catalog"].map(value);
  const nrec = value("--nrec");
  const out = value("--out");
  if (files.some((file) => !file) || !nrec || !out) {
    throw new Error("Use --candidates <json> --staging <manifest.json> --catalog <catalog.json> --nrec <id> --out <review.json>");
  }
  const [candidates, staging, catalog] = await Promise.all(files.map(async (file) => JSON.parse(await readFile(file, "utf8"))));
  const review = createReviewDraft(candidates, staging, catalog, nrec);
  await writeFile(out, `${JSON.stringify(review, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  console.log(`Draft only: ${review.cells.length} prefilled cells, ${review.draftDiagnostics.unresolved.length} unresolved blocks. Check every PDF cell manually.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
