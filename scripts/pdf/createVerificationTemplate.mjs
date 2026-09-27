import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256 } from "../snapshot/buildSnapshot.mjs";

export function createVerificationTemplate(review) {
  if (review?.schemaVersion !== 1 || review.review?.status !== "approved"
    || !review.review.transcribedBy?.trim()) {
    throw new Error("Approve the transcription and name its author before verification");
  }
  return {
    schemaVersion: 1,
    reviewHash: sha256(review),
    verifiedBy: "",
    verifiedAt: ""
  };
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag) => {
    const index = args.indexOf(flag);
    return index < 0 ? null : args[index + 1];
  };
  const reviewFile = value("--review");
  const out = value("--out");
  if (!reviewFile || !out) {
    throw new Error("Use --review <review.json> --out <verification.json>");
  }
  const review = JSON.parse(await readFile(reviewFile, "utf8"));
  const template = createVerificationTemplate(review);
  await writeFile(out, `${JSON.stringify(template, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  console.log(`Created verification form ${out}; a separate reviewer must check the PDF and fill it in.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
