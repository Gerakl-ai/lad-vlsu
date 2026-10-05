import type { LessonSlot } from "../types";
import type { SubgroupChoice } from "./subgroup";

interface LessonChange {
  groupNrec: string;
  date: string;
  pairIndex: number;
  subgroup: number;
  subjectIncludes: string;
  message: string;
}

// Date-specific changes are separate from the recurring timetable.
const CHANGES: LessonChange[] = [{
  groupNrec: "7936a2a43b11b20b01d30f5b00c73166",
  date: "2026-10-06",
  pairIndex: 1,
  subgroup: 1,
  subjectIncludes: "архитектуры и интеграции",
  message: "Очной пары не будет · перенесена на дистант"
}];

export function lessonChangeMessage(groupNrec: string | undefined, date: string, lesson: LessonSlot | undefined, subgroup: SubgroupChoice): string | null {
  if (!groupNrec || !lesson) return null;
  const change = CHANGES.find((item) => item.groupNrec === groupNrec && item.date === date
    && item.pairIndex === lesson.pairIndex && (subgroup === "all" || subgroup === item.subgroup)
    && lesson.variants?.[item.subgroup]?.subject.toLowerCase().includes(item.subjectIncludes));
  return change ? `${subgroup === "all" ? "2 подгруппа: " : ""}${change.message}` : null;
}
