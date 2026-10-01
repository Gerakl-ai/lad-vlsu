import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildDocumentIndex } from "./buildDocumentIndex.mjs";

const nrec = "a".repeat(32);
const catalog = { institutes: [{ id: "iite", groups: [{ nrec, name: "ПИ-124" }] }] };
const column = {
  page: 2,
  column: 3,
  header: "ПИ-124",
  match: { status: "unique-catalog-name", candidate: { nrec, name: "ПИ-124", instituteId: "iite" } }
};
const inventory = (order = "029", columns = [column]) => ({
  source: {
    url: `https://www.vlsu.ru/fileadmin/class-schedule/order_N${order}_20_20260903_VO.zip`,
    sha256: "b".repeat(64)
  },
  documents: [{ kind: "schedule", member: 1, pdfSha256: "c".repeat(64), pages: 5, groupColumns: columns }]
});

describe("official document locator", () => {
  it("indexes a uniquely matched group with its source coordinates", () => {
    const index = buildDocumentIndex(catalog, [inventory()]);
    expect(index.groups[nrec]).toMatchObject({ groupName: "ПИ-124", sourceId: "029", member: 1, page: 2, column: 3 });
  });

  it.each(["030", "031", "032"])("accepts a verified September revision %s without mixing sources", (order) => {
    const index = buildDocumentIndex(catalog, [inventory(order)]);
    expect(index.groups[nrec].sourceId).toBe(order);
    expect(index.sources[order].title).toContain(`№${order}/20`);
  });

  it("rejects unsupported order IDs", () => {
    expect(() => buildDocumentIndex(catalog, [inventory("999")])).toThrow("Unknown or unverified");
  });

  it("omits ambiguous or repeated group locations", () => {
    const ambiguous = { ...column, match: { ...column.match, status: "multi-group-column" } };
    expect(buildDocumentIndex(catalog, [inventory("029", [ambiguous])]).groups).toEqual({});
    expect(buildDocumentIndex(catalog, [inventory(), inventory("027")]).groups).toEqual({});
  });

  it("indexes a shared PDF column for both explicitly named catalog groups", () => {
    const second = "d".repeat(32);
    const sharedCatalog = { institutes: [{ id: "iite", groups: [
      { nrec, name: "ПИ-124" }, { nrec: second, name: "ПИ-224" }
    ] }] };
    const sharedColumn = { ...column, header: "ПИ-124 ПИ-224", match: {
      status: "multi-group-column", candidates: [
        { nrec, name: "ПИ-124", instituteId: "iite" },
        { nrec: second, name: "ПИ-224", instituteId: "iite" }
      ]
    } };
    const index = buildDocumentIndex(sharedCatalog, [inventory("029", [sharedColumn])]);
    expect(index.groups[nrec]).toMatchObject({ sharedColumn: true, columnHeader: "ПИ-124 ПИ-224" });
    expect(index.groups[second]).toMatchObject({ sharedColumn: true, columnHeader: "ПИ-124 ПИ-224" });
  });

  it("rejects unknown sources and mismatched catalog identities", () => {
    expect(() => buildDocumentIndex(catalog, [{ ...inventory(), source: { url: "https://example.com/archive.zip", sha256: "b".repeat(64) } }])).toThrow();
    expect(buildDocumentIndex(catalog, [inventory("029", [{ ...column, header: "ПИ-125" }])]).groups).toEqual({});
  });

  it("ships a locator for hundreds of real catalog groups", () => {
    const index = JSON.parse(readFileSync("public/data/document-index.json", "utf8"));
    expect(index.schemaVersion).toBe(1);
    expect(Object.keys(index.groups).length).toBe(633);
    expect(Object.keys(index.sources).sort()).toEqual(["027", "028", "029"]);
    expect(index.groups["7936a2a43b11b20b01d30f5b00c73166"]).toMatchObject({ groupName: "ПИ-124", sourceId: "029" });
  });
});
