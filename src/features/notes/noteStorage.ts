import type { NoteDraft, NoteFolder, SmartNote } from "./noteTypes";
import { LEGACY_PI124_GROUP } from "../groups/groupTypes";

const DB_NAME = "lad-personal";
const DB_VERSION = 2;
const DB_OPEN_TIMEOUT_MS = 1500;
const DB_OPERATION_TIMEOUT_MS = 2500;
const NOTES_STORE = "notes";
const FOLDERS_STORE = "folders";
const DRAFTS_STORE = "drafts";
const NOTES_FALLBACK_KEY = "lad.notes.fallback";
const NOTES_DELETED_KEY = "lad.notes.deleted.v1";
const FOLDERS_FALLBACK_KEY = "lad.note-folders.fallback";
const DRAFTS_FALLBACK_KEY = "lad.note-drafts.fallback";
const DEFAULT_DATE = "2026-01-01T00:00:00.000Z";

export const DEFAULT_NOTE_FOLDERS: NoteFolder[] = [
  { id: "inbox", name: "Входящие", color: "#9ca8ba", system: true, createdAt: DEFAULT_DATE },
  { id: "study", name: "Учёба", color: "#76a8ff", system: true, createdAt: DEFAULT_DATE },
  { id: "work", name: "Работа", color: "#eea56c", system: true, createdAt: DEFAULT_DATE },
  { id: "tasks", name: "Дела", color: "#59dfc1", system: true, createdAt: DEFAULT_DATE },
  { id: "wishes", name: "Хотелки", color: "#ff8a7f", system: true, createdAt: DEFAULT_DATE },
  { id: "dance", name: "Танцы", color: "#d89cff", system: true, createdAt: DEFAULT_DATE },
  { id: "radio", name: "Радио", color: "#ffc55f", system: true, createdAt: DEFAULT_DATE },
  { id: "project", name: "Проект", color: "#6bd6ff", system: true, createdAt: DEFAULT_DATE }
];

function readFallback<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeFallback<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    let settled = false;
    const fail = (error: Error | DOMException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };
    const timeout = setTimeout(() => fail(new Error("IndexedDB open timed out")), DB_OPEN_TIMEOUT_MS);
    request.onupgradeneeded = () => {
      if (settled) {
        request.transaction?.abort();
        return;
      }
      const database = request.result;
      if (!database.objectStoreNames.contains(NOTES_STORE)) {
        const store = database.createObjectStore(NOTES_STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
        store.createIndex("space", "space");
        store.createIndex("subjectKey", "subjectKey");
      }
      if (!database.objectStoreNames.contains(FOLDERS_STORE)) {
        database.createObjectStore(FOLDERS_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(DRAFTS_STORE)) {
        database.createObjectStore(DRAFTS_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      settled = true;
      clearTimeout(timeout);
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => fail(request.error ?? new Error("IndexedDB failed"));
    request.onblocked = () => fail(new Error("IndexedDB upgrade blocked"));
  });
}

async function runStoreRequest<T>(storeName: string, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      let settled = false;
      let result: T;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error ?? new Error("IndexedDB transaction failed"));
      };
      const timeout = setTimeout(() => {
        fail(new Error("IndexedDB transaction timed out"));
        // Abort pending writes so a late commit cannot replace a newer retry.
        try { transaction.abort(); } catch { /* Already completed or unavailable. */ }
      }, DB_OPERATION_TIMEOUT_MS);
      transaction.oncomplete = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(result);
      };
      transaction.onerror = () => fail(transaction.error);
      transaction.onabort = () => fail(transaction.error);
      try {
        const request = operation(transaction.objectStore(storeName));
        request.onsuccess = () => { result = request.result; };
        request.onerror = () => fail(request.error);
      } catch (error) {
        fail(error);
        try { transaction.abort(); } catch { /* No active transaction. */ }
      }
    });
  } finally {
    database.close();
  }
}

async function getAll<T>(storeName: string): Promise<T[]> {
  return runStoreRequest<T[]>(storeName, "readonly", (store) => store.getAll());
}

async function putValue<T>(storeName: string, value: T): Promise<void> {
  await runStoreRequest(storeName, "readwrite", (store) => store.put(value));
}

async function deleteValue(storeName: string, id: string): Promise<void> {
  await runStoreRequest(storeName, "readwrite", (store) => store.delete(id));
}

export type NotesLoadStatus = "database" | "fallback" | "unavailable";

export async function loadNotesWithStatus(): Promise<{ notes: SmartNote[]; status: NotesLoadStatus }> {
  const fallbackNotes = readFallback<SmartNote[]>(NOTES_FALLBACK_KEY, []);
  let notes: SmartNote[];
  let status: NotesLoadStatus = "database";
  try {
    const storedNotes = await getAll<SmartNote>(NOTES_STORE);
    const merged = new Map(fallbackNotes.map((note) => [note.id, note]));
    storedNotes.forEach((note) => {
      const fallback = merged.get(note.id);
      if (!fallback || Date.parse(note.updatedAt) >= Date.parse(fallback.updatedAt)) merged.set(note.id, note);
    });
    notes = [...merged.values()];
  } catch {
    notes = fallbackNotes;
    status = fallbackNotes.length ? "fallback" : "unavailable";
  }
  const deleted = new Set(readFallback<string[]>(NOTES_DELETED_KEY, []));
  const normalized = notes.filter((note) => !deleted.has(note.id)).map(normalizeStoredNote);
  if (status !== "unavailable") writeFallback(NOTES_FALLBACK_KEY, normalized);
  return { notes: normalized, status };
}

export async function loadNotes(): Promise<SmartNote[]> {
  return (await loadNotesWithStatus()).notes;
}

export function normalizeStoredNote(note: SmartNote): SmartNote {
  const hasStudyLink = Boolean(note.subjectKey || note.lessonContext);
  const groupNrec = note.groupNrec ?? note.lessonContext?.groupNrec ?? (hasStudyLink ? LEGACY_PI124_GROUP.nrec : undefined);
  const groupName = note.groupName ?? note.lessonContext?.groupName ?? (groupNrec === LEGACY_PI124_GROUP.nrec ? LEGACY_PI124_GROUP.name : undefined);
  return {
    ...note,
    contentUpdatedAt: note.contentUpdatedAt ?? note.createdAt ?? note.updatedAt,
    ...(groupNrec ? { groupNrec } : {}),
    ...(groupName ? { groupName } : {}),
    ...(note.lessonContext && groupNrec ? {
      lessonContext: {
        ...note.lessonContext,
        groupNrec,
        ...(groupName ? { groupName } : {})
      }
    } : {})
  };
}

export async function storeNote(note: SmartNote): Promise<boolean> {
  const notes = readFallback<SmartNote[]>(NOTES_FALLBACK_KEY, []).filter((item) => item.id !== note.id);
  const mirrored = writeFallback(NOTES_FALLBACK_KEY, [...notes, note]);
  let stored = mirrored;
  try {
    await putValue(NOTES_STORE, note);
    stored = true;
  } catch { /* The local mirror can still keep this note. */ }
  if (!stored) return false;
  const deleted = readFallback<string[]>(NOTES_DELETED_KEY, []);
  return !deleted.includes(note.id) || writeFallback(NOTES_DELETED_KEY, deleted.filter((id) => id !== note.id));
}

export async function removeNote(noteId: string): Promise<boolean> {
  const deleted = readFallback<string[]>(NOTES_DELETED_KEY, []);
  const marked = writeFallback(NOTES_DELETED_KEY, [...new Set([...deleted, noteId])]);
  if (marked) {
    writeFallback(NOTES_FALLBACK_KEY, readFallback<SmartNote[]>(NOTES_FALLBACK_KEY, []).filter((note) => note.id !== noteId));
  }
  try {
    await deleteValue(NOTES_STORE, noteId);
    if (!marked) writeFallback(NOTES_FALLBACK_KEY, readFallback<SmartNote[]>(NOTES_FALLBACK_KEY, []).filter((note) => note.id !== noteId));
    return true;
  } catch { return marked; }
}

function mergeDefaultFolders(stored: NoteFolder[]) {
  const custom = stored.filter((folder) => !folder.system && !DEFAULT_NOTE_FOLDERS.some((item) => item.id === folder.id));
  return [...DEFAULT_NOTE_FOLDERS, ...custom];
}

export async function loadFolders(): Promise<NoteFolder[]> {
  const fallback = readFallback<NoteFolder[]>(FOLDERS_FALLBACK_KEY, []);
  try {
    const stored = await getAll<NoteFolder>(FOLDERS_STORE);
    const merged = new Map(fallback.map((folder) => [folder.id, folder]));
    stored.forEach((folder) => merged.set(folder.id, folder));
    const folders = mergeDefaultFolders([...merged.values()]);
    writeFallback(FOLDERS_FALLBACK_KEY, folders);
    return folders;
  } catch {
    return mergeDefaultFolders(fallback);
  }
}

export async function storeFolder(folder: NoteFolder): Promise<boolean> {
  const folders = readFallback<NoteFolder[]>(FOLDERS_FALLBACK_KEY, []).filter((item) => item.id !== folder.id);
  const mirrored = writeFallback(FOLDERS_FALLBACK_KEY, [...folders, folder]);
  try {
    await putValue(FOLDERS_STORE, folder);
    return true;
  } catch { return mirrored; }
}

export async function removeFolder(folderId: string): Promise<void> {
  writeFallback(FOLDERS_FALLBACK_KEY, readFallback<NoteFolder[]>(FOLDERS_FALLBACK_KEY, []).filter((folder) => folder.id !== folderId));
  try {
    await deleteValue(FOLDERS_STORE, folderId);
  } catch { /* Pending database deletions still need tombstone reconciliation. */ }
}

export async function loadDraft(draftId: string): Promise<NoteDraft | null> {
  try {
    const database = await openDatabase();
    try {
      return await new Promise<NoteDraft | null>((resolve, reject) => {
        const request = database.transaction(DRAFTS_STORE, "readonly").objectStore(DRAFTS_STORE).get(draftId);
        request.onsuccess = () => resolve((request.result as NoteDraft | undefined) ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  } catch {
    const drafts = readFallback<Record<string, NoteDraft>>(DRAFTS_FALLBACK_KEY, {});
    return drafts[draftId] ?? null;
  }
}

export function readDraftSnapshot(draftId: string) {
  return readFallback<Record<string, NoteDraft>>(DRAFTS_FALLBACK_KEY, {})[draftId] ?? null;
}

export async function storeDraft(draft: NoteDraft): Promise<boolean> {
  const drafts = readFallback<Record<string, NoteDraft>>(DRAFTS_FALLBACK_KEY, {});
  const mirrored = writeFallback(DRAFTS_FALLBACK_KEY, { ...drafts, [draft.id]: draft });
  try {
    await putValue(DRAFTS_STORE, draft);
    return true;
  } catch {
    return mirrored;
  }
}

export async function removeDraft(draftId: string): Promise<void> {
  const drafts = readFallback<Record<string, NoteDraft>>(DRAFTS_FALLBACK_KEY, {});
  delete drafts[draftId];
  writeFallback(DRAFTS_FALLBACK_KEY, drafts);
  try {
    await deleteValue(DRAFTS_STORE, draftId);
  } catch {
    // The mirror is authoritative when IndexedDB is unavailable.
  }
}
