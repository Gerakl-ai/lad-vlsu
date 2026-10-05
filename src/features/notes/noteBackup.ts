import type { NoteDraft, NoteFolder, NoteKind, NoteStatus, SmartNote } from "./noteTypes";
import { validPersonalEvent, type PersonalEvent } from "./personalEvents";

const BACKUP_VERSION = 8;
const NOTE_KINDS = new Set<NoteKind>(["note", "task", "homework", "wish", "idea"]);
const NOTE_STATUSES = new Set<NoteStatus>(["open", "done"]);

interface NotesBackup {
  app: "lad";
  version: number;
  exportedAt: string;
  notes: SmartNote[];
  folders: NoteFolder[];
  events: PersonalEvent[];
  drafts: NoteDraft[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isOptionalString(value: unknown) {
  return value === undefined || typeof value === "string";
}

function isOptionalBoolean(value: unknown) {
  return value === undefined || typeof value === "boolean";
}

function isOptionalFiniteNumber(value: unknown) {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function isDateString(value: unknown) {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function isOptionalDateString(value: unknown) {
  return value === undefined || isDateString(value);
}

function isOptionalLessonContext(value: unknown) {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return typeof value.lessonId === "string"
    && isOptionalString(value.groupNrec)
    && isOptionalString(value.groupName)
    && typeof value.date === "string"
    && typeof value.start === "string"
    && Array.isArray(value.subjectKeys)
    && value.subjectKeys.every((key) => typeof key === "string")
    && typeof value.subjectLabel === "string"
    && (value.scope === "lesson" || value.scope === "subject")
    && (value.intent === "note" || value.intent === "homework");
}

function isSmartNote(value: unknown): value is SmartNote {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.text === "string" &&
    isOptionalString(value.contentHtml) &&
    typeof value.title === "string" &&
    typeof value.space === "string" &&
    isOptionalString(value.topic) &&
    typeof value.confidence === "number" && Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1 &&
    NOTE_KINDS.has(value.kind as NoteKind) &&
    NOTE_STATUSES.has(value.status as NoteStatus) &&
    typeof value.pinned === "boolean" &&
    isOptionalFiniteNumber(value.manualOrder) &&
    isOptionalBoolean(value.spaceManual) &&
    isOptionalBoolean(value.dueManual) &&
    isDateString(value.createdAt) &&
    isDateString(value.updatedAt) &&
    isOptionalDateString(value.contentUpdatedAt) &&
    (value.classificationSource === "local" || value.classificationSource === "ai") &&
    isOptionalDateString(value.completedAt) &&
    isOptionalString(value.subjectKey) &&
    isOptionalString(value.subjectLabel) &&
    isOptionalString(value.groupNrec) &&
    isOptionalString(value.groupName) &&
    isOptionalDateString(value.dueAt) &&
    isOptionalString(value.dueLabel) &&
    isOptionalLessonContext(value.lessonContext)
  );
}

function isNoteDraft(value: unknown): value is NoteDraft {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && value.id.length > 0
    && typeof value.text === "string"
    && typeof value.contentHtml === "string"
    && typeof value.pinned === "boolean"
    && isOptionalString(value.spaceOverride)
    && (value.dueAtOverride === undefined || value.dueAtOverride === null || isDateString(value.dueAtOverride))
    && (value.lessonContext === null || isOptionalLessonContext(value.lessonContext))
    && isDateString(value.updatedAt);
}

export function createNotesBackup(notes: SmartNote[], folders: NoteFolder[] = [], events: PersonalEvent[] = [], drafts: NoteDraft[] = []): NotesBackup {
  return {
    app: "lad",
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    notes,
    folders: folders.filter((folder) => !folder.system),
    events,
    drafts
  };
}

export function downloadNotesBackup(notes: SmartNote[], folders: NoteFolder[] = [], events: PersonalEvent[] = [], drafts: NoteDraft[] = []) {
  const payload = JSON.stringify(createNotesBackup(notes, folders, events, drafts), null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  anchor.href = url;
  anchor.download = `lad-notes-${date}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function parseNotesBackup(raw: string): SmartNote[] {
  return parseNotesArchive(raw).notes;
}

export function parseNotesArchive(raw: string): { notes: SmartNote[]; folders: NoteFolder[]; events: PersonalEvent[]; drafts: NoteDraft[] } {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || parsed.app !== "lad" || ![1, 2, 3, 4, 5, 6, 7, BACKUP_VERSION].includes(parsed.version as number) || !Array.isArray(parsed.notes)) {
    throw new Error("Unsupported notes backup");
  }
  if (!parsed.notes.every(isSmartNote)) throw new Error("Invalid notes backup");
  const folders = parsed.folders ?? [];
  if (!Array.isArray(folders) || !folders.every((folder) => isRecord(folder)
    && typeof folder.id === "string" && typeof folder.name === "string" && folder.name.trim().length > 0
    && typeof folder.color === "string" && /^#[0-9a-f]{6}$/i.test(folder.color)
    && folder.system === false && isDateString(folder.createdAt))) throw new Error("Invalid folders backup");
  const events = parsed.events ?? [];
  if (!Array.isArray(events) || !events.every(validPersonalEvent)) throw new Error("Invalid calendar backup");
  const drafts = parsed.drafts ?? [];
  if (!Array.isArray(drafts) || !drafts.every(isNoteDraft)) throw new Error("Invalid drafts backup");
  return { notes: parsed.notes, folders: folders as NoteFolder[], events, drafts };
}
