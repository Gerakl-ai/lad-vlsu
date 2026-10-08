import { dateKeyFromDate } from "../../lib/time";
import type { LessonSlot } from "../../types";
import type { GroupProfile } from "../groups/groupTypes";
import { explicitSubjectKeyFromKeys, lessonSubjectKeys } from "./noteClassifier";
import type { LessonNoteContext, SmartNote } from "./noteTypes";

export function createLessonNoteContext(
  lesson: LessonSlot,
  date: Date,
  intent: LessonNoteContext["intent"],
  scope: LessonNoteContext["scope"] = "lesson",
  group?: Pick<GroupProfile, "nrec" | "name">
): LessonNoteContext {
  return {
    ...(group ? { groupNrec: group.nrec, groupName: group.name } : {}),
    lessonId: lesson.id,
    date: lesson.date ?? dateKeyFromDate(date),
    start: lesson.start,
    subjectKeys: lessonSubjectKeys(lesson),
    subjectLabel: lesson.subject,
    scope,
    intent
  };
}

export function noteMatchesLesson(note: SmartNote, lesson: LessonSlot, date: Date, groupNrec?: string) {
  if (note.status !== "open") return false;
  const noteGroupNrec = note.lessonContext?.groupNrec ?? note.groupNrec;
  if (groupNrec && noteGroupNrec !== groupNrec) return false;
  const lessonKeys = new Set(lessonSubjectKeys(lesson));
  const context = note.lessonContext;

  if (context?.scope === "lesson") {
    if (context.lessonId !== lesson.id || context.date !== (lesson.date ?? dateKeyFromDate(date))) return false;
    // An exact lesson can still contain two different subjects in the same time slot.
    if ((lesson.variants?.length ?? 0) === 1) {
      const noteKey = context.subjectKeys.length > 1
        ? explicitSubjectKeyFromKeys(`${note.title} ${note.text}`, context.subjectKeys) ?? note.subjectKey
        : note.subjectKey ?? context.subjectKeys[0];
      if (noteKey && !lessonKeys.has(noteKey)) return false;
    }
    return true;
  }

  const explicitKey = context?.subjectKeys && context.subjectKeys.length > 1
    ? explicitSubjectKeyFromKeys(`${note.title} ${note.text}`, context.subjectKeys)
    : undefined;
  const noteKeys = explicitKey ? [explicitKey] : note.subjectKey ? [note.subjectKey] : context?.subjectKeys ?? [];
  return noteKeys.some((key) => lessonKeys.has(key));
}

export function notesLinkedToLesson(lesson: LessonSlot | undefined, notes: SmartNote[], date: Date, groupNrec?: string) {
  if (!lesson) return [];
  return notes.filter((note) => noteMatchesLesson(note, lesson, date, groupNrec));
}
