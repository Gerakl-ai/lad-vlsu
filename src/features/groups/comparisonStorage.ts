import { canonicalGroupProfile, isGroupProfile, type GroupProfile } from "./groupTypes";

const KEY = "lad.comparison-group.v1";

export function readComparisonGroup(): GroupProfile | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return isGroupProfile(value) ? canonicalGroupProfile(value) : null;
  } catch { return null; }
}

export function writeComparisonGroup(group: GroupProfile) {
  try { localStorage.setItem(KEY, JSON.stringify(canonicalGroupProfile(group))); }
  catch { /* The current comparison remains usable if storage is unavailable. */ }
}
