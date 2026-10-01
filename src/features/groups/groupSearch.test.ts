import { describe, expect, it } from "vitest";
import { searchUniversityGroups } from "./groupSearch";
import { LEGACY_PI124_GROUP } from "./groupTypes";

const groups = [
  { ...LEGACY_PI124_GROUP, nrec: "other", name: "ПИ-124з", instituteShortName: "ИЭМ" },
  LEGACY_PI124_GROUP,
  { ...LEGACY_PI124_GROUP, nrec: "new", name: "ПИ-126" },
  { ...LEGACY_PI124_GROUP, nrec: "foreign", name: "ЛГ-126", instituteShortName: "ГИ" }
];

describe("university group search", () => {
  it("accepts lowercase, spaces and a missing separator", () => {
    expect(searchUniversityGroups(groups, " пи 124 ").map((group) => group.name)).toEqual(["ПИ-124", "ПИ-124з"]);
  });
  it("puts the exact group before similarly named groups from other institutes", () => {
    expect(searchUniversityGroups(groups, "ПИ-124")[0].nrec).toBe(LEGACY_PI124_GROUP.nrec);
  });
  it("finds a group outside the previously selected institute", () => {
    expect(searchUniversityGroups(groups, "лг126")[0].instituteShortName).toBe("ГИ");
  });
  it("does not expose the entire catalog for an empty search", () => {
    expect(searchUniversityGroups(groups, " ")).toEqual([]);
  });
});
