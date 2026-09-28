import {
  BookOpenCheck,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  FolderHeart,
  FolderPlus,
  Inbox,
  Lightbulb,
  ListTodo,
  LoaderCircle,
  Mic,
  Music2,
  PanelsTopLeft,
  Radio,
  Search,
  Sparkles,
  SquarePen,
  X
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LessonSlot, WeekMode } from "../../types";
import { FolderSheet } from "./FolderSheet";
import { deadlineForCalendarDate } from "./noteDeadline";
import { NoteCard } from "./NoteCard";
import type { NoteDropPlacement } from "./noteOrdering";
import type { LessonNoteContext, NoteClassification, NoteComposerRequest, NoteDocumentInput, NoteFolder, SmartNote } from "./noteTypes";

let noteComposerModule: Promise<typeof import("./NoteComposer")> | undefined;
let calendarModule: Promise<typeof import("./SmartCalendarSheet")> | undefined;

function loadNoteComposer() {
  noteComposerModule ??= import("./NoteComposer");
  return noteComposerModule;
}

function loadSmartCalendar() {
  calendarModule ??= import("./SmartCalendarSheet");
  return calendarModule;
}

function preloadNoteComposer() {
  void loadNoteComposer().catch(() => undefined);
}

function preloadSmartCalendar() {
  void loadSmartCalendar().catch(() => undefined);
}

const LazyNoteComposer = lazy(async () => ({ default: (await loadNoteComposer()).NoteComposer }));
const LazySmartCalendarSheet = lazy(async () => ({ default: (await loadSmartCalendar()).SmartCalendarSheet }));

function SheetModuleFallback({ label }: { label: string }) {
  const layer = (
    <div className="sheet-layer sheet-module-layer" aria-live="polite">
      <div className="sheet-module-loading"><LoaderCircle className="spin" size={22} /><span>{label}</span></div>
    </div>
  );
  const portalHost = document.querySelector(".phone-frame");
  return portalHost ? createPortal(layer, portalHost) : layer;
}

interface NotesViewProps {
  visualSrc: string;
  notes: SmartNote[];
  folders: NoteFolder[];
  lessons: LessonSlot[];
  ready: boolean;
  weekMode: WeekMode;
  calendarRequestToken: number;
  composerRequest?: NoteComposerRequest | null;
  classifyDraft: (text: string) => NoteClassification;
  onCreate: (input: NoteDocumentInput) => Promise<SmartNote>;
  onCreateFolder: (name: string) => Promise<NoteFolder | null>;
  onDelete: (noteId: string) => Promise<void>;
  onDeleteFolder: (folderId: string) => Promise<void>;
  onReorder: (sourceId: string, targetId: string, placement: NoteDropPlacement) => void;
  onToggle: (noteId: string) => void;
  onTogglePinned: (noteId: string) => void;
  onUpdate: (noteId: string, input: NoteDocumentInput) => Promise<SmartNote | undefined>;
  onCalendarRequestHandled: () => void;
  onComposerRequestHandled: () => void;
  onOpenSettings: () => void;
}

interface SmartFilter {
  id: string;
  label: string;
  space?: string;
  color?: string;
  icon: typeof Inbox;
  matches?: (note: SmartNote) => boolean;
}

interface NoteReorderState {
  sourceId: string;
  targetId?: string;
  placement?: NoteDropPlacement;
  moved: boolean;
}

function iconForSpace(space: string) {
  const value = space.toLocaleLowerCase("ru-RU");
  if (value.includes("учёб") || value.includes("учеб")) return BookOpenCheck;
  if (value.includes("работ")) return BriefcaseBusiness;
  if (value.includes("танц")) return Music2;
  if (value.includes("радио")) return Radio;
  if (value.includes("проект")) return PanelsTopLeft;
  if (value.includes("дел")) return ListTodo;
  if (value.includes("хот")) return FolderHeart;
  if (value.includes("иде")) return Lightbulb;
  return Sparkles;
}

export function NotesView({
  visualSrc,
  notes,
  folders,
  lessons = [],
  ready,
  weekMode = "all",
  calendarRequestToken,
  composerRequest,
  classifyDraft,
  onCreate,
  onCreateFolder,
  onDelete,
  onDeleteFolder,
  onReorder,
  onToggle,
  onTogglePinned,
  onUpdate,
  onCalendarRequestHandled,
  onComposerRequestHandled,
  onOpenSettings
}: NotesViewProps) {
  const [activeFilter, setActiveFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [composerOpen, setComposerOpen] = useState(() => new URLSearchParams(window.location.search).get("compose") === "1");
  const [folderSheetOpen, setFolderSheetOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<SmartNote | null>(null);
  const [voiceStartToken, setVoiceStartToken] = useState(0);
  const [composerSeed, setComposerSeed] = useState("");
  const [composerDueAt, setComposerDueAt] = useState<string | undefined>(undefined);
  const [composerLessonContext, setComposerLessonContext] = useState<LessonNoteContext | undefined>(undefined);
  const [revealedNoteId, setRevealedNoteId] = useState<string | null>(null);
  const [reorderState, setReorderState] = useState<NoteReorderState | null>(null);
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
  const voiceRequestIdRef = useRef(0);
  const reorderStateRef = useRef<NoteReorderState | null>(null);
  const reorderOriginRef = useRef({ x: 0, y: 0 });

  const filters = useMemo<SmartFilter[]>(() => {
    const folderFilters = folders.map((folder) => ({
      id: `folder:${folder.id}`,
      label: folder.name,
      space: folder.name,
      color: folder.color,
      icon: iconForSpace(folder.name)
    }));
    const reserved = new Set(folders.map((folder) => folder.name.toLocaleLowerCase("ru-RU")));
    const dynamic = [...new Set(notes.map((note) => note.space))]
      .filter((space) => !reserved.has(space.toLocaleLowerCase("ru-RU")))
      .sort((a, b) => a.localeCompare(b, "ru"))
      .map((space) => ({ id: `space:${space}`, label: space, space, icon: iconForSpace(space) }));
    return [{ id: "all", label: "Все", icon: Inbox }, ...folderFilters, ...dynamic];
  }, [folders, notes]);

  const openCount = notes.filter((note) => note.status === "open").length;
  const showNoteControls = ready && notes.length > 0;
  const studyCount = notes.filter((note) => note.status === "open" && (note.space === "Учёба" || note.kind === "homework")).length;
  const todayDateKey = new Date().toDateString();
  const todayCount = notes.filter((note) => note.status === "open" && note.dueAt && new Date(note.dueAt).toDateString() === todayDateKey).length;
  const summaryFilters = useMemo<SmartFilter[]>(() => [
    { id: "smart:open", label: "Открытые", icon: ListTodo, matches: (note) => note.status === "open" },
    { id: "smart:study", label: "Учёба", icon: BookOpenCheck, matches: (note) => note.status === "open" && (note.space === "Учёба" || note.kind === "homework") },
    { id: "smart:today", label: "Сегодня", icon: CheckCircle2, matches: (note) => note.status === "open" && Boolean(note.dueAt) && new Date(note.dueAt!).toDateString() === todayDateKey }
  ], [todayDateKey]);
  const selectedFilter = [...summaryFilters, ...filters].find((filter) => filter.id === activeFilter) ?? filters[0];
  const visibleNotes = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU");
    return notes.filter((note) => {
      if (selectedFilter.matches && !selectedFilter.matches(note)) return false;
      if (selectedFilter.space && note.space !== selectedFilter.space) return false;
      if (!normalizedQuery) return true;
      return `${note.title} ${note.text} ${note.space} ${note.topic ?? ""} ${note.subjectLabel ?? ""}`.toLocaleLowerCase("ru-RU").includes(normalizedQuery);
    });
  }, [notes, query, selectedFilter]);

  const calendarDate = new Date();
  const calendarDay = calendarDate.getDate();
  const calendarMonth = new Intl.DateTimeFormat("ru-RU", { month: "short" }).format(calendarDate).replace(".", "");
  const deadlineCount = notes.filter((note) => note.status === "open" && note.dueAt).length;

  function updateReorderState(next: NoteReorderState | null) {
    reorderStateRef.current = next;
    setReorderState(next);
  }

  function startReorder(noteId: string, clientX: number, clientY: number) {
    const note = notes.find((item) => item.id === noteId);
    if (!note || note.status !== "open") return;
    setRevealedNoteId(null);
    reorderOriginRef.current = { x: clientX, y: clientY };
    updateReorderState({ sourceId: noteId, moved: false });
  }

  function moveReorder(noteId: string, clientX: number, clientY: number) {
    const current = reorderStateRef.current;
    if (!current || current.sourceId !== noteId) return;
    const distance = Math.hypot(clientX - reorderOriginRef.current.x, clientY - reorderOriginRef.current.y);
    if (!current.moved && distance < 7) return;

    const scrollHost = document.querySelector<HTMLElement>(".content-scroll");
    if (scrollHost) {
      const scrollRect = scrollHost.getBoundingClientRect();
      const edgeSize = Math.min(64, scrollRect.height * 0.16);
      if (clientY < scrollRect.top + edgeSize) scrollHost.scrollTop -= 12;
      else if (clientY > scrollRect.bottom - edgeSize) scrollHost.scrollTop += 12;
    }

    const targetElement = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-note-id]");
    const targetId = targetElement?.dataset.noteId;
    const source = notes.find((note) => note.id === current.sourceId);
    const target = notes.find((note) => note.id === targetId);
    if (!targetId) {
      if (!current.moved) updateReorderState({ ...current, moved: true });
      return;
    }
    if (!source || !target || source.id === target.id || target.status !== "open" || source.pinned !== target.pinned) {
      if (!current.moved || current.targetId) updateReorderState({ sourceId: current.sourceId, moved: true });
      return;
    }

    const targetRect = targetElement!.getBoundingClientRect();
    const placement: NoteDropPlacement = clientY < targetRect.top + targetRect.height / 2 ? "before" : "after";
    if (current.moved && current.targetId === target.id && current.placement === placement) return;
    updateReorderState({ sourceId: current.sourceId, targetId: target.id, placement, moved: true });
  }

  function finishReorder(noteId: string) {
    const current = reorderStateRef.current;
    if (!current || current.sourceId !== noteId) return;
    if (current.moved && current.targetId && current.placement) {
      const source = notes.find((note) => note.id === current.sourceId);
      const target = notes.find((note) => note.id === current.targetId);
      onReorder(current.sourceId, current.targetId, current.placement);
      if (source && target) {
        setReorderAnnouncement(
          `Запись «${source.title}» перемещена ${current.placement === "before" ? "перед" : "после"} «${target.title}»`
        );
      }
    }
    updateReorderState(null);
  }

  function moveNoteWithKeyboard(noteId: string, direction: "up" | "down") {
    const source = visibleNotes.find((note) => note.id === noteId);
    if (!source || source.status !== "open") return;
    const group = visibleNotes.filter((note) => note.status === "open" && note.pinned === source.pinned);
    const sourceIndex = group.findIndex((note) => note.id === noteId);
    const targetIndex = sourceIndex + (direction === "up" ? -1 : 1);
    const target = group[targetIndex];
    if (!target) {
      setReorderAnnouncement(direction === "up" ? "Запись уже первая" : "Запись уже последняя");
      return;
    }
    onReorder(noteId, target.id, direction === "up" ? "before" : "after");
    setReorderAnnouncement(`Запись «${source.title}» перемещена ${direction === "up" ? "выше" : "ниже"}`);
  }

  useEffect(() => {
    if (revealedNoteId && !notes.some((note) => note.id === revealedNoteId)) setRevealedNoteId(null);
  }, [notes, revealedNoteId]);

  useEffect(() => {
    if (!ready || notes.length > 0) return;
    setActiveFilter("all");
    setQuery("");
  }, [ready, notes.length]);

  useEffect(() => {
    if (!reorderState) return;
    const moveFromWindow = (event: PointerEvent | MouseEvent) => {
      const current = reorderStateRef.current;
      if (current) moveReorder(current.sourceId, event.clientX, event.clientY);
    };
    const moveTouchFromWindow = (event: TouchEvent) => {
      const current = reorderStateRef.current;
      const touch = event.touches[0];
      if (current && touch) moveReorder(current.sourceId, touch.clientX, touch.clientY);
    };
    const finishFromWindow = () => {
      const current = reorderStateRef.current;
      if (current) {
        const activeElement = document.activeElement;
        if (
          activeElement instanceof HTMLElement &&
          activeElement.closest<HTMLElement>("[data-note-id]")?.dataset.noteId === current.sourceId
        ) {
          activeElement.blur();
        }
        finishReorder(current.sourceId);
      }
    };
    const cancelFromWindow = () => updateReorderState(null);
    const supportsPointerEvents = "PointerEvent" in window;
    if (supportsPointerEvents) {
      window.addEventListener("pointermove", moveFromWindow, true);
      window.addEventListener("pointerup", finishFromWindow, true);
      window.addEventListener("pointercancel", cancelFromWindow, true);
    } else {
      window.addEventListener("mousemove", moveFromWindow, true);
      window.addEventListener("touchmove", moveTouchFromWindow, true);
      window.addEventListener("mouseup", finishFromWindow, true);
      window.addEventListener("touchend", finishFromWindow, true);
      window.addEventListener("touchcancel", cancelFromWindow, true);
    }
    window.addEventListener("blur", cancelFromWindow);
    return () => {
      if (supportsPointerEvents) {
        window.removeEventListener("pointermove", moveFromWindow, true);
        window.removeEventListener("pointerup", finishFromWindow, true);
        window.removeEventListener("pointercancel", cancelFromWindow, true);
      } else {
        window.removeEventListener("mousemove", moveFromWindow, true);
        window.removeEventListener("touchmove", moveTouchFromWindow, true);
        window.removeEventListener("mouseup", finishFromWindow, true);
        window.removeEventListener("touchend", finishFromWindow, true);
        window.removeEventListener("touchcancel", cancelFromWindow, true);
      }
      window.removeEventListener("blur", cancelFromWindow);
    };
  }, [reorderState]);

  useEffect(() => {
    if (!calendarRequestToken) return;
    preloadSmartCalendar();
    setCalendarOpen(true);
    onCalendarRequestHandled();
  }, [calendarRequestToken, onCalendarRequestHandled]);

  useEffect(() => {
    if (!composerRequest) return;
    preloadNoteComposer();
    setEditingNote(null);
    setComposerSeed(composerRequest.seed ?? "");
    setComposerDueAt(composerRequest.dueAt);
    setComposerLessonContext(composerRequest.lessonContext);
    setVoiceStartToken(0);
    setComposerOpen(true);
    onComposerRequestHandled();
  }, [composerRequest, onComposerRequestHandled]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void Promise.allSettled([loadNoteComposer(), loadSmartCalendar()]);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, []);

  function closeComposer() {
    setComposerOpen(false);
    setEditingNote(null);
    setVoiceStartToken(0);
    setComposerSeed("");
    setComposerDueAt(undefined);
    setComposerLessonContext(undefined);
  }

  function createBlankNote(seed = "", dueAt?: string, lessonContext?: LessonNoteContext) {
    preloadNoteComposer();
    setEditingNote(null);
    setComposerSeed(seed);
    setComposerDueAt(dueAt);
    setComposerLessonContext(lessonContext);
    setVoiceStartToken(0);
    setComposerOpen(true);
  }

  function startDictation() {
    preloadNoteComposer();
    setEditingNote(null);
    setComposerSeed("");
    setComposerDueAt(undefined);
    setComposerLessonContext(undefined);
    voiceRequestIdRef.current += 1;
    setVoiceStartToken(voiceRequestIdRef.current);
    setComposerOpen(true);
  }

  function openNote(note: SmartNote) {
    preloadNoteComposer();
    setCalendarOpen(false);
    setEditingNote(note);
    setComposerSeed("");
    setComposerDueAt(undefined);
    setComposerLessonContext(note.lessonContext);
    setVoiceStartToken(0);
    setComposerOpen(true);
  }

  async function saveNote(input: NoteDocumentInput, noteId?: string) {
    if (noteId) await onUpdate(noteId, input);
    else {
      await onCreate(input);
      setActiveFilter("all");
      setQuery("");
    }
  }

  return (
    <div className="view-stack notes-view">
      <div className="notes-dashboard">
        <section className="notes-heading">
          <div>
            <span>Личное пространство</span>
            <h2>Записи</h2>
          </div>
          <div className="notes-heading-actions">
            <button type="button" onPointerDown={preloadNoteComposer} onClick={startDictation} aria-label="Начать умную диктовку" title="Умная диктовка" data-testid="start-smart-dictation">
              <Mic size={20} />
            </button>
          </div>
        </section>

        {showNoteControls && <section className="notes-pulse" aria-label="Умные фильтры записей">
          <button type="button" className={activeFilter === "smart:open" ? "active" : ""} onClick={() => { setActiveFilter("smart:open"); setRevealedNoteId(null); }} aria-pressed={activeFilter === "smart:open"}>
            <span>Открыто</span><strong>{openCount}</strong><ListTodo size={18} />
          </button>
          <button type="button" className={activeFilter === "smart:study" ? "active" : ""} onClick={() => { setActiveFilter("smart:study"); setRevealedNoteId(null); }} aria-pressed={activeFilter === "smart:study"}>
            <span>Учёба</span><strong>{studyCount}</strong><BookOpenCheck size={18} />
          </button>
          <button type="button" className={activeFilter === "smart:today" ? "active" : ""} onClick={() => { setActiveFilter("smart:today"); setRevealedNoteId(null); }} aria-pressed={activeFilter === "smart:today"}>
            <span>Сегодня</span><strong>{todayCount}</strong><CheckCircle2 size={18} />
          </button>
        </section>}

        <button className="quick-capture create-entry" type="button" onPointerDown={preloadNoteComposer} onClick={() => createBlankNote()} aria-label="Создать запись" data-testid="open-note-composer">
          <span className="quick-capture-icon"><SquarePen size={23} /></span>
          <span>
            <strong>Создать запись</strong>
            <small>Текст, чек-лист, фото или идея в свободной форме</small>
          </span>
          <span className="quick-capture-tail" aria-hidden="true"><Sparkles size={14} /><ChevronRight size={21} /></span>
        </button>

        <button className="calendar-launch-card" type="button" onPointerDown={preloadSmartCalendar} onClick={() => setCalendarOpen(true)} aria-label="Открыть календарь пар и записей" data-testid="calendar-launch-card">
          <span className="calendar-launch-date" aria-hidden="true">
            <small>{calendarMonth}</small>
            <strong>{calendarDay}</strong>
          </span>
          <span className="calendar-launch-copy">
            <small>Пары + личные планы</small>
            <strong>Календарь</strong>
            <em>{deadlineCount ? `Сроков в записях: ${deadlineCount}` : "Все даты в одном ритме"}</em>
          </span>
          <span className="calendar-launch-tail" aria-hidden="true"><CalendarDays size={18} /><ChevronRight size={21} /></span>
        </button>

        {showNoteControls && <label className="notes-search">
          <Search size={18} />
          <input value={query} onChange={(event) => { setQuery(event.target.value); setRevealedNoteId(null); }} placeholder="Поиск по записям" aria-label="Поиск по записям" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Очистить поиск" title="Очистить"><X size={16} /></button>}
        </label>}

        <div className="space-rail" aria-label="Папки записей">
          {showNoteControls && filters.map(({ id, label, space, color, icon: Icon }) => {
            const count = notes.filter((note) => !space || note.space === space).length;
            return (
              <button key={id} className={selectedFilter.id === id ? "active" : ""} type="button" onClick={() => { setActiveFilter(id); setRevealedNoteId(null); }} aria-pressed={selectedFilter.id === id}>
                {color ? <i className="folder-color" style={{ background: color }} aria-hidden="true" /> : <Icon size={16} />}
                <span>{label}</span>
                <small>{count}</small>
              </button>
            );
          })}
          <button className="folder-manage-button" type="button" onClick={() => setFolderSheetOpen(true)} aria-label="Добавить или изменить папки" title="Папки">
            <FolderPlus size={16} />
            <span>Папки</span>
          </button>
        </div>
      </div>

      {!ready ? (
        <section className="notes-loading" aria-label="Загрузка записей"><span /><span /><span /></section>
      ) : visibleNotes.length ? (
        <section className={`notes-list ${reorderState ? "is-reordering" : ""}`} aria-label={`Записи: ${selectedFilter.label}`}>
          <header><span>{selectedFilter.label}</span><strong>{visibleNotes.length}</strong></header>
          <p className="visually-hidden" aria-live="polite">{reorderAnnouncement}</p>
          {visibleNotes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              revealed={revealedNoteId === note.id}
              reordering={reorderState?.sourceId === note.id}
              dropPlacement={reorderState?.targetId === note.id ? reorderState.placement : undefined}
              onEdit={(value) => {
                openNote(value);
              }}
              onDelete={async (noteId) => {
                await onDelete(noteId);
                setRevealedNoteId(null);
              }}
              onReveal={() => setRevealedNoteId(note.id)}
              onCloseReveal={() => setRevealedNoteId(null)}
              onMove={moveNoteWithKeyboard}
              onReorderStart={startReorder}
              onReorderEnd={finishReorder}
              onReorderCancel={() => updateReorderState(null)}
              onToggle={onToggle}
              onTogglePinned={onTogglePinned}
            />
          ))}
        </section>
      ) : (
        <section className="notes-empty">
          <img className="notes-empty-backdrop" src={visualSrc} alt="" aria-hidden="true" />
          <img className="notes-empty-visual" src={visualSrc} alt="Блокнот с расписанием и зарисовкой главного корпуса ВлГУ" />
          <div>
            <Sparkles size={23} />
            <h3>{query ? "Ничего не найдено" : "Здесь пока тихо"}</h3>
            <p>{query ? "Попробуйте другой запрос." : "Новая запись появится в этом пространстве."}</p>
            {!query && ready && notes.length === 0 && (
              <button className="notes-empty-recovery" type="button" onClick={onOpenSettings}>
                Были записи на другом адресе? Открыть импорт
              </button>
            )}
          </div>
        </section>
      )}

      {composerOpen && (
        <Suspense fallback={<SheetModuleFallback label="Открываем запись" />}>
          <LazyNoteComposer
            note={editingNote}
            folders={folders}
            open={composerOpen}
            initialSeed={composerSeed}
            initialDueAt={composerDueAt}
            initialLessonContext={composerLessonContext}
            voiceStartToken={voiceStartToken}
            classifyDraft={classifyDraft}
            onClose={closeComposer}
            onDelete={onDelete}
            onSave={saveNote}
          />
        </Suspense>
      )}
      <FolderSheet folders={folders} open={folderSheetOpen} onClose={() => setFolderSheetOpen(false)} onCreate={onCreateFolder} onDelete={onDeleteFolder} />
      {calendarOpen && (
        <Suspense fallback={<SheetModuleFallback label="Открываем календарь" />}>
          <LazySmartCalendarSheet
            lessons={lessons}
            notes={notes}
            open={calendarOpen}
            weekMode={weekMode}
            onClose={() => setCalendarOpen(false)}
            onCreateForDate={(date) => createBlankNote("", deadlineForCalendarDate(date))}
            onOpenNote={(noteId) => {
              const note = notes.find((item) => item.id === noteId);
              if (note) openNote(note);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
