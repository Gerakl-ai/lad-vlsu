import { describe, expect, it } from "vitest";
import { groupLinkUrl, parseGroupLink } from "./groupLinks";
import { LEGACY_PI124_GROUP, PI124_INSTITUTE_ID } from "./groupTypes";

describe("group deep links", () => {
  it("parses a transparent group reference", () => {
    expect(parseGroupLink("?group=abc&institute=iite&tab=week")).toEqual({ nrec: "abc", instituteId: "iite" });
    expect(parseGroupLink("?tab=week")).toBeNull();
  });

  it("accepts previously shared PI-124 links with the legacy institute alias", () => {
    expect(parseGroupLink(`?group=${LEGACY_PI124_GROUP.nrec}&institute=iite`)).toEqual({
      nrec: LEGACY_PI124_GROUP.nrec,
      instituteId: PI124_INSTITUTE_ID
    });
    expect(parseGroupLink("?group=another&institute=iite")).toEqual({ nrec: "another", instituteId: "iite" });
  });

  it("preserves the selected tab and removes one-shot compose state", () => {
    const url = new URL(groupLinkUrl(LEGACY_PI124_GROUP, "https://schedule.example/?tab=week&compose=1"));
    expect(url.searchParams.get("tab")).toBe("week");
    expect(url.searchParams.get("compose")).toBeNull();
    expect(url.searchParams.get("group")).toBe(LEGACY_PI124_GROUP.nrec);
    expect(url.searchParams.get("institute")).toBe(LEGACY_PI124_GROUP.instituteId);
  });

  it("shares the official institute id even from an old saved profile", () => {
    const oldProfile = { ...LEGACY_PI124_GROUP, instituteId: "iite", visualKey: "iite" };
    const url = new URL(groupLinkUrl(oldProfile, "https://schedule.example/"));
    expect(url.searchParams.get("institute")).toBe(PI124_INSTITUTE_ID);
  });
});
