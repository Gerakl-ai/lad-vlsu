import { describe, expect, it } from "vitest";
import { hasConstrainedFramePacing, shouldUseLiteVisuals } from "./visualQuality";

describe("adaptive visual quality", () => {
  it("reduces ambient effects for constrained devices or data-saver mode", () => {
    expect(shouldUseLiteVisuals({ deviceMemory: 4, hardwareConcurrency: 8 })).toBe(true);
    expect(shouldUseLiteVisuals({ deviceMemory: 8, hardwareConcurrency: 4 })).toBe(true);
    expect(shouldUseLiteVisuals({ saveData: true })).toBe(true);
    expect(shouldUseLiteVisuals({ deviceMemory: 8, hardwareConcurrency: 8 })).toBe(false);
    expect(shouldUseLiteVisuals({})).toBe(false);
  });

  it("only classifies sustained slow frame pacing as constrained", () => {
    expect(hasConstrainedFramePacing(Array(36).fill(16.7))).toBe(false);
    expect(hasConstrainedFramePacing(Array(20).fill(34))).toBe(false);
    expect(hasConstrainedFramePacing([...Array(28).fill(16.7), ...Array(8).fill(34)])).toBe(true);
    expect(hasConstrainedFramePacing([...Array(35).fill(16.7), 180])).toBe(false);
  });
});
