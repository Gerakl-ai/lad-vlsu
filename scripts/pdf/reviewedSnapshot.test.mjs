import { describe, expect, it } from "vitest";

import { buildReviewedSnapshot } from "./reviewedSnapshot.mjs";
import { createReviewTemplate } from "./createReviewTemplate.mjs";

const nrec = "a".repeat(32);
const pdfHash = "b".repeat(64);
const dayNames = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
const schedule = dayNames.map((name) => ({
  type: "Lessons",
  name,
  ...Object.fromEntries(["n", "z"].flatMap((mode) =>
    Array.from({ length: 7 }, (_, index) => [`${mode}${index + 1}`, ""])))
}));
schedule[0].n1 = "111-3, лб, Пример П.П., Базы данных";
const stage = {
  schemaVersion: 1,
  source: { sha256: pdfHash },
  groups: [{ page: 3, column: 5, days: Array.from({ length: 5 }, (_, index) => ({
    day: index + 1,
    groupImage: `page-03/group-05/day-0${index + 1}.png`,
    contextImage: `page-03/group-05/day-0${index + 1}-context.png`,
    bounds: [400, 328 + index * 596, 500, 924 + index * 596]
  })) }]
};
const catalog = {
  schemaVersion: 3,
  institutes: [{ id: "iite", name: "Институт ИИТЭ", shortName: "ИИТЭ", groups: [
    { nrec, name: "ПИ-124", course: "3 курс", forms: ["full-time"] }
  ] }]
};
const review = {
  schemaVersion: 1,
  source: {
    sha256: pdfHash,
    title: "Расписание ИИТЭ, осень 2026",
    url: "https://www.vlsu.ru/example.zip",
    validFrom: "2026-09-01",
    validThrough: "2026-12-30"
  },
  group: { nrec, name: "ПИ-124", pdfHeader: "ПИ-124", instituteId: "iite", page: 3, column: 5 },
  review: { status: "approved", transcribedBy: "reviewer-a", verifiedBy: "reviewer-b", verifiedAt: "2026-09-27T12:00:00Z" },
  semester: 5,
  schedule,
  cells: [{ dayIndex: 1, mode: "n", pairIndex: 1, rawText: schedule[0].n1,
    sourceImage: stage.groups[0].days[0].groupImage, pageBounds: [405, 340, 495, 420] }]
};

describe("reviewed PDF snapshot gate", () => {
  it("creates an unapproved six-day form for the exact catalog group", () => {
    const draft = createReviewTemplate(stage, catalog, { nrec, page: 3, column: 5 });
    expect(draft.schedule).toHaveLength(6);
    expect(draft.group.pdfHeader).toBe("");
    expect(draft.review.status).toBe("draft");
    expect(() => buildReviewedSnapshot(draft, stage, catalog)).toThrow();
  });
  it("builds a dated v3 snapshot only from a checked PDF cell", () => {
    const snapshot = buildReviewedSnapshot(review, stage, catalog);
    expect(snapshot.group.nrec).toBe(nrec);
    expect(snapshot.validThrough).toBe("2026-12-30");
    expect(snapshot.sourceDocument.sha256).toBe(pdfHash);
    expect(snapshot.quality.valid).toBe(true);
  });

  it("rejects an unverified group or wrong source document", () => {
    expect(() => buildReviewedSnapshot({ ...review, source: { ...review.source, sha256: "c".repeat(64) } }, stage, catalog))
      .toThrow("Source PDF hash");
    expect(() => buildReviewedSnapshot({ ...review, group: { ...review.group, nrec: "c".repeat(32) } }, stage, catalog))
      .toThrow("official catalog");
    expect(() => buildReviewedSnapshot({ ...review, group: { ...review.group, pdfHeader: "ПИ-125" } }, stage, catalog))
      .toThrow("column header");
  });

  it("rejects one-person approval and uncovered cells", () => {
    expect(() => buildReviewedSnapshot({ ...review, review: { ...review.review, verifiedBy: "reviewer-a" } }, stage, catalog))
      .toThrow("Two distinct reviewers");
    expect(() => buildReviewedSnapshot({ ...review, cells: [] }, stage, catalog))
      .toThrow("Every non-empty cell");
    expect(() => buildReviewedSnapshot({ ...review, cells: [{ ...review.cells[0], pageBounds: [600, 340, 700, 420] }] }, stage, catalog))
      .toThrow("invalid page bounds");
  });
});
