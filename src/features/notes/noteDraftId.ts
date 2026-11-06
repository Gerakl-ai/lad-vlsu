import type { LessonNoteContext } from "./noteTypes";
import type { NoteDraft } from "./noteTypes";

type DraftPayload = Pick<NoteDraft, "text" | "contentHtml" | "pinned" | "spaceOverride"> & { dueAtSet?: boolean };

export function hasDraftPayload(draft: DraftPayload) {
  return Boolean(draft.text.trim() || /<img\b/i.test(draft.contentHtml) || draft.dueAtSet || draft.pinned || draft.spaceOverride);
}

export function lessonDraftId(context: LessonNoteContext) {
  const subjectIdentity = [...new Set(context.subjectKeys)].sort().join("|") || context.subjectLabel;
  const parts = [
    context.groupNrec ?? context.groupName ?? "group",
    context.lessonId,
    context.date,
    context.start,
    context.intent,
    context.scope,
    subjectIdentity
  ];
  return `lesson:${parts.map((part) => encodeURIComponent(part)).join(":")}`;
}
