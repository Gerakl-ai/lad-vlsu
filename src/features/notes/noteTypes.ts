export type NoteKind = "note" | "task" | "homework" | "wish" | "idea";
export type NoteStatus = "open" | "done";
export type ClassificationSource = "local" | "ai";
export type LessonLinkScope = "lesson" | "subject";

export interface LessonNoteContext {
  groupNrec?: string;
  groupName?: string;
  lessonId: string;
  date: string;
  start: string;
  timeStatus?: "unconfirmed";
  subjectKeys: string[];
  subjectLabel: string;
  scope: LessonLinkScope;
  intent: "note" | "homework";
}

export interface NoteComposerRequest {
  id: number;
  seed?: string;
  dueAt?: string;
  lessonContext?: LessonNoteContext;
}

export interface NoteFolder {
  id: string;
  name: string;
  color: string;
  system: boolean;
  createdAt: string;
}

export interface NoteDocumentInput {
  text: string;
  contentHtml: string;
  pinned: boolean;
  spaceOverride?: string;
  dueAtOverride?: string | null;
  lessonContext?: LessonNoteContext | null;
}

export interface NoteDraft extends NoteDocumentInput {
  id: string;
  updatedAt: string;
}

export interface SubjectOption {
  key: string;
  label: string;
  aliases: string[];
  nextAt?: string;
}

export interface NoteClassification {
  kind: NoteKind;
  space: string;
  topic?: string;
  confidence: number;
  subjectKey?: string;
  subjectLabel?: string;
  dueAt?: string;
  dueLabel?: string;
}

export interface SmartNote extends NoteClassification {
  id: string;
  text: string;
  contentHtml?: string;
  title: string;
  status: NoteStatus;
  pinned: boolean;
  manualOrder?: number;
  spaceManual?: boolean;
  dueManual?: boolean;
  createdAt: string;
  updatedAt: string;
  contentUpdatedAt?: string;
  completedAt?: string;
  classificationSource: ClassificationSource;
  classificationPending?: boolean;
  groupNrec?: string;
  groupName?: string;
  lessonContext?: LessonNoteContext;
}
