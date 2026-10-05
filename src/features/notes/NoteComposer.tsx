import { BookOpenCheck, CalendarClock, Check, Folder, Link2, LoaderCircle, Pin, Save, Share2, Trash2, X } from "lucide-react";
import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { noteKindLabel } from "./noteClassifier";
import { plainTextToHtml } from "./noteContent";
import { localDateTimeToIso, resolveNoteDeadline, toLocalDateTimeValue } from "./noteDeadline";
import { readDraftSnapshot, removeDraft, storeDraft } from "./noteStorage";
import type { LessonNoteContext, NoteClassification, NoteDocumentInput, NoteDraft, NoteFolder, SmartNote } from "./noteTypes";

const LazyRichNoteEditor = lazy(async () => ({ default: (await import("./RichNoteEditor")).RichNoteEditor }));

interface NoteComposerProps {
  note: SmartNote | null;
  folders: NoteFolder[];
  open: boolean;
  initialSeed?: string;
  initialDueAt?: string;
  initialLessonContext?: LessonNoteContext;
  restoredDraft?: NoteDraft | null;
  voiceStartToken?: number;
  classifyDraft: (text: string) => NoteClassification;
  onClose: () => void;
  onDelete: (noteId: string) => Promise<void>;
  onSave: (input: NoteDocumentInput, noteId?: string) => Promise<void>;
}

type DraftState = "idle" | "saving" | "saved" | "error";
type ShareState = "idle" | "working" | "done" | "error";

export function NoteComposer({ note, folders, open, initialSeed = "", initialDueAt, initialLessonContext, restoredDraft, voiceStartToken = 0, classifyDraft, onClose, onDelete, onSave }: NoteComposerProps) {
  const [contentHtml, setContentHtml] = useState("<p></p>");
  const [text, setText] = useState("");
  const [pinned, setPinned] = useState(false);
  const [spaceOverride, setSpaceOverride] = useState("");
  const [deadlineValue, setDeadlineValue] = useState("");
  const [deadlineTouched, setDeadlineTouched] = useState(false);
  const [deadlineOpen, setDeadlineOpen] = useState(false);
  const [lessonContext, setLessonContext] = useState<LessonNoteContext | undefined>();
  const [shareState, setShareState] = useState<ShareState>("idle");
  const [hydrating, setHydrating] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [draftState, setDraftState] = useState<DraftState>("idle");
  const [editorKey, setEditorKey] = useState(0);
  const draftRevisionRef = useRef(0);
  const hydratedDraftRef = useRef<string | null>(null);
  const draftWriteRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const shareResetTimerRef = useRef<number | undefined>(undefined);
  const draftId = restoredDraft?.id ?? note?.id ?? (initialLessonContext
    ? `new-${initialLessonContext.lessonId}-${initialLessonContext.date}-${initialLessonContext.intent}`
    : "new");
  const noteSavedAt = note?.contentUpdatedAt ?? note?.createdAt ?? note?.updatedAt ?? "";
  const hasContent = Boolean(text.trim() || /<img\b/i.test(contentHtml));
  const hasShareableText = Boolean(text.trim());
  const classifiedText = useDeferredValue(text);
  const preview = useMemo(() => {
    if (!hasContent) return null;
    const classification = classifyDraft(classifiedText);
    const withSpace = spaceOverride ? { ...classification, space: spaceOverride } : classification;
    const deadline = resolveNoteDeadline(withSpace, deadlineTouched ? localDateTimeToIso(deadlineValue) ?? null : undefined);
    return { ...withSpace, ...deadline };
  }, [classifiedText, classifyDraft, deadlineTouched, deadlineValue, hasContent, spaceOverride]);

  useLayoutEffect(() => {
    if (!open) return;
    draftRevisionRef.current += 1;
    const snapshot = restoredDraft ?? readDraftSnapshot(draftId);
    setHydrating(true);
    const canRestore = Boolean(snapshot && (restoredDraft || !note || snapshot.updatedAt > noteSavedAt));
    const recoveredDraft = canRestore ? snapshot : null;
    const nextHtml = recoveredDraft?.contentHtml ?? note?.contentHtml ?? plainTextToHtml(note?.text ?? initialSeed);
    setContentHtml(nextHtml || "<p></p>");
    setText(recoveredDraft?.text ?? note?.text ?? initialSeed);
    setPinned(recoveredDraft?.pinned ?? note?.pinned ?? false);
    setSpaceOverride(recoveredDraft?.spaceOverride ?? (note?.spaceManual ? note.space : ""));
    setLessonContext(recoveredDraft?.lessonContext ?? note?.lessonContext ?? initialLessonContext);
    const draftHasDeadline = Boolean(recoveredDraft && Object.prototype.hasOwnProperty.call(recoveredDraft, "dueAtOverride"));
    const restoredDeadline = draftHasDeadline
      ? recoveredDraft!.dueAtOverride
      : note?.dueManual
        ? note.dueAt ?? null
        : initialDueAt;
    setDeadlineTouched(restoredDeadline !== undefined);
    setDeadlineValue(typeof restoredDeadline === "string" ? toLocalDateTimeValue(restoredDeadline) : note?.dueManual ? "" : toLocalDateTimeValue(note?.dueAt));
    setEditorKey((value) => value + 1);
    hydratedDraftRef.current = draftId;
    setHydrating(false);
    setSaving(false);
    setSaveError(false);
    setShareState("idle");
    setDeadlineOpen(Boolean(initialDueAt));
    setDraftState(recoveredDraft ? "saved" : "idle");
  }, [draftId, initialDueAt, initialLessonContext, initialSeed, note, noteSavedAt, open, restoredDraft]);

  const persistDraft = useCallback(async () => {
    if (!open || hydrating || hydratedDraftRef.current !== draftId) return false;
    const revision = draftRevisionRef.current;
    setDraftState("saving");
    const snapshot = {
      id: draftId,
      text,
      contentHtml,
      pinned,
      spaceOverride: spaceOverride || undefined,
      ...(deadlineTouched ? { dueAtOverride: localDateTimeToIso(deadlineValue) ?? null } : {}),
      lessonContext,
      updatedAt: new Date().toISOString()
    };
    const write = draftWriteRef.current
      .catch(() => undefined)
      .then(() => storeDraft(snapshot));
    draftWriteRef.current = write;
    const persisted = await write;
    if (revision === draftRevisionRef.current) setDraftState(persisted ? "saved" : "error");
    return persisted;
  }, [contentHtml, deadlineTouched, deadlineValue, draftId, hydrating, lessonContext, open, pinned, spaceOverride, text]);

  useEffect(() => {
    if (!open || hydrating) return;
    const timer = window.setTimeout(() => void persistDraft(), 480);
    return () => window.clearTimeout(timer);
  }, [contentHtml, deadlineTouched, deadlineValue, hydrating, lessonContext, open, persistDraft, pinned, spaceOverride, text]);

  useEffect(() => () => {
    if (shareResetTimerRef.current !== undefined) window.clearTimeout(shareResetTimerRef.current);
  }, []);

  const markDraftDirty = useCallback(() => {
    draftRevisionRef.current += 1;
    setDraftState("saving");
  }, []);

  const closeComposer = useCallback(() => {
    void persistDraft().then((persisted) => {
      if (persisted) onClose();
    });
  }, [onClose, persistDraft]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeComposer();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeComposer, open]);

  const handleEditorChange = useCallback((html: string, plainText: string) => {
    setContentHtml(html);
    setText(plainText);
    markDraftDirty();
  }, [markDraftDirty]);

  function scheduleShareReset() {
    if (shareResetTimerRef.current !== undefined) window.clearTimeout(shareResetTimerRef.current);
    shareResetTimerRef.current = window.setTimeout(() => setShareState("idle"), 1800);
  }

  async function shareCurrent() {
    const value = text.trim();
    if (!value || shareState === "working") return;
    setShareState("working");
    try {
      if (navigator.share) {
        await navigator.share({ title: note?.title ?? value.split("\n")[0].slice(0, 80), text: value });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const field = document.createElement("textarea");
        field.value = value;
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.append(field);
        field.select();
        document.execCommand("copy");
        field.remove();
      }
      setShareState("done");
      scheduleShareReset();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setShareState("idle");
        return;
      }
      setShareState("error");
      scheduleShareReset();
    }
  }

  async function submit() {
    if (!hasContent || saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      await onSave({
        text: text.trim(),
        contentHtml,
        pinned,
        spaceOverride: spaceOverride || undefined,
        ...(deadlineTouched ? { dueAtOverride: localDateTimeToIso(deadlineValue) ?? null } : {}),
        lessonContext
      }, note?.id);
      await draftWriteRef.current.catch(() => undefined);
      await removeDraft(draftId);
      onClose();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  async function deleteCurrent() {
    if (!note || saving) return;
    setSaving(true);
    try {
      await draftWriteRef.current.catch(() => undefined);
      await Promise.all([onDelete(note.id), removeDraft(draftId)]);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const layer = (
    <div className="sheet-layer composer-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeComposer()}>
      <section className="note-composer" role="dialog" aria-modal="true" aria-labelledby="composer-title">
        <div className="sheet-handle" aria-hidden="true" />
        <header className="composer-header">
          <button className="icon-button" type="button" onClick={closeComposer} aria-label="Закрыть запись" title="Закрыть">
            <X size={20} />
          </button>
          <div>
            <span>{note ? "Редактирование" : "Новая запись"}</span>
            <h2 id="composer-title">{note ? note.title : "Чистый лист"}</h2>
            <small className={`draft-status ${draftState}`} role="status">
              {draftState === "saving" ? <LoaderCircle className="spin" size={11} /> : <Save size={11} />}
              {saveError || draftState === "error" ? "Не сохранено: поделитесь текстом" : draftState === "saving" ? "Сохраняем черновик…" : draftState === "saved" ? "Черновик сохранён" : "Черновик"}
            </small>
          </div>
          <button className="composer-done" type="button" onClick={() => void submit()} disabled={!hasContent || saving} aria-label="Сохранить запись">
            {saving ? <LoaderCircle className="spin" size={19} /> : <Check size={19} />}
            <span>Готово</span>
          </button>
        </header>

        <div className="composer-paper">
          {hydrating ? (
            <div className="rich-editor-loading" aria-label="Восстановление черновика"><span /><span /><span /></div>
          ) : (
            <Suspense fallback={<div className="rich-editor-loading" aria-label="Подготовка редактора"><span /><span /><span /></div>}>
              <LazyRichNoteEditor key={`${draftId}-${editorKey}`} initialContent={contentHtml} autoStartVoiceToken={voiceStartToken} onChange={handleEditorChange} />
            </Suspense>
          )}
        </div>

        <div className="composer-context">
          <label className="folder-select">
            <Folder size={15} />
            <select value={spaceOverride} onChange={(event) => { setSpaceOverride(event.target.value); markDraftDirty(); }} aria-label="Папка записи">
              <option value="">Папка: автоматически</option>
              {folders.map((folder) => <option key={folder.id} value={folder.name}>{folder.name}</option>)}
            </select>
          </label>
          <button className={preview?.dueAt ? "active" : ""} type="button" onClick={() => setDeadlineOpen((value) => !value)} aria-label="Выбрать срок" aria-expanded={deadlineOpen} title={preview?.dueLabel ?? "Срок"}>
            <CalendarClock size={17} />
          </button>
          <button className={shareState === "done" ? "active" : shareState === "error" ? "error" : ""} type="button" onClick={() => void shareCurrent()} disabled={!hasShareableText || shareState === "working"} aria-label={shareState === "done" ? "Запись скопирована или отправлена" : shareState === "error" ? "Не удалось поделиться записью" : "Поделиться записью"} title={shareState === "done" ? "Готово" : shareState === "error" ? "Не удалось поделиться" : "Поделиться"}>
            {shareState === "working" ? <LoaderCircle className="spin" size={17} /> : shareState === "done" ? <Check size={17} /> : <Share2 size={17} />}
          </button>
          <button className={pinned ? "active" : ""} type="button" onClick={() => { setPinned((value) => !value); markDraftDirty(); }} aria-label={pinned ? "Открепить" : "Закрепить"} title={pinned ? "Открепить" : "Закрепить"}>
            <Pin size={17} fill={pinned ? "currentColor" : "none"} />
          </button>
        </div>

        {lessonContext && (
          <section className="composer-lesson-context" aria-label={`Связь с предметом ${lessonContext.subjectLabel}`}>
            <span className="composer-lesson-icon" aria-hidden="true">
              {lessonContext.intent === "homework" ? <BookOpenCheck size={18} /> : <Link2 size={18} />}
            </span>
            <span className="composer-lesson-copy">
              <small>{lessonContext.intent === "homework" ? "Домашнее задание" : "Запись к паре"}</small>
              <strong>{lessonContext.subjectLabel}</strong>
              <i>{new Date(`${lessonContext.date}T00:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })} · {lessonContext.start}</i>
            </span>
            <span className="composer-link-scope" role="radiogroup" aria-label="Область связи записи">
              <button type="button" className={lessonContext.scope === "lesson" ? "active" : ""} onClick={() => { setLessonContext((value) => value ? { ...value, scope: "lesson" } : value); markDraftDirty(); }} aria-pressed={lessonContext.scope === "lesson"}>Эта пара</button>
              <button type="button" className={lessonContext.scope === "subject" ? "active" : ""} onClick={() => { setLessonContext((value) => value ? { ...value, scope: "subject" } : value); markDraftDirty(); }} aria-pressed={lessonContext.scope === "subject"}>Все пары</button>
            </span>
            <button className="composer-unlink" type="button" onClick={() => { setLessonContext(undefined); markDraftDirty(); }} aria-label="Убрать связь с парой" title="Убрать связь"><X size={16} /></button>
          </section>
        )}

        {deadlineOpen && (
          <div className="composer-deadline-panel">
            <label>
              <CalendarClock size={16} />
              <span>Точный срок</span>
              <input
                type="datetime-local"
                value={deadlineValue}
                step="60"
                onChange={(event) => {
                  setDeadlineValue(event.target.value);
                  setDeadlineTouched(true);
                  markDraftDirty();
                }}
                aria-label="Дата и время срока"
              />
            </label>
            <button type="button" onClick={() => { setDeadlineValue(""); setDeadlineTouched(true); markDraftDirty(); }} disabled={!deadlineValue} aria-label="Убрать срок" title="Убрать срок">
              <X size={16} />
            </button>
          </div>
        )}

        <div className={`classification-preview ${preview ? "ready" : "empty"}`} aria-live="polite">
          {preview ? (
            <>
              <span>Тема</span>
              <strong>{lessonContext?.subjectLabel ?? preview.topic ?? preview.space}</strong>
              {preview.space !== "Входящие" && preview.space !== preview.topic && <i>{preview.space}</i>}
              <i>{noteKindLabel(preview.kind)}</i>
              {(lessonContext?.subjectLabel ?? preview.subjectLabel) && (lessonContext?.subjectLabel ?? preview.subjectLabel) !== preview.topic && <i>{lessonContext?.subjectLabel ?? preview.subjectLabel}</i>}
              {preview.dueLabel && <i>{preview.dueLabel}</i>}
            </>
          ) : (
            <small>Папка и тип определятся по смыслу записи</small>
          )}
        </div>

        <footer className="composer-toolbar">
          <span className="composer-storage-note">Автосохранение включено</span>
          {note && (
            <button className="composer-delete" type="button" onClick={() => void deleteCurrent()} disabled={saving} aria-label="Удалить запись" title="Удалить">
              <Trash2 size={19} />
            </button>
          )}
        </footer>
      </section>
    </div>
  );
  const portalHost = document.querySelector(".phone-frame");
  return portalHost ? createPortal(layer, portalHost) : layer;
}
