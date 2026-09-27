import { describe, expect, it } from "vitest";

import { createReviewDraft } from "./createReviewDraft.mjs";
import { createVerificationTemplate } from "./createVerificationTemplate.mjs";
import { buildReviewedSnapshot } from "./reviewedSnapshot.mjs";

const nrec = "a".repeat(32);
const pdfHash = "b".repeat(64);
const stagedDays = Array.from({ length: 5 }, (_, index) => ({
  day: index + 1,
  pairCount: 7,
  groupImage: `day-${index + 1}.png`,
  contextImage: `day-${index + 1}-context.png`,
  bounds: [100, index * 200, 200, (index + 1) * 200]
}));
const staging = {
  schemaVersion: 1,
  source: { sha256: pdfHash },
  groups: [{ page: 3, column: 5, days: stagedDays }]
};
const catalog = {
  schemaVersion: 3,
  institutes: [{ id: "iite", name: "ИИТЭ", shortName: "ИИТЭ", groups: [
    { nrec, name: "ПИ-124", course: "3 курс", forms: ["full-time"] }
  ] }]
};
const clean = { modeHint: "n", pairIndexHint: 1, rawTextHint: "111-3, лб, Пример П.П., Базы данных",
  pageBounds: [110, 20, 180, 70], warnings: [] };
const flagged = { modeHint: "z", pairIndexHint: 1, rawTextHint: "Спорный блок",
  pageBounds: [110, 90, 180, 120], warnings: ["crosses-half-row"] };
const candidates = {
  schemaVersion: 1,
  purpose: "draft-transcription-only",
  source: { pdfSha256: pdfHash },
  group: { page: 3, column: 5 },
  days: stagedDays.map((day) => ({ dayIndex: day.day, sourceImage: day.groupImage,
    contextImage: day.contextImage, pairCount: day.pairCount,
    suggestions: day.day === 1 ? [clean, flagged] : [] }))
};

describe("PDF review draft", () => {
  it("prefills only clean unique cells and preserves flagged hints", () => {
    const draft = createReviewDraft(candidates, staging, catalog, nrec);
    expect(draft.review.status).toBe("draft");
    expect(draft.schedule[0].n1).toBe(clean.rawTextHint);
    expect(draft.schedule[0].z1).toBe("");
    expect(draft.cells).toHaveLength(1);
    expect(draft.draftDiagnostics.unresolved).toEqual([
      { key: "1/z1", rawTextHint: "Спорный блок", reasons: ["crosses-half-row"] }
    ]);
    expect(() => createVerificationTemplate(draft)).toThrow("Approve the transcription");
  });

  it("does not choose between duplicate or out-of-bounds suggestions", () => {
    const duplicated = structuredClone(candidates);
    duplicated.days[0].suggestions.push({ ...clean, rawTextHint: "Other block" });
    duplicated.days[0].suggestions.push({ ...clean, modeHint: "n", pairIndexHint: 2,
      pageBounds: [110, 210, 180, 250] });
    const draft = createReviewDraft(duplicated, staging, catalog, nrec);
    expect(draft.cells).toHaveLength(0);
    expect(draft.draftDiagnostics.unresolved).toHaveLength(4);
    expect(draft.draftDiagnostics.unresolved.some((item) => item.reasons.includes("invalid-page-bounds"))).toBe(true);
  });

  it("rejects mismatched source and blocks import while draft diagnostics remain", () => {
    expect(() => createReviewDraft({ ...candidates, source: { pdfSha256: "c".repeat(64) } }, staging, catalog, nrec))
      .toThrow("Candidate source");
    const draft = createReviewDraft(candidates, staging, catalog, nrec);
    draft.review = { status: "approved", transcribedBy: "author" };
    draft.source = { title: "Test", url: "https://www.vlsu.ru/test.pdf", sha256: pdfHash,
      validFrom: "2026-09-01", validThrough: "2026-12-30" };
    draft.group.pdfHeader = "ПИ-124";
    draft.semester = 5;
    const verification = { ...createVerificationTemplate(draft), verifiedBy: "second",
      verifiedAt: "2026-09-27T12:00:00Z" };
    expect(() => buildReviewedSnapshot(draft, staging, catalog, verification)).toThrow("draft diagnostics");
  });
});
