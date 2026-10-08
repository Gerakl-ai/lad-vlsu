import type { LessonSlot, LessonVariant, WeekMode } from "../types";
import { normalizeNoteText, normalizeSubjectKey } from "../features/notes/noteClassifier";
import type { SubgroupChoice } from "./subgroup";

export type LessonSelections = Record<string, { numerator?: string; denominator?: string; showAll?: boolean }>;

const STORAGE_PREFIX = "lad.lesson-selection.v1";
const PI124_NREC = "7936a2a43b11b20b01d30f5b00c73166";
const PI124_AUTUMN = [
  { day: 2, week: "numerator", first: "архитектуры и интеграции" },
  { day: 2, week: "denominator", first: "искусственного интеллекта" },
  { day: 5, week: "numerator", first: "информационная безопасность" },
  { day: 5, week: "denominator", first: "backend" }
] as const;

export function lessonSelectionKey(lesson: LessonSlot) {
  return `${lesson.dayIndex}:${lesson.pairIndex}:${lesson.start}:${lesson.date ?? ""}`;
}

function storageKey(groupNrec: string, semester: number) {
  return `${STORAGE_PREFIX}:${groupNrec}:${semester}`;
}

export function readLessonSelections(groupNrec?: string, semester?: number): LessonSelections {
  if (!groupNrec || semester === undefined) return {};
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(groupNrec, semester)) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([key, entry]) =>
      /^[1-7]:\d+:\d{2}:\d{2}:/.test(key) && entry && typeof entry === "object" && !Array.isArray(entry)
    ).map(([key, entry]) => {
      const pick = entry as Record<string, unknown>;
      return [key, {
        ...(typeof pick.numerator === "string" ? { numerator: pick.numerator } : {}),
        ...(typeof pick.denominator === "string" ? { denominator: pick.denominator } : {}),
        ...(typeof pick.showAll === "boolean" ? { showAll: pick.showAll } : {})
      }];
    }));
  } catch {
    return {};
  }
}

export function writeLessonSelections(groupNrec: string | undefined, semester: number | undefined, selections: LessonSelections) {
  if (!groupNrec || semester === undefined) return;
  try {
    localStorage.setItem(storageKey(groupNrec, semester), JSON.stringify(selections));
  } catch {
    // The visible selection still works for this session when storage is unavailable.
  }
}

export function variantIdentity(variant: LessonVariant, siblings: LessonVariant[]) {
  const subject = normalizeSubjectKey(variant.subject);
  if (siblings.filter((item) => normalizeSubjectKey(item.subject) === subject).length === 1) return subject;
  return `${subject}:${normalizeNoteText(variant.room ?? "")}:${normalizeNoteText(variant.teacher ?? "")}`;
}

export function setLessonSelection(selections: LessonSelections, lesson: LessonSlot, week: WeekMode, index: number | "all"): LessonSelections {
  const key = lessonSelectionKey(lesson);
  if (index === "all") {
    return { ...selections, [key]: { showAll: true } };
  }
  const variant = lesson.variants?.[index];
  if (!variant || week === "all") return selections;
  return {
    ...selections,
    [key]: { ...selections[key], showAll: false, [week]: variantIdentity(variant, lesson.variants!) }
  };
}

export function selectedLessonVariant(
  lesson: LessonSlot,
  week: WeekMode,
  selections: LessonSelections,
  groupNrec?: string,
  semester?: number,
  legacyChoice: SubgroupChoice = "all",
  counterpart?: LessonSlot
): SubgroupChoice {
  const variants = lesson.variants ?? [];
  if (variants.length < 2 || week === "all") return "all";
  const selected = selections[lessonSelectionKey(lesson)];
  if (selected?.showAll) return "all";
  const identity = selected?.[week];
  const exact = identity && variants.findIndex((variant) => variantIdentity(variant, variants) === identity);
  if (typeof exact === "number" && exact >= 0) return exact;

  const otherWeek = week === "numerator" ? "denominator" : "numerator";
  const opposite = selected?.[otherWeek];
  if (opposite && variants.length === 2) {
    const keys = variants.map((variant) => variantIdentity(variant, variants));
    const partnerKeys = counterpart?.variants?.map((variant) => variantIdentity(variant, counterpart.variants!));
    const sameAlternatives = partnerKeys?.length === 2 && keys.every((key) => partnerKeys.includes(key));
    const verifiedLegacy = groupNrec === PI124_NREC && semester === 5
      && PI124_AUTUMN.some((rule) => rule.day === lesson.dayIndex && lesson.pairIndex === 1);
    if ((sameAlternatives && partnerKeys[0] !== keys[0]) || (!counterpart && verifiedLegacy)) {
      const index = keys.findIndex((key) => key !== opposite);
      if (index >= 0 && keys.includes(opposite)) return index;
    }
  }

  // Preserve the verified personal choice on old PI-124 installations only.
  if (groupNrec === PI124_NREC && semester === 5 && (legacyChoice === 0 || legacyChoice === 1)
    && lesson.pairIndex === 1) {
    const rule = PI124_AUTUMN.find((item) => item.day === lesson.dayIndex && item.week === week);
    if (rule) {
      const first = variants.findIndex((variant) => normalizeNoteText(variant.subject).includes(rule.first));
      if (first >= 0) return legacyChoice === 0 ? first : variants.findIndex((_, index) => index !== first);
    }
  }
  return "all";
}

export function lessonWithSelectedVariant(lesson: LessonSlot, index: SubgroupChoice): LessonSlot {
  if (index === "all") return lesson;
  const variant = lesson.variants?.[index];
  if (!variant) return lesson;
  return {
    ...lesson,
    subject: variant.subject,
    room: variant.room,
    kind: variant.kind,
    teacher: variant.teacher,
    rawText: variant.rawText,
    variants: [variant]
  };
}
