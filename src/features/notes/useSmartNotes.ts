import { useCallback, useEffect, useMemo, useState } from "react";
import type { LessonSlot, WeekMode } from "../../types";
import type { GroupProfile } from "../groups/groupTypes";
import { buildSubjectOptions, classifyNote, explicitPersonalSpace, noteTitle } from "./noteClassifier";
import { formatDueLabel, resolveNoteDeadline } from "./noteDeadline";
import { reorderNoteCollection, sortNotes } from "./noteOrdering";
import type { NoteDropPlacement } from "./noteOrdering";
import {
  DEFAULT_NOTE_FOLDERS,
  loadFolders,
  loadNotes,
  normalizeStoredNote,
  removeFolder,
  removeNote,
  storeFolder,
  storeNote
} from "./noteStorage";
import type { LessonNoteContext, NoteClassification, NoteDocumentInput, NoteFolder, SmartNote } from "./noteTypes";

const FOLDER_COLORS = ["#6bd6ff", "#59dfc1", "#ffc55f", "#ff8a7f", "#d89cff", "#76a8ff"];

function createId(prefix: string) {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizedFolderName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function applyLessonContext(classification: NoteClassification, context?: LessonNoteContext | null): NoteClassification {
  if (!context) return classification;
  return {
    ...classification,
    kind: context.intent === "homework" ? "homework" : classification.kind,
    space: "Учёба",
    topic: context.subjectLabel,
    confidence: 1,
    subjectKey: context.subjectKeys[0],
    subjectLabel: context.subjectLabel
  };
}

function studyScope(
  classification: NoteClassification,
  context: LessonNoteContext | null | undefined,
  group: GroupProfile | null
) {
  if (context?.groupNrec) {
    return { groupNrec: context.groupNrec, groupName: context.groupName };
  }
  if (classification.subjectKey && group) {
    return { groupNrec: group.nrec, groupName: group.name };
  }
  return { groupNrec: undefined, groupName: undefined };
}

export function useSmartNotes(lessons: LessonSlot[], weekMode: WeekMode, group: GroupProfile | null) {
  const [notes, setNotes] = useState<SmartNote[]>([]);
  const [folders, setFolders] = useState<NoteFolder[]>(DEFAULT_NOTE_FOLDERS);
  const [ready, setReady] = useState(false);
  const subjects = useMemo(() => buildSubjectOptions(lessons, weekMode), [lessons, weekMode]);
  const folderSpaces = useMemo(() => folders.map((folder) => folder.name), [folders]);
  const spaces = useMemo(
    () => [...new Set([...folders.map((folder) => folder.name), ...notes.map((note) => note.space)])],
    [folders, notes]
  );

  useEffect(() => {
    let active = true;
    Promise.all([loadNotes(), loadFolders()]).then(([storedNotes, storedFolders]) => {
      if (!active) return;
      setNotes(sortNotes(storedNotes));
      setFolders(storedFolders);
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    setNotes((current) => {
      const changed: SmartNote[] = [];
      const next = current.map((note) => {
        const classification = classifyNote(note.text, subjects, folderSpaces);
        const noteBelongsToActiveGroup = !note.groupNrec || note.groupNrec === group?.nrec;
        const canValidateSubject = subjects.length > 0 && noteBelongsToActiveGroup;
        const subjectChanged = Boolean(!note.lessonContext && canValidateSubject && note.subjectKey && classification.subjectKey !== note.subjectKey);
        const canRefreshLocalSpace = !note.lessonContext && !note.spaceManual && (
          note.classificationSource === "local" ||
          note.space === "Входящие" ||
          note.space === "Учёба"
        ) && (!note.subjectKey || canValidateSubject);
        const nextSpace = canRefreshLocalSpace ? classification.space : note.space;
        const nextTopic = note.lessonContext?.subjectLabel ?? (note.classificationSource === "ai" && note.topic
          ? note.topic
          : note.subjectLabel ?? classification.topic);
        const nextScope = studyScope(classification, note.lessonContext, group);
        const scopeChanged = canValidateSubject
          && (nextScope.groupNrec !== note.groupNrec || nextScope.groupName !== note.groupName);
        if (!subjectChanged && nextSpace === note.space && nextTopic === note.topic && !scopeChanged) return note;
        const migrated: SmartNote = {
          ...note,
          kind: note.classificationSource === "local" ? classification.kind : note.kind,
          space: nextSpace,
          topic: nextTopic,
          subjectKey: subjectChanged ? classification.subjectKey : note.subjectKey,
          subjectLabel: subjectChanged ? classification.subjectLabel : note.subjectLabel,
          ...(canValidateSubject ? nextScope : {}),
          confidence: classification.confidence,
          classificationPending: false
        };
        changed.push(migrated);
        return migrated;
      });
      changed.forEach((note) => void storeNote(note));
      return changed.length ? sortNotes(next) : current;
    });
  }, [folderSpaces, group, ready, subjects]);

  const createNote = useCallback(async (input: NoteDocumentInput) => {
    const timestamp = new Date().toISOString();
    const classification = applyLessonContext(classifyNote(input.text, subjects, spaces), input.lessonContext);
    if (input.spaceOverride) classification.space = input.spaceOverride;
    const deadline = resolveNoteDeadline(classification, input.dueAtOverride);
    const scope = studyScope(classification, input.lessonContext, group);
    const note: SmartNote = {
      id: createId("note"),
      text: input.text.trim(),
      contentHtml: input.contentHtml,
      title: noteTitle(input.text),
      status: "open",
      pinned: input.pinned,
      manualOrder: Date.now(),
      spaceManual: Boolean(input.spaceOverride),
      createdAt: timestamp,
      updatedAt: timestamp,
      contentUpdatedAt: timestamp,
      classificationSource: "local",
      classificationPending: false,
      lessonContext: input.lessonContext ?? undefined,
      ...scope,
      ...classification,
      ...deadline
    };
    if (!await storeNote(note)) throw new Error("Не удалось сохранить запись на устройстве");
    setNotes((current) => sortNotes([note, ...current]));
    return note;
  }, [group, spaces, subjects]);

  const updateNote = useCallback(async (noteId: string, input: NoteDocumentInput) => {
    const existing = notes.find((note) => note.id === noteId);
    if (!existing) return;
    const classification = applyLessonContext(classifyNote(input.text, subjects, spaces), input.lessonContext);
    if (input.spaceOverride) classification.space = input.spaceOverride;
    const deadline = resolveNoteDeadline(classification, input.dueAtOverride);
    const scope = studyScope(classification, input.lessonContext, group);
    const timestamp = new Date().toISOString();
    const note: SmartNote = {
      ...existing,
      ...classification,
      text: input.text.trim(),
      contentHtml: input.contentHtml,
      title: noteTitle(input.text),
      pinned: input.pinned,
      spaceManual: Boolean(input.spaceOverride),
      updatedAt: timestamp,
      contentUpdatedAt: timestamp,
      classificationSource: "local",
      classificationPending: false,
      lessonContext: input.lessonContext ?? undefined,
      ...scope,
      ...deadline
    };
    if (!await storeNote(note)) throw new Error("Не удалось сохранить запись на устройстве");
    setNotes((current) => sortNotes(current.map((item) => item.id === noteId ? note : item)));
    return note;
  }, [group, notes, spaces, subjects]);

  const toggleNote = useCallback((noteId: string) => {
    setNotes((current) => {
      const next = current.map((note) => note.id === noteId ? {
        ...note,
        status: note.status === "open" ? "done" as const : "open" as const,
        completedAt: note.status === "open" ? new Date().toISOString() : undefined,
        updatedAt: new Date().toISOString()
      } : note);
      const changed = next.find((note) => note.id === noteId);
      if (changed) void storeNote(changed);
      return sortNotes(next);
    });
  }, []);

  const togglePinned = useCallback((noteId: string) => {
    setNotes((current) => {
      const next = current.map((note) => note.id === noteId ? {
        ...note,
        pinned: !note.pinned,
        manualOrder: Date.now(),
        updatedAt: new Date().toISOString()
      } : note);
      const changed = next.find((note) => note.id === noteId);
      if (changed) void storeNote(changed);
      return sortNotes(next);
    });
  }, []);

  const reorderNotes = useCallback((
    sourceId: string,
    targetId: string,
    placement: NoteDropPlacement
  ) => {
    setNotes((current) => {
      const result = reorderNoteCollection(current, sourceId, targetId, placement);
      if (!result.changed.length) return current;
      void Promise.all(result.changed.map((note) => storeNote(note)));
      return result.notes;
    });
  }, []);

  const deleteNote = useCallback(async (noteId: string) => {
    const removed = notes.find((note) => note.id === noteId);
    setNotes((current) => current.filter((note) => note.id !== noteId));
    if (await removeNote(noteId)) return;
    if (removed) setNotes((current) => sortNotes([...current, removed]));
    throw new Error("Не удалось удалить запись на устройстве");
  }, [notes]);

  const createFolder = useCallback(async (name: string) => {
    const normalized = normalizedFolderName(name);
    if (!normalized) return null;
    const existing = folders.find((folder) => folder.name.localeCompare(normalized, "ru", { sensitivity: "accent" }) === 0);
    if (existing) return existing;
    const folder: NoteFolder = {
      id: createId("folder"),
      name: normalized.slice(0, 28),
      color: FOLDER_COLORS[folders.length % FOLDER_COLORS.length],
      system: false,
      createdAt: new Date().toISOString()
    };
    setFolders((current) => [...current, folder]);
    await storeFolder(folder);
    return folder;
  }, [folders]);

  const deleteFolder = useCallback(async (folderId: string) => {
    const folder = folders.find((item) => item.id === folderId);
    if (!folder || folder.system) return;
    setFolders((current) => current.filter((item) => item.id !== folderId));
    setNotes((current) => {
      const next = current.map((note) => note.space === folder.name
        ? { ...note, space: "Входящие", spaceManual: false, updatedAt: new Date().toISOString() }
        : note);
      next.filter((note, index) => note !== current[index]).forEach((note) => void storeNote(note));
      return sortNotes(next);
    });
    await removeFolder(folderId);
  }, [folders]);

  const importNotes = useCallback(async (incoming: SmartNote[], incomingFolders: NoteFolder[] = []) => {
    const folderNames = new Set(folders.map((folder) => folder.name.trim().toLocaleLowerCase()));
    for (const folder of incomingFolders) {
      const name = folder.name.trim().toLocaleLowerCase();
      if (folderNames.has(name)) continue;
      folderNames.add(name);
      const restored = { ...folder, id: createId("folder"), system: false };
      if (!await storeFolder(restored)) throw new Error("Не удалось сохранить папку");
      setFolders((current) => [...current, restored]);
    }
    let importedCount = 0;
    const merged = new Map(notes.map((note) => [note.id, note]));
    incoming.forEach((note) => {
      const existing = merged.get(note.id);
      if (!existing || Date.parse(note.updatedAt) > Date.parse(existing.updatedAt)) {
        merged.set(note.id, {
          ...normalizeStoredNote(note),
          classificationPending: false
        });
        importedCount += 1;
      }
    });
    const mergedNotes = sortNotes([...merged.values()]);
    for (const note of mergedNotes) {
      if (notes.find((existing) => existing.id === note.id) === note) continue;
      if (!await storeNote(note)) throw new Error("Не удалось сохранить запись");
      setNotes((current) => sortNotes([...current.filter((existing) => existing.id !== note.id), note]));
    }
    return importedCount;
  }, [notes, folders]);

  const classifyDraft = useCallback((text: string) => classifyNote(text, subjects, spaces), [spaces, subjects]);

  return {
    notes,
    folders,
    ready,
    subjects,
    spaces,
    createNote,
    updateNote,
    toggleNote,
    togglePinned,
    reorderNotes,
    deleteNote,
    createFolder,
    deleteFolder,
    importNotes,
    classifyDraft
  };
}
