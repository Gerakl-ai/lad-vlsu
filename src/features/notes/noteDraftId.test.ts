import { describe, expect, it } from "vitest";
import type { LessonNoteContext } from "./noteTypes";
import { hasDraftPayload, lessonDraftId } from "./noteDraftId";

const context: LessonNoteContext = {
  groupNrec: "group-a",
  groupName: "ПИ-124",
  lessonId: "tuesday-1",
  date: "2026-11-10",
  start: "08:30",
  subjectKeys: ["artificial-intelligence"],
  subjectLabel: "Основы искусственного интеллекта",
  scope: "lesson",
  intent: "homework"
};

describe("lesson draft identity", () => {
  it("does not treat a lesson link alone as a user-authored draft", () => {
    expect(hasDraftPayload({ text: "", contentHtml: "<p></p>", pinned: false })).toBe(false);
    expect(hasDraftPayload({ text: "Задание", contentHtml: "<p>Задание</p>", pinned: false })).toBe(true);
    expect(hasDraftPayload({ text: "", contentHtml: "<p></p>", pinned: false, dueAtSet: true })).toBe(true);
  });

  it("keeps parallel subgroup subjects and groups in separate drafts", () => {
    const architecture = { ...context, subjectKeys: ["architecture"], subjectLabel: "Основы архитектуры" };
    const otherGroup = { ...context, groupNrec: "group-b", groupName: "ПИ-224" };

    expect(lessonDraftId(context)).not.toBe(lessonDraftId(architecture));
    expect(lessonDraftId(context)).not.toBe(lessonDraftId(otherGroup));
  });

  it("is stable when a subject-key list arrives in a different order", () => {
    const first = { ...context, subjectKeys: ["architecture", "artificial-intelligence"] };
    const reordered = { ...context, subjectKeys: ["artificial-intelligence", "architecture", "architecture"] };

    expect(lessonDraftId(first)).toBe(lessonDraftId(reordered));
  });
});
