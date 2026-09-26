/**
 * Формы обучения ВлГУ. Приложение долго запрашивало только очную (WFormed: 0),
 * поэтому заочники и очно-заочники не могли найти свою группу вообще.
 */
export const STUDY_FORM_KEYS = ["full-time", "extramural", "part-time"] as const;

export type StudyFormKey = (typeof STUDY_FORM_KEYS)[number];

export const STUDY_FORM_LABELS: Record<StudyFormKey, string> = {
  "full-time": "Очная",
  extramural: "Заочная",
  "part-time": "Очно-заочная"
};

/** Короткая подпись для списка групп: очную не подписываем, она подразумевается. */
export function studyFormLabel(forms: StudyFormKey[] | undefined) {
  if (!forms || !forms.length) return undefined;
  const meaningful = forms.filter((form) => form !== "full-time");
  if (!meaningful.length) return undefined;
  return meaningful.map((form) => STUDY_FORM_LABELS[form]).join(" · ");
}

export interface InstituteOption {
  id: string;
  name: string;
  shortName: string;
  visualKey: string;
}

export interface GroupOption {
  nrec: string;
  name: string;
  course?: string;
  forms?: StudyFormKey[];
}

export interface GroupProfile extends GroupOption {
  id: string;
  instituteId: string;
  instituteName: string;
  instituteShortName: string;
  visualKey: string;
}

export const PI124_GROUP_NREC = "7936a2a43b11b20b01d30f5b00c73166";
export const PI124_INSTITUTE_ID = "5b42fa53ec1dd1892e5ec44a3a60a896";

export const LEGACY_PI124_GROUP: GroupProfile = {
  id: PI124_GROUP_NREC,
  nrec: PI124_GROUP_NREC,
  name: "ПИ-124",
  instituteId: PI124_INSTITUTE_ID,
  instituteName: "Институт информационных технологий и электроники",
  instituteShortName: "ИИТЭ",
  visualKey: "institute-1"
};

export function canonicalInstituteId(nrec: string, instituteId: string | undefined) {
  return nrec === PI124_GROUP_NREC && instituteId === "iite" ? PI124_INSTITUTE_ID : instituteId;
}

export function canonicalGroupProfile(group: GroupProfile): GroupProfile {
  if (group.nrec !== PI124_GROUP_NREC || group.instituteId !== "iite") return group;
  return { ...group, instituteId: PI124_INSTITUTE_ID, visualKey: "institute-1" };
}

// Сокращения и палитры институтов живут в instituteVisuals.ts:
// таблица по стабильному id вместо регулярок по названию.

export function toGroupProfile(institute: InstituteOption, group: GroupOption): GroupProfile {
  return {
    ...group,
    id: group.nrec,
    instituteId: institute.id,
    instituteName: institute.name,
    instituteShortName: institute.shortName,
    visualKey: institute.visualKey
  };
}

export function groupBadgeParts(name: string) {
  const [prefix, ...rest] = name.trim().split(/[-–—]/);
  return {
    prefix: (prefix || name).slice(0, 4),
    suffix: rest.join("-").slice(0, 5)
  };
}

export function isGroupProfile(value: unknown): value is GroupProfile {
  if (!value || typeof value !== "object") return false;
  const group = value as Partial<GroupProfile>;
  return typeof group.nrec === "string"
    && group.nrec.length > 0
    && typeof group.name === "string"
    && group.name.length > 0
    && typeof group.instituteId === "string"
    && typeof group.instituteName === "string"
    && typeof group.instituteShortName === "string"
    && typeof group.visualKey === "string";
}
