import type { ScheduleState } from "../../types";
import { preferNewerSchedule } from "../../lib/freshness";
import {
  canonicalGroupProfile,
  canonicalInstituteId,
  isGroupProfile,
  LEGACY_PI124_GROUP,
  type GroupOption,
  type GroupProfile,
  type InstituteOption
} from "./groupTypes";

const SELECTED_GROUP_KEY = "lad.selected-group.v2";
const SCHEDULE_CACHE_PREFIX = "lad.schedule.v2";
const INSTITUTE_CACHE_KEY = "lad.catalog.institutes.v1";
const GROUP_CACHE_PREFIX = "lad.catalog.groups.v1";
const FAVORITE_GROUPS_KEY = "lad.favorite-groups.v1";
const RECENT_GROUPS_KEY = "lad.recent-groups.v1";
const LEGACY_SCHEDULE_CACHE_KEY = "pi124.schedule.cache";

interface CatalogCache<T> {
  fetchedAt: string;
  items: T[];
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in private mode; the active session still works.
  }
}

function scheduleCacheKey(nrec: string) {
  return `${SCHEDULE_CACHE_PREFIX}:${nrec}`;
}

export function readSelectedGroup(): GroupProfile | null {
  const selected = readJson<unknown>(SELECTED_GROUP_KEY);
  if (isGroupProfile(selected)) {
    const group = canonicalGroupProfile(selected);
    if (group !== selected) writeJson(SELECTED_GROUP_KEY, group);
    return group;
  }

  const legacySchedule = readJson<ScheduleState>(LEGACY_SCHEDULE_CACHE_KEY);
  if (!legacySchedule) return null;
  writeSelectedGroup(LEGACY_PI124_GROUP);
  writeJson(scheduleCacheKey(LEGACY_PI124_GROUP.nrec), legacySchedule);
  return LEGACY_PI124_GROUP;
}

export function writeSelectedGroup(group: GroupProfile) {
  const canonical = canonicalGroupProfile(group);
  writeJson(SELECTED_GROUP_KEY, canonical);
  rememberRecentGroup(canonical);
}

function validGroupList(key: string) {
  const groups = readJson<unknown[]>(key);
  return Array.isArray(groups) ? groups.filter(isGroupProfile).map(canonicalGroupProfile) : [];
}

export function readFavoriteGroups(): GroupProfile[] {
  return validGroupList(FAVORITE_GROUPS_KEY);
}

export function toggleFavoriteGroup(group: GroupProfile): GroupProfile[] {
  const favorites = readFavoriteGroups();
  const next = favorites.some((item) => item.nrec === group.nrec)
    ? favorites.filter((item) => item.nrec !== group.nrec)
    : [group, ...favorites].slice(0, 12);
  writeJson(FAVORITE_GROUPS_KEY, next);
  return next;
}

export function readRecentGroups(): GroupProfile[] {
  return validGroupList(RECENT_GROUPS_KEY);
}

export function rememberRecentGroup(group: GroupProfile) {
  const next = [group, ...readRecentGroups().filter((item) => item.nrec !== group.nrec)].slice(0, 6);
  writeJson(RECENT_GROUPS_KEY, next);
}

export function readKnownGroup(nrec: string, instituteId?: string): GroupProfile | null {
  const canonicalId = canonicalInstituteId(nrec, instituteId);
  const selected = readJson<unknown>(SELECTED_GROUP_KEY);
  const known = [selected, ...readFavoriteGroups(), ...readRecentGroups()]
    .find((item): item is GroupProfile => isGroupProfile(item)
      && item.nrec === nrec
      && (!canonicalId || canonicalGroupProfile(item).instituteId === canonicalId));
  if (known) return canonicalGroupProfile(known);

  if (!canonicalId) return null;
  const institute = readInstituteCatalog()?.items.find((item) => item.id === canonicalId);
  const group = readGroupCatalog(canonicalId)?.items.find((item) => item.nrec === nrec);
  return institute && group ? {
    ...group,
    id: group.nrec,
    instituteId: institute.id,
    instituteName: institute.name,
    instituteShortName: institute.shortName,
    visualKey: institute.visualKey
  } : null;
}

export function readGroupScheduleCache(group: GroupProfile): ScheduleState | null {
  const current = readJson<ScheduleState>(scheduleCacheKey(group.nrec));
  if (current) return current.groupNrec === group.nrec ? current : null;

  if (group.nrec !== LEGACY_PI124_GROUP.nrec) return null;
  const legacy = readJson<ScheduleState>(LEGACY_SCHEDULE_CACHE_KEY);
  if (legacy?.groupNrec !== group.nrec) return null;
  writeJson(scheduleCacheKey(group.nrec), legacy);
  return legacy;
}

export function writeGroupScheduleCache(state: ScheduleState) {
  const existing = readJson<ScheduleState>(scheduleCacheKey(state.groupNrec));
  const usable = existing?.groupNrec === state.groupNrec
    && typeof existing.fetchedAt === "string" && Number.isFinite(Date.parse(existing.fetchedAt))
    && typeof existing.currentInfo?.name === "string"
    && (existing.currentInfo.currentWeekType === 1 || existing.currentInfo.currentWeekType === 2)
    && Array.isArray(existing.allLessons)
    && existing.allLessons.every((lesson) => typeof lesson?.id === "string"
      && typeof lesson.subject === "string" && typeof lesson.rawText === "string")
    ? existing : null;
  writeJson(scheduleCacheKey(state.groupNrec), preferNewerSchedule(usable, state));
}

export function readInstituteCatalog(): CatalogCache<InstituteOption> | null {
  const cache = readJson<CatalogCache<InstituteOption>>(INSTITUTE_CACHE_KEY);
  return cache && Array.isArray(cache.items) ? cache : null;
}

export function writeInstituteCatalog(items: InstituteOption[]) {
  writeJson(INSTITUTE_CACHE_KEY, { fetchedAt: new Date().toISOString(), items });
}

export function readGroupCatalog(instituteId: string): CatalogCache<GroupOption> | null {
  const cache = readJson<CatalogCache<GroupOption>>(`${GROUP_CACHE_PREFIX}:${instituteId}`);
  return cache && Array.isArray(cache.items) ? cache : null;
}

export function writeGroupCatalog(instituteId: string, items: GroupOption[]) {
  writeJson(`${GROUP_CACHE_PREFIX}:${instituteId}`, { fetchedAt: new Date().toISOString(), items });
}
