export interface VisualPerformanceHints {
  deviceMemory?: number;
  hardwareConcurrency?: number;
  saveData?: boolean;
}

export type VisualQuality = "full" | "lite";

export function shouldUseLiteVisuals(hints: VisualPerformanceHints): boolean {
  return hints.saveData === true
    || (Number.isFinite(hints.deviceMemory) && (hints.deviceMemory ?? Infinity) <= 4)
    || (Number.isFinite(hints.hardwareConcurrency) && (hints.hardwareConcurrency ?? Infinity) <= 4);
}

export function hasConstrainedFramePacing(intervals: readonly number[]): boolean {
  const samples = intervals.filter((interval) => Number.isFinite(interval) && interval > 0 && interval < 1000);
  if (samples.length < 24) return false;

  const slowFrames = samples.filter((interval) => interval > 28).length;
  return slowFrames / samples.length >= 0.2;
}
