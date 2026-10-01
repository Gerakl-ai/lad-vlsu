import type { GroupProfile } from "./groupTypes";

export function groupSearchKey(value: string) {
  return value.trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[\s\u2010-\u2015-]+/g, "");
}

export function searchUniversityGroups(groups: GroupProfile[], query: string): GroupProfile[] {
  const key = groupSearchKey(query);
  if (!key) return [];
  return groups.filter((group) => groupSearchKey(group.name).includes(key))
    .sort((a, b) => Number(groupSearchKey(b.name) === key) - Number(groupSearchKey(a.name) === key)
      || a.name.localeCompare(b.name, "ru", { numeric: true })
      || a.instituteShortName.localeCompare(b.instituteShortName, "ru"));
}
