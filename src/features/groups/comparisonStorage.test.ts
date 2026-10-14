import { afterEach, expect, it, vi } from "vitest";
import { readComparisonGroup, writeComparisonGroup } from "./comparisonStorage";
import { LEGACY_PI124_GROUP } from "./groupTypes";

afterEach(() => vi.unstubAllGlobals());

it("stores comparison independently without touching the selected group", () => {
  const values = new Map([["lad.selected-group.v2", "unchanged"]]);
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  expect(readComparisonGroup()).toBeNull();
  writeComparisonGroup(LEGACY_PI124_GROUP);
  expect(readComparisonGroup()).toEqual(LEGACY_PI124_GROUP);
  expect(values.get("lad.selected-group.v2")).toBe("unchanged");
  values.set("lad.comparison-group.v1", "not-json");
  expect(readComparisonGroup()).toBeNull();
  values.set("lad.comparison-group.v1", JSON.stringify({ nrec: "other" }));
  expect(readComparisonGroup()).toBeNull();
});

it("does not crash when private storage is unavailable", () => {
  vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } });
  expect(readComparisonGroup()).toBeNull();
  expect(() => writeComparisonGroup(LEGACY_PI124_GROUP)).not.toThrow();
});
