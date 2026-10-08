import {
  Fragment,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  Activity,
  Bell,
  BellRing,
  Smartphone,
  TriangleAlert,
  BookCheck,
  CalendarDays,
  CalendarPlus,
  CalendarX2,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CloudOff,
  Download,
  ExternalLink,
  Grid2X2,
  HardDrive,
  Info,
  MapPin,
  NotebookPen,
  Palette,
  RefreshCw,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Upload,
  Video,
  Waves
} from "lucide-react";
import type { AppTab, ApiStatus, LessonSlot, NotificationCapability, ReminderSettings, ScheduleState, WeekMode } from "./types";
import { downloadNotesBackup, parseNotesArchive } from "./features/notes/noteBackup";
import { deadlineForCalendarDate } from "./features/notes/noteDeadline";
import { createLessonNoteContext, notesLinkedToLesson } from "./features/notes/noteLinking";
import type { NoteComposerRequest, NoteDraft, NoteFolder, SmartNote } from "./features/notes/noteTypes";
import { importDrafts, loadDraftsWithStatus, type NotesLoadStatus } from "./features/notes/noteStorage";
import { useSmartNotes } from "./features/notes/useSmartNotes";
import { importPersonalEvents, personalEventsOnDate, usePersonalEvents } from "./features/notes/personalEvents";
import { GroupPickerSheet } from "./features/groups/GroupPickerSheet";
import { parseGroupLink, resolveGroupLink, syncGroupLink } from "./features/groups/groupLinks";
import { groupBadgeParts, type GroupProfile } from "./features/groups/groupTypes";
import { readFavoriteGroups, readGroupScheduleCache, readKnownGroup, readRecentGroups, readSelectedGroup, writeGroupScheduleCache, writeSelectedGroup } from "./features/groups/groupStorage";
import { ThemeSheet } from "./features/themes/ThemeSheet";
import {
  applyTheme,
  readCustomTheme,
  readTheme,
  saveCustomTheme,
  THEMES,
  type CustomTheme,
  type ThemeId
} from "./features/themes/theme";
import { activeWeekMode, loadSchedule, normalizeCachedSchedule } from "./lib/scheduleApi";
import { heroCopy } from "./lib/heroCopy";
import { scheduleNotice, preferNewerSchedule } from "./lib/freshness";
import { assetUrl } from "./lib/assetUrl";
import { backupSignature, markBackupMade, readBackupMade } from "./features/notes/backupState";
import { alignSubgroupOrder, lessonView, type SubgroupChoice } from "./lib/subgroup";
import { lessonWithSelectedVariant, readLessonSelections, selectedLessonVariant, setLessonSelection, writeLessonSelections } from "./lib/lessonSelection";
import { lessonChangeMessage } from "./lib/lessonChange";
import { resetUniversityBundleCache, warmUniversityScheduleBundle } from "./lib/staticData";
import { isSelectedScheduleUpdate } from "./lib/scheduleUpdate";
import { readReminderSettings, writeReminderSettings } from "./lib/storage";
import { getNotificationCapability, requestNotificationPermission, scheduleNextReminder, sendTestNotification } from "./lib/reminders";
import { resolveScreenSwipe } from "./lib/screenGestures";
import { weekStartForMode } from "./lib/academicWeek";
import {
  currentDayIndex,
  addDays,
  dateForWeekDay,
  dateKeyFromDate,
  relativeDayLabel,
  findNextStudyDay,
  type NextStudyDay,
  findCurrentAndNext,
  formatUpdatedAt,
  formatWeekMode,
  hasDatedLessons,
  lessonProgress,
  lessonTimingState,
  minutesFromTime,
  minutesUntilEnd,
  minutesUntilStart,
  selectDayLessons,
  selectedWeekModeForDate,
  vlsuWeekModeForDate,
  weekModeForDate,
  weekModeFromSnapshot
} from "./lib/time";

const WEEK_DAYS = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
const WEEK_DAYS_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const WEEK_DATE_FORMATTER = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
const REMINDER_OPTIONS = [5, 10, 15, 30];
const HERO_VISUAL_DARK = assetUrl("images/hero-obsidian-campus.jpg");
const HERO_VISUAL_LIGHT = assetUrl("images/hero-porcelain-campus.jpg");
const MIN_STUDY_WINDOW = 20;
const STARTUP_NETWORK_BUDGET_MS = 1_000;
const INITIAL_GROUP_LINK = parseGroupLink(window.location.search);
const INITIAL_GROUP = (INITIAL_GROUP_LINK ? readKnownGroup(INITIAL_GROUP_LINK.nrec, INITIAL_GROUP_LINK.instituteId) : null) ?? readSelectedGroup();
const CACHED_SCHEDULE = INITIAL_GROUP ? readGroupScheduleCache(INITIAL_GROUP) : null;
const INITIAL_SCHEDULE = CACHED_SCHEDULE ? normalizeCachedSchedule(CACHED_SCHEDULE) : null;
if (INITIAL_SCHEDULE && CACHED_SCHEDULE?.allLessons.some((lesson, index) => lesson.rawText !== INITIAL_SCHEDULE.allLessons[index]?.rawText)) {
  writeGroupScheduleCache(INITIAL_SCHEDULE);
}
const INITIAL_FALLBACK_GROUP = [...readRecentGroups(), ...readFavoriteGroups()]
  .find((group) => group.nrec !== INITIAL_GROUP?.nrec && normalizeCachedSchedule(readGroupScheduleCache(group))) ?? null;
const MOTION_PARTICLES = Array.from({ length: 8 }, (_, index) => index);
const TAB_ORDER: AppTab[] = ["today", "week", "notes", "settings"];
const SCREEN_SWIPE_BLOCK_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable='true']",
  "[data-screen-swipe='ignore']",
  ".note-swipe-shell",
  ".space-rail",
  ".rich-toolbar",
  ".rich-palette"
].join(",");
type NotesViewComponent = typeof import("./features/notes/NotesView")["NotesView"];
const LazySmartCalendarSheet = lazy(async () => ({ default: (await import("./features/notes/SmartCalendarSheet")).SmartCalendarSheet }));

let notesViewPromise: Promise<NotesViewComponent> | null = null;
const loadNotesView = () => {
  notesViewPromise ??= import("./features/notes/NotesView").then((module) => module.NotesView);
  return notesViewPromise;
};

interface ActiveScreenGesture {
  pointerId: number;
  startX: number;
  startY: number;
  viewportWidth: number;
  deltaX: number;
  deltaY: number;
  axis: "pending" | "horizontal" | "vertical";
  blocked: boolean;
}

function screenSwipeBlocked(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(SCREEN_SWIPE_BLOCK_SELECTOR));
}

function MotionScene() {
  return (
    <div className="motion-scene" aria-hidden="true">
      <span className="data-route data-route-a" />
      <span className="data-route data-route-b" />
      <span className="data-route data-route-c" />
      <span className="data-gate data-gate-a" />
      <span className="data-gate data-gate-b" />
      <div className="motion-particles">
        {MOTION_PARTICLES.map((particle) => <i key={particle} />)}
      </div>
    </div>
  );
}

import type { HeroMode } from "./lib/heroCopy";

function parseCurrentInfoLesson(text: string) {
  const match = text.match(/"(.+?)"\s*\((.+?)\)/);
  if (!match) return { subject: "Расписание загружено", room: "Группа" };
  return { subject: match[1], room: match[2] };
}

function formatLessonCount(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} пара`;
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return `${count} пары`;
  return `${count} пар`;
}

function formatVariantCount(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} вариант`;
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return `${count} варианта`;
  return `${count} вариантов`;
}

function formatNoteCount(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} запись`;
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return `${count} записи`;
  return `${count} записей`;
}

function formatWeekChip(mode: WeekMode) {
  // Коротко и одинаковой длины: длинные варианты всё равно обрезались
  // до «Зна...», отнимая место у названия группы.
  if (mode === "denominator") return "Знам.";
  if (mode === "numerator") return "Числ.";
  return "Все";
}

function formatDuration(minutes: number) {
  if (minutes <= 0) return "сейчас";
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const leftMinutes = minutes % 60;
  return leftMinutes ? `${hours} ч ${leftMinutes} мин` : `${hours} ч`;
}

function syncStatusText(status: ApiStatus, refreshedAt?: string) {
  const updatedAt = refreshedAt ? formatUpdatedAt(refreshedAt) : "";
  const updatedText = updatedAt ? `Обновлено ${updatedAt}` : "Кэш пуст";

  if (status === "loading") return "Подключение к ВлГУ";
  if (status === "refreshing") return refreshedAt ? `${updatedText} · синхронизация` : "Синхронизация";
  if (status === "updated") return "Расписание обновлено";
  if (status === "stale") return updatedAt ? `Офлайн · ${updatedAt}` : "ВлГУ не отвечает";
  if (status === "error-without-cache") return "Не удалось загрузить данные";

  return updatedText;
}

function formatScheduleDate(dateKey: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" })
    .format(new Date(`${dateKey}T12:00:00`));
}

function scheduleContentSignature(state: ScheduleState | null) {
  if (!state) return "";
  return JSON.stringify({
    groupNrec: state.groupNrec,
    currentInfo: state.currentInfo,
    allLessons: state.allLessons
  });
}

function initialAppTab(): AppTab {
  const requested = new URLSearchParams(window.location.search).get("tab");
  return requested === "week" || requested === "notes" || requested === "settings" ? requested : "today";
}

const LANDSCAPE_TAB_SCROLLER: Record<AppTab, string> = {
  today: ".today-detail-scroll",
  week: ".week-list",
  notes: ".notes-list",
  settings: ".settings-panels"
};

function tabScrollContainer(tab: AppTab, outer: HTMLElement | null) {
  if (!outer || !window.matchMedia("(orientation: landscape) and (max-height: 560px)").matches) return outer;
  return outer.querySelector<HTMLElement>(LANDSCAPE_TAB_SCROLLER[tab]) ?? outer;
}

export function App() {
  const [selectedGroup, setSelectedGroup] = useState<GroupProfile | null>(INITIAL_GROUP);
  const [schedule, setSchedule] = useState<ScheduleState | null>(INITIAL_SCHEDULE);
  const [status, setStatus] = useState<ApiStatus>(() => (INITIAL_SCHEDULE ? "hydrating-from-cache" : "loading"));
  const [activeTab, setActiveTab] = useState<AppTab>(initialAppTab);
  const [weekOverride, setWeekOverride] = useState<WeekMode | "current">("current");
  const [settings, setSettings] = useState<ReminderSettings>(() => readReminderSettings());
  const [notice, setNotice] = useState("");
  const noticeLockUntilRef = useRef(0);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [themeId, setThemeId] = useState<ThemeId>(() => readTheme());
  const [customTheme, setCustomTheme] = useState<CustomTheme>(() => readCustomTheme());
  const [themeSheetOpen, setThemeSheetOpen] = useState(false);
  const [groupPickerOpen, setGroupPickerOpen] = useState(() => !INITIAL_GROUP);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarCreateOnOpen, setCalendarCreateOnOpen] = useState(false);
  const [calendarRequestToken, setCalendarRequestToken] = useState(0);
  const [composerRequest, setComposerRequest] = useState<NoteComposerRequest | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  });
  const [dayMotionDirection, setDayMotionDirection] = useState<"forward" | "backward" | null>(null);
  const [NotesView, setNotesView] = useState<NotesViewComponent | null>(null);
  const [tabMotion, setTabMotion] = useState<{ id: number; direction: "forward" | "backward" }>({ id: 0, direction: "forward" });
  const contentScrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!tabMotion.id || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const view = contentScrollRef.current?.querySelector<HTMLElement>(".view-stack");
    const animation = view?.animate([
      { opacity: 0.86, transform: `translate3d(${tabMotion.direction === "forward" ? 16 : -16}px,0,0)` },
      { opacity: 1, transform: "translate3d(0,0,0)" }
    ], { duration: 360, easing: "cubic-bezier(.2,.8,.2,1)" });
    return () => animation?.cancel();
  }, [tabMotion]);
  const pendingTabRef = useRef<AppTab>(activeTab);
  const tabScrollPositionsRef = useRef<Record<AppTab, number>>({ today: 0, week: 0, notes: 0, settings: 0 });
  const scheduleRef = useRef<ScheduleState | null>(schedule);
  const selectedGroupRef = useRef<GroupProfile | null>(selectedGroup);
  const lastAvailableGroupRef = useRef<GroupProfile | null>(INITIAL_FALLBACK_GROUP);
  const refreshInFlightGroupRef = useRef<string | null>(null);
  const refreshSequenceRef = useRef(0);
  const pendingStaticRefreshRef = useRef<string | null>(null);
  const dataUpdateScrollRef = useRef<Array<{ element: HTMLElement; top: number; left: number }> | null>(null);
  useLayoutEffect(() => {
    const positions = dataUpdateScrollRef.current;
    dataUpdateScrollRef.current = null;
    positions?.forEach(({ element, top, left }) => {
      if (element.isConnected) element.scrollTo({ top, left, behavior: "instant" });
    });
  }, [schedule]);
  const screenGestureRef = useRef<ActiveScreenGesture | null>(null);
  const suppressGestureClickUntilRef = useRef(0);
  const groupLinkHandledRef = useRef(false);

  const nowDate = useMemo(() => new Date(nowTick), [nowTick]);
  const freshness = useMemo(() => scheduleNotice(schedule, nowTick), [schedule, nowTick]);
  const reportedWeek = schedule
    ? weekModeFromSnapshot(activeWeekMode(schedule.currentInfo.currentWeekType), schedule.weekTypeAsOf ?? schedule.fetchedAt, nowDate)
    : "numerator";
  const calendarWeek = vlsuWeekModeForDate(nowDate);
  const currentWeek = schedule?.allLessons.some((lesson) => lesson.scheduleKind === "exam") ? reportedWeek : calendarWeek;
  const weekMode = weekOverride === "current" ? currentWeek : weekOverride;
  const notificationCapability = useMemo(() => getNotificationCapability(settings), [settings]);
  const smartNotes = useSmartNotes(schedule?.allLessons ?? [], weekMode, selectedGroup);
  const openNotes = useMemo(() => smartNotes.notes.filter((note) => note.status === "open"), [smartNotes.notes]);
  const focusNote = useMemo(() => {
    return [...openNotes].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
      if (a.dueAt) return -1;
      if (b.dueAt) return 1;
      const aSavedAt = a.contentUpdatedAt ?? a.createdAt ?? a.updatedAt;
      const bSavedAt = b.contentUpdatedAt ?? b.createdAt ?? b.updatedAt;
      return bSavedAt.localeCompare(aSavedAt);
    })[0];
  }, [openNotes]);

  const selectedDateKey = dateKeyFromDate(selectedDate);
  const outsideSchedulePeriod = Boolean(schedule?.validFrom && schedule.validThrough
    && (selectedDateKey < schedule.validFrom || selectedDateKey > schedule.validThrough));
  const todayDateKey = dateKeyFromDate(nowDate);
  const isSelectedToday = selectedDateKey === todayDateKey;
  const isSelectedPast = selectedDateKey < todayDateKey;
  // A manually previewed week must not change the actual timetable of a selected calendar date.
  const selectedWeekMode = selectedWeekModeForDate(selectedDate, currentWeek, "current", nowDate);
  const { todayLessons, current, next } = useMemo(() => {
    const allLessons = schedule?.allLessons ?? [];
    const selectedLessons = selectDayLessons(allLessons, currentDayIndex(selectedDate), selectedWeekMode, selectedDate);
    if (isSelectedToday) return findCurrentAndNext(allLessons, selectedWeekMode, nowDate);
    return {
      todayLessons: selectedLessons,
      current: undefined,
      next: isSelectedPast ? undefined : selectedLessons[0]
    };
  }, [isSelectedPast, isSelectedToday, nowDate, schedule?.allLessons, selectedDate, selectedWeekMode]);

  const [lessonSelections, setLessonSelections] = useState(() => readLessonSelections(selectedGroup?.nrec, schedule?.currentInfo.semester));
  useEffect(() => {
    setLessonSelections(readLessonSelections(selectedGroup?.nrec, schedule?.currentInfo.semester));
  }, [selectedGroup?.nrec, schedule?.currentInfo.semester]);
  const getLessonChoice = useCallback((lesson: LessonSlot, mode: WeekMode) => {
    const oppositeMode = mode === "numerator" ? "denominator" : "numerator";
    const counterpart = schedule?.allLessons.find((candidate) =>
      candidate.weekMode === oppositeMode && candidate.dayIndex === lesson.dayIndex
      && candidate.pairIndex === lesson.pairIndex && candidate.start === lesson.start
      && candidate.date === lesson.date);
    return selectedLessonVariant(lesson, mode, lessonSelections, counterpart);
  }, [lessonSelections, schedule]);
  const chooseLesson = useCallback((lesson: LessonSlot, mode: WeekMode, choice: number | "all") => {
    setLessonSelections((currentSelections) => {
      const nextSelections = setLessonSelection(currentSelections, lesson, mode, choice);
      writeLessonSelections(selectedGroup?.nrec, schedule?.currentInfo.semester, nextSelections);
      return nextSelections;
    });
  }, [selectedGroup?.nrec, schedule?.currentInfo.semester]);

  const heroFallback = schedule ? parseCurrentInfoLesson(schedule.currentInfo.currentLesson) : null;
  const heroLesson = current ?? next;
  const heroChoice = heroLesson ? getLessonChoice(heroLesson, selectedWeekMode) : "all";
  const heroView = heroLesson ? lessonView(heroLesson, heroChoice, selectedWeekMode) : null;
  const heroChange = lessonChangeMessage(selectedGroup?.nrec, selectedDateKey, heroLesson, heroChoice);
  const dayCompleted = (isSelectedToday && !heroLesson && todayLessons.length > 0) || (isSelectedPast && todayLessons.length > 0);
  const freeStudyDay = Boolean(schedule) && !heroLesson && !todayLessons.length;
  const heroMode: HeroMode = current ? "current" : next ? "next" : dayCompleted ? "done" : freeStudyDay ? "free" : "loading";
  const heroSubject = heroView?.subject ?? (dayCompleted ? "Все пары пройдены" : freeStudyDay ? (isSelectedToday ? "Сегодня без пар" : "В этот день без пар") : heroFallback?.subject ?? "Загрузка расписания");
  const heroRoom = heroView
    ? (heroChange && heroChoice !== "all" ? "Дистант" : heroView.room ?? "Аудитория уточняется")
    : dayCompleted || freeStudyDay
      ? selectedGroup?.name ?? "Группа"
      : heroFallback?.room ?? selectedGroup?.instituteShortName ?? "ВлГУ";
  const heroStart = heroLesson?.start ?? todayLessons[0]?.start ?? "08:30";
  const heroEnd = heroLesson?.end ?? todayLessons[todayLessons.length - 1]?.end ?? "10:00";
  const heroTime = freeStudyDay ? "без пар" : `${heroStart}-${heroEnd}`;
  const completedCount = isSelectedPast
    ? todayLessons.length
    : isSelectedToday
      ? todayLessons.filter((lesson) => lessonTimingState(lesson, nowDate) === "past").length
      : 0;
  const progress = current ? lessonProgress(current, nowDate) : dayCompleted || freeStudyDay ? 100 : 0;
  const remaining = heroLesson && current ? minutesUntilEnd(heroLesson, nowDate) : 0;
  const nextStudyDay = schedule ? findNextStudyDay(schedule.allLessons, selectedWeekMode, selectedDate, nowDate) : null;
  const isSessionSchedule = Boolean(schedule?.allLessons.length && hasDatedLessons(schedule.allLessons));

  const refreshSchedule = useCallback(async (): Promise<void> => {
    const group = selectedGroupRef.current;
    if (!group) return;
    if (refreshInFlightGroupRef.current === group.nrec) return;
    refreshInFlightGroupRef.current = group.nrec;
    const requestSequence = ++refreshSequenceRef.current;
    const currentSchedule = scheduleRef.current;
    const hasCache = Boolean(currentSchedule);
    setStatus(hasCache ? "refreshing" : "loading");
    let settled = false;
    const startupBudget = window.setTimeout(() => {
      if (settled) return;
      if (requestSequence !== refreshSequenceRef.current || selectedGroupRef.current?.nrec !== group.nrec) return;
      if (hasCache) setStatus("stale");
    }, STARTUP_NETWORK_BUDGET_MS);

    try {
      const loaded = await loadSchedule(group, hasCache);
      if (requestSequence !== refreshSequenceRef.current || selectedGroupRef.current?.nrec !== group.nrec) return;
      const preferred = alignSubgroupOrder(preferNewerSchedule(currentSchedule, loaded), loaded);
      const changed = scheduleContentSignature(currentSchedule) !== scheduleContentSignature(preferred);
      if (hasCache && currentSchedule !== preferred) {
        dataUpdateScrollRef.current = [...document.querySelectorAll<HTMLElement>(
          ".content-scroll, .today-detail-scroll, .week-list, .notes-list, .settings-panels"
        )].map((element) => ({ element, top: element.scrollTop, left: element.scrollLeft }));
      }
      scheduleRef.current = preferred;
      if (preferred !== currentSchedule) writeGroupScheduleCache(preferred);
      setSchedule(preferred);
      setStatus(changed && hasCache ? "updated" : "ready");
    } catch {
      if (requestSequence !== refreshSequenceRef.current || selectedGroupRef.current?.nrec !== group.nrec) return;
      if (!currentSchedule) {
        setStatus("error-without-cache");
        return;
      }

      setStatus("stale");
    } finally {
      settled = true;
      window.clearTimeout(startupBudget);
      if (refreshInFlightGroupRef.current === group.nrec) refreshInFlightGroupRef.current = null;
      if (pendingStaticRefreshRef.current === group.nrec && selectedGroupRef.current?.nrec === group.nrec) {
        pendingStaticRefreshRef.current = null;
        window.setTimeout(() => void refreshSchedule(), 0);
      }
    }
  }, []);

  function selectGroup(group: GroupProfile) {
    if (selectedGroupRef.current?.nrec !== group.nrec && scheduleRef.current?.groupNrec === selectedGroupRef.current?.nrec) {
      lastAvailableGroupRef.current = selectedGroupRef.current;
    }
    const cached = readGroupScheduleCache(group);
    const normalizedCache = cached ? normalizeCachedSchedule(cached) : null;
    if (normalizedCache && cached?.allLessons.some((lesson, index) => lesson.rawText !== normalizedCache.allLessons[index]?.rawText)) {
      writeGroupScheduleCache(normalizedCache);
    }
    selectedGroupRef.current = group;
    pendingStaticRefreshRef.current = null;
    refreshSequenceRef.current += 1;
    scheduleRef.current = normalizedCache;
    writeSelectedGroup(group);
    syncGroupLink(group);
    setSelectedGroup(group);
    setSchedule(normalizedCache);
    setStatus(normalizedCache ? "hydrating-from-cache" : "loading");
    setWeekOverride("current");
    setGroupPickerOpen(false);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    setSelectedDate(today);
    window.setTimeout(() => void refreshSchedule(), 0);
  }

  function showNotice(message: string, lockMs = 0) {
    if (lockMs > 0) noticeLockUntilRef.current = Date.now() + lockMs;
    setNotice(message);
  }

  useEffect(() => {
    if (!selectedGroup) return;
    const timer = window.setTimeout(() => refreshSchedule(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshSchedule, selectedGroup]);

  useEffect(() => {
    document.title = selectedGroup ? `${selectedGroup.name} · Лад ВлГУ` : "Лад ВлГУ";
  }, [selectedGroup]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const handleDataUpdate = (event: MessageEvent) => {
      const group = selectedGroupRef.current;
      if (!group || !navigator.serviceWorker.controller || event.source !== navigator.serviceWorker.controller
        || !isSelectedScheduleUpdate(event.data, group.nrec)) return;
      resetUniversityBundleCache();
      if (refreshInFlightGroupRef.current === group.nrec) pendingStaticRefreshRef.current = group.nrec;
      else void refreshSchedule();
    };
    navigator.serviceWorker.addEventListener("message", handleDataUpdate);
    return () => navigator.serviceWorker.removeEventListener("message", handleDataUpdate);
  }, [refreshSchedule]);

  useEffect(() => {
    if (groupLinkHandledRef.current || !INITIAL_GROUP_LINK) return;
    groupLinkHandledRef.current = true;
    if (selectedGroupRef.current?.nrec === INITIAL_GROUP_LINK.nrec) return;
    let active = true;
    void resolveGroupLink(INITIAL_GROUP_LINK)
      .then((group) => {
        if (!active) return;
        if (group) selectGroup(group);
        else setGroupPickerOpen(true);
      })
      .catch(() => {
        if (active) setGroupPickerOpen(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const refreshIfNeeded = () => {
      const cached = scheduleRef.current;
      const fetchedAt = cached ? Date.parse(cached.fetchedAt) : 0;
      const cacheIsOld = !Number.isFinite(fetchedAt) || Date.now() - fetchedAt > 5 * 60_000;
      if (navigator.onLine && cacheIsOld) void refreshSchedule();
    };
    const handleVisible = () => {
      if (document.visibilityState === "visible") refreshIfNeeded();
    };

    window.addEventListener("online", refreshIfNeeded);
    document.addEventListener("visibilitychange", handleVisible);
    return () => {
      window.removeEventListener("online", refreshIfNeeded);
      document.removeEventListener("visibilitychange", handleVisible);
    };
  }, [refreshSchedule]);

  useEffect(() => {
    let cancelled = false;
    const preload = () => {
      void loadNotesView().then((Component) => {
        if (!cancelled) setNotesView(() => Component);
      });
    };
    if (activeTab === "notes") {
      preload();
      return () => {
        cancelled = true;
      };
    }
    const idleWindow = window as typeof window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(preload, { timeout: 1400 });
      return () => {
        cancelled = true;
        idleWindow.cancelIdleCallback?.(handle);
      };
    }
    const timer = window.setTimeout(preload, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // The initial tab is intentional; later navigation loads on demand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status !== "updated") return;
    const timer = window.setTimeout(() => setStatus("ready"), 2400);
    return () => window.clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!schedule) return;
    scheduleNextReminder(schedule.allLessons, weekMode, settings, (message) => {
      if (Date.now() < noticeLockUntilRef.current) return;
      setNotice(message);
    });
  }, [schedule, settings, weekMode]);

  async function enableReminders() {
    const capability = getNotificationCapability(settings);
    if (capability.status === "install-required" || capability.status === "unsupported" || capability.status === "denied") {
      showNotice(capability.detail, 3500);
      return;
    }

    const permission = await requestNotificationPermission();
    const nextSettings = {
      ...settings,
      enabled: permission === "granted",
      permission
    };
    setSettings(nextSettings);
    writeReminderSettings(nextSettings);
    showNotice(permission === "granted" ? "Напоминания включены. Проверь тестовой кнопкой." : "Браузер не дал доступ к уведомлениям.", 3500);
  }

  async function testNotification() {
    setNotificationBusy(true);
    try {
      let permission: ReminderSettings["permission"] = typeof Notification === "undefined" ? "unsupported" : Notification.permission;
      if (permission === "default") permission = await requestNotificationPermission();
      const nextSettings = { ...settings, enabled: permission === "granted", permission };
      setSettings(nextSettings);
      writeReminderSettings(nextSettings);

      const capability = getNotificationCapability(nextSettings);
      if (!capability.canSendNow) {
        showNotice(capability.detail, 3500);
        return;
      }

      await sendTestNotification();
      showNotice("Тестовое уведомление отправлено.", 3500);
    } catch {
      showNotice("Не удалось отправить тест. Проверь разрешения и режим PWA.", 3500);
    } finally {
      setNotificationBusy(false);
    }
  }

  function updateReminderMinutes(minutesBefore: number) {
    const nextSettings = { ...settings, minutesBefore };
    setSettings(nextSettings);
    writeReminderSettings(nextSettings);
  }

  function selectTheme(nextTheme: ThemeId) {
    setThemeId(nextTheme);
    applyTheme(nextTheme, customTheme);
    if (nextTheme !== "custom") window.setTimeout(() => setThemeSheetOpen(false), 180);
  }

  function updateCustomTheme(nextTheme: CustomTheme) {
    saveCustomTheme(nextTheme);
    setCustomTheme(nextTheme);
    setThemeId("custom");
    applyTheme("custom", nextTheme);
  }

  const navigateToTab = useCallback((nextTab: AppTab) => {
    pendingTabRef.current = nextTab;
    const container = contentScrollRef.current;
    const activeScroller = tabScrollContainer(activeTab, container);
    if (nextTab === activeTab) {
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      activeScroller?.scrollTo({ top: 0, behavior });
      tabScrollPositionsRef.current[nextTab] = 0;
      return;
    }
    if (activeScroller) tabScrollPositionsRef.current[activeTab] = activeScroller.scrollTop;
    const direction = TAB_ORDER.indexOf(nextTab) > TAB_ORDER.indexOf(activeTab) ? "forward" : "backward";
    const commitTab = () => {
      setTabMotion((current) => ({ id: current.id + 1, direction }));
      setActiveTab(nextTab);
    };
    if (nextTab === "notes" && !NotesView) {
      void loadNotesView().then((Component) => {
        setNotesView(() => Component);
        if (pendingTabRef.current === "notes") commitTab();
      });
      return;
    }
    commitTab();
  }, [NotesView, activeTab]);

  const shiftSelectedDay = useCallback((offset: -1 | 1) => {
    setDayMotionDirection(offset > 0 ? "forward" : "backward");
    setSelectedDate((date) => addDays(date, offset));
  }, []);

  const openLessonComposer = useCallback((lesson: LessonSlot, date: Date, intent: "note" | "homework") => {
    const group = selectedGroupRef.current;
    if (!group) return;
    const mode = selectedWeekModeForDate(date, currentWeek, "current", nowDate);
    const selectedLesson = lessonWithSelectedVariant(lesson, getLessonChoice(lesson, mode));
    setComposerRequest({
      id: Date.now(),
      lessonContext: createLessonNoteContext(selectedLesson, date, intent, "lesson", group)
    });
    navigateToTab("notes");
  }, [currentWeek, getLessonChoice, navigateToTab, nowDate]);

  const openComposerForDate = useCallback((date: Date) => {
    setComposerRequest({ id: Date.now(), dueAt: deadlineForCalendarDate(date) });
    navigateToTab("notes");
  }, [navigateToTab]);

  const showScheduleDate = useCallback((date: Date) => {
    const nextDate = new Date(date);
    nextDate.setHours(0, 0, 0, 0);
    setDayMotionDirection(nextDate.getTime() >= selectedDate.getTime() ? "forward" : "backward");
    setSelectedDate(nextDate);
    navigateToTab("today");
  }, [navigateToTab, selectedDate]);

  const resetScreenGesture = useCallback(() => {
    const view = contentScrollRef.current?.querySelector<HTMLElement>(".view-stack");
    if (view?.style.transform) {
      view.style.transition = "transform 220ms cubic-bezier(.2,.8,.2,1)";
      view.style.transform = "";
    }
  }, []);

  function beginScreenGesture(event: ReactPointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    screenGestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX - rect.left,
      startY: event.clientY,
      viewportWidth: rect.width,
      deltaX: 0,
      deltaY: 0,
      axis: "pending",
      blocked: screenSwipeBlocked(event.target)
    };
  }

  function moveScreenGesture(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = screenGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    gesture.deltaX = event.clientX - rect.left - gesture.startX;
    gesture.deltaY = event.clientY - gesture.startY;

    if (gesture.axis === "pending" && Math.max(Math.abs(gesture.deltaX), Math.abs(gesture.deltaY)) >= 9) {
      gesture.axis = Math.abs(gesture.deltaX) > Math.abs(gesture.deltaY) * 1.08 ? "horizontal" : "vertical";
    }
    if (gesture.axis === "horizontal" && !gesture.blocked) {
      if (event.cancelable) event.preventDefault();
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const view = event.currentTarget.querySelector<HTMLElement>(".view-stack");
      if (view) {
        view.style.transition = "none";
        const distance = Math.sign(gesture.deltaX) * Math.min(28, Math.abs(gesture.deltaX) * .16);
        view.style.transform = `translate3d(${distance}px,0,0)`;
      }
    } else if (gesture.axis === "vertical") {
      resetScreenGesture();
    }
  }

  function finishScreenGesture(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = screenGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    screenGestureRef.current = null;
    resetScreenGesture();
    if (gesture.axis !== "horizontal" || gesture.blocked) return;

    if (Math.abs(gesture.deltaX) > 18) suppressGestureClickUntilRef.current = performance.now() + 320;
    const action = resolveScreenSwipe({
      activeTab,
      startX: gesture.startX,
      viewportWidth: gesture.viewportWidth,
      deltaX: gesture.deltaX,
      deltaY: gesture.deltaY
    });
    if (action?.kind === "tab") navigateToTab(action.tab);
    if (action?.kind === "day") shiftSelectedDay(action.offset);
  }

  function cancelScreenGesture() {
    screenGestureRef.current = null;
    resetScreenGesture();
  }

  function suppressClickAfterGesture(event: ReactMouseEvent<HTMLDivElement>) {
    if (performance.now() >= suppressGestureClickUntilRef.current) return;
    event.preventDefault();
    event.stopPropagation();
  }

  useLayoutEffect(() => {
    const container = contentScrollRef.current;
    const activeScroller = tabScrollContainer(activeTab, container);
    if (activeScroller) activeScroller.scrollTop = tabScrollPositionsRef.current[activeTab];
  }, [activeTab]);

  const nextLabel = isSelectedToday ? "Сегодня новых пар нет" : "В этот день новых пар нет";
  const displayLessons = todayLessons;
  const isLoading = status === "loading" && !schedule;
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const prepare = () => {
      if (!navigator.serviceWorker.controller || timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (navigator.onLine) void warmUniversityScheduleBundle().catch(() => undefined);
      }, 3000);
    };
    prepare();
    navigator.serviceWorker.addEventListener("controllerchange", prepare);
    window.addEventListener("online", prepare);
    return () => {
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener("controllerchange", prepare);
      window.removeEventListener("online", prepare);
    };
  }, []);
  const isScheduleUnavailable = status === "error-without-cache" && !schedule;
  const hasLoadedLessons = Boolean(schedule?.allLessons.length);
  const lightHero = themeId === "custom"
    ? customTheme.mode === "light"
    : Boolean(THEMES.find((theme) => theme.id === themeId)?.isLight);

  return (
    <main className="app-shell">
      <section className="phone-frame" aria-label={`${selectedGroup?.name ?? "ВлГУ"} расписание`}>
        <div className="ambient-grid" />
        <div className="light-sweep" />
        <MotionScene />
        <Header
          group={selectedGroup}
          currentWeek={currentWeek}
          isSessionSchedule={isSessionSchedule}
          status={status}
          refreshedAt={schedule?.fetchedAt}
          onRefresh={() => refreshSchedule()}
          onThemeOpen={() => setThemeSheetOpen(true)}
          onGroupOpen={() => setGroupPickerOpen(true)}
        />

        <div
          className="content-scroll"
          ref={contentScrollRef}
          data-active-tab={activeTab}
          onPointerDownCapture={beginScreenGesture}
          onPointerMoveCapture={moveScreenGesture}
          onPointerUpCapture={finishScreenGesture}
          onPointerCancelCapture={cancelScreenGesture}
          onClickCapture={suppressClickAfterGesture}
        >
          {freshness?.warn && (activeTab === "today" || activeTab === "week") && (
            <p className={`freshness-banner level-${freshness.level}`} role="status">
              <TriangleAlert size={14} aria-hidden="true" />
              <span>
                <strong>{freshness.title}</strong>
                {freshness.detail && <small>{freshness.detail}</small>}
              </span>
            </p>
          )}

          {isLoading && (activeTab === "today" || activeTab === "week") && <SkeletonView />}

          {isScheduleUnavailable && (activeTab === "today" || activeTab === "week") && (
            <ScheduleUnavailableView groupNrec={selectedGroup?.nrec} selectedDateKey={selectedDateKey} onRetry={() => refreshSchedule()} onGroupOpen={() => setGroupPickerOpen(true)} onRestore={lastAvailableGroupRef.current ? () => selectGroup(lastAvailableGroupRef.current!) : undefined} />
          )}

          {!isLoading && !isScheduleUnavailable && activeTab === "today" && (
            <TodayView
              getLessonChoice={getLessonChoice}
              onChooseLesson={chooseLesson}
              heroSubject={heroSubject}
              heroVisual={lightHero ? HERO_VISUAL_LIGHT : HERO_VISUAL_DARK}
              lightHero={lightHero}
              heroRoom={heroRoom}
              heroTime={heroTime}
              heroChange={heroChange}
              heroMode={heroMode}
              progress={progress}
              remaining={remaining}
              completedCount={completedCount}
              dayCompleted={dayCompleted}
              hasLoadedLessons={hasLoadedLessons}
              current={current}
              next={next}
              nextStudyDay={nextStudyDay}
              nextLabel={nextLabel}
              lessons={displayLessons}
              weekMode={selectedWeekMode}
              selectedDate={selectedDate}
              isSelectedToday={isSelectedToday}
              isSelectedPast={isSelectedPast}
              now={nowDate}
              notes={openNotes}
              groupNrec={selectedGroup?.nrec}
              focusNote={focusNote}
              onToggleNote={smartNotes.toggleNote}
              onOpenNotes={() => navigateToTab("notes")}
              onOpenCalendar={() => { setCalendarCreateOnOpen(false); setCalendarOpen(true); }}
              onAddEvent={() => { setCalendarCreateOnOpen(true); setCalendarOpen(true); }}
              onSelectDate={setSelectedDate}
              onShiftDate={shiftSelectedDay}
              motionDirection={dayMotionDirection}
              onCreateLessonNote={openLessonComposer}
              outsideSchedulePeriod={outsideSchedulePeriod}
              scheduleValidFrom={schedule?.validFrom}
              scheduleValidThrough={schedule?.validThrough}
              schedulePeriodEstimated={schedule?.periodEstimated}
            />
          )}

          {!isLoading && !isScheduleUnavailable && activeTab === "week" && (
            <WeekView
              getLessonChoice={getLessonChoice}
              onChooseLesson={chooseLesson}
              lessons={schedule?.allLessons ?? []}
              weekMode={weekMode}
              weekOverride={weekOverride}
              setWeekOverride={setWeekOverride}
              notes={openNotes}
              groupNrec={selectedGroup?.nrec}
              onToggleNote={smartNotes.toggleNote}
              onOpenCalendar={() => { setCalendarCreateOnOpen(false); setCalendarOpen(true); }}
              onSelectDate={showScheduleDate}
              onCreateLessonNote={openLessonComposer}
              validFrom={schedule?.validFrom}
              validThrough={schedule?.validThrough}
            />
          )}

          {activeTab === "notes" && (
            NotesView ? (
              <NotesView
                visualSrc={lightHero ? HERO_VISUAL_LIGHT : HERO_VISUAL_DARK}
                notes={smartNotes.notes}
                folders={smartNotes.folders}
                lessons={schedule?.allLessons ?? []}
                ready={smartNotes.ready}
                storageStatus={smartNotes.storageStatus}
                onRetryStorage={smartNotes.retryStorage}
                weekMode={currentWeek}
                calendarRequestToken={calendarRequestToken}
                composerRequest={composerRequest}
                classifyDraft={smartNotes.classifyDraft}
                onCreate={smartNotes.createNote}
                onCreateFolder={smartNotes.createFolder}
                onDelete={smartNotes.deleteNote}
                onDeleteFolder={smartNotes.deleteFolder}
                onReorder={smartNotes.reorderNotes}
                onToggle={smartNotes.toggleNote}
                onTogglePinned={smartNotes.togglePinned}
                onUpdate={smartNotes.updateNote}
                onCalendarRequestHandled={() => setCalendarRequestToken(0)}
                onComposerRequestHandled={() => setComposerRequest(null)}
                onOpenSettings={() => navigateToTab("settings")}
              />
            ) : <section className="notes-loading" aria-label="Открываем записи"><span /><span /><span /></section>
          )}

          {activeTab === "settings" && (
            <SettingsView
              settings={settings}
              notice={notice}
              capability={notificationCapability}
              busy={notificationBusy}
              onEnable={enableReminders}
              onTest={testNotification}
              onMinutes={updateReminderMinutes}
              schedule={schedule}
              themeId={themeId}
              customThemeName={customTheme.name}
              onThemeOpen={() => setThemeSheetOpen(true)}
              notes={smartNotes.notes}
              onImportNotes={smartNotes.importNotes}
              folders={smartNotes.folders}
            />
          )}
        </div>

        <BottomNav activeTab={activeTab} onTabChange={navigateToTab} />
        {calendarOpen && (
          <Suspense fallback={null}>
            <LazySmartCalendarSheet
              lessons={schedule?.allLessons ?? []}
              notes={smartNotes.notes}
              open={calendarOpen}
              initialCreateEvent={calendarCreateOnOpen}
              weekMode={currentWeek}
              initialDate={selectedDate}
              onClose={() => { setCalendarOpen(false); setCalendarCreateOnOpen(false); }}
              onCreateForDate={openComposerForDate}
              onOpenNote={() => navigateToTab("notes")}
              onSelectDate={showScheduleDate}
            />
          </Suspense>
        )}
        <ThemeSheet
          currentTheme={themeId}
          customTheme={customTheme}
          open={themeSheetOpen}
          onClose={() => setThemeSheetOpen(false)}
          onCustomChange={updateCustomTheme}
          onSelect={selectTheme}
        />
        <GroupPickerSheet
          open={groupPickerOpen}
          selectedGroup={selectedGroup}
          onClose={() => selectedGroup && setGroupPickerOpen(false)}
          onSelect={selectGroup}
        />
      </section>
    </main>
  );
}

interface HeaderProps {
  group: GroupProfile | null;
  currentWeek: WeekMode;
  isSessionSchedule: boolean;
  status: ApiStatus;
  refreshedAt?: string;
  onRefresh: () => void;
  onThemeOpen: () => void;
  onGroupOpen: () => void;
}

function Header({ group, currentWeek, isSessionSchedule, status, refreshedAt, onRefresh, onThemeOpen, onGroupOpen }: HeaderProps) {
  const isBusy = status === "loading" || status === "refreshing";
  const connectionState = status === "stale" || status === "error-without-cache" ? "offline" : isBusy ? "syncing" : "ready";
  const badge = groupBadgeParts(group?.name ?? "ВлГУ");

  return (
    <header className="topbar" data-sync-status={status}>
      <button className="brand brand-button" type="button" onClick={onGroupOpen} aria-label={group ? `Сменить группу. Сейчас ${group.name}` : "Выбрать группу"}>
        <span className="brand-mark group-brand-mark" data-visual={group?.visualKey ?? "institute-0"} aria-hidden="true">
          <strong>{badge.prefix}</strong>
          {badge.suffix && <small>{badge.suffix}</small>}
        </span>
        <div>
          <h1>{group?.name ?? "Выберите группу"}</h1>
          <p>{group?.instituteShortName ?? "ВлГУ"}</p>
        </div>
        <ChevronDown className="brand-chevron" size={17} />
      </button>

      <div className="header-actions">
        <button className="week-chip" type="button" onClick={onRefresh} aria-label="Обновить расписание">
          {/* Иконка календаря убрана: рядом стоит само слово «Числ.»/«Знам.»,
              а место в шапке нужнее названию группы. */}
          <span>{isSessionSchedule ? "Сессия" : formatWeekChip(currentWeek)}</span>
          <i className={`week-chip-health ${connectionState}`} title={syncStatusText(status, refreshedAt)} aria-hidden="true" />
          <RefreshCw className={isBusy ? "spin" : ""} size={16} />
        </button>
        <button className="header-icon-button" type="button" onClick={onThemeOpen} aria-label="Сменить тему" title="Сменить тему" data-testid="open-theme-picker">
          <Palette size={20} />
        </button>
      </div>

      <div className="sync-line">
        <span>{group?.instituteName ?? "Владимирский государственный университет"}</span>
        <span
          className={`sync-status sync-status-${status}`}
          aria-live="polite"
          title={status === "stale" ? "ВлГУ временно не отвечает. Показано последнее сохранённое расписание." : undefined}
        >
          {syncStatusText(status, refreshedAt)}
        </span>
      </div>
    </header>
  );
}

type LessonChoiceResolver = (lesson: LessonSlot, mode: WeekMode) => SubgroupChoice;
type LessonChoiceSetter = (lesson: LessonSlot, mode: WeekMode, choice: number | "all") => void;

function TodayView({
  getLessonChoice,
  onChooseLesson,
  heroSubject,
  heroVisual,
  lightHero,
  heroRoom,
  heroTime,
  heroChange,
  heroMode,
  progress,
  remaining,
  completedCount,
  dayCompleted,
  hasLoadedLessons,
  current,
  next,
  nextStudyDay,
  nextLabel,
  lessons,
  weekMode,
  selectedDate,
  isSelectedToday,
  isSelectedPast,
  now,
  notes,
  groupNrec,
  focusNote,
  onToggleNote,
  onOpenNotes,
  onOpenCalendar,
  onAddEvent,
  onSelectDate,
  onShiftDate,
  motionDirection,
  onCreateLessonNote,
  outsideSchedulePeriod,
  scheduleValidFrom,
  scheduleValidThrough,
  schedulePeriodEstimated
}: {
  getLessonChoice: LessonChoiceResolver;
  onChooseLesson: LessonChoiceSetter;
  heroSubject: string;
  heroVisual: string;
  lightHero: boolean;
  heroRoom: string;
  heroTime: string;
  heroChange: string | null;
  heroMode: HeroMode;
  progress: number;
  remaining: number;
  completedCount: number;
  dayCompleted: boolean;
  hasLoadedLessons: boolean;
  current?: LessonSlot;
  next?: LessonSlot;
  nextStudyDay: NextStudyDay | null;
  nextLabel: string;
  lessons: LessonSlot[];
  weekMode: WeekMode;
  selectedDate: Date;
  isSelectedToday: boolean;
  isSelectedPast: boolean;
  now: Date;
  notes: SmartNote[];
  groupNrec?: string;
  focusNote?: SmartNote;
  onToggleNote: (noteId: string) => void;
  onOpenNotes: () => void;
  onOpenCalendar: () => void;
  onAddEvent: () => void;
  onSelectDate: (date: Date) => void;
  onShiftDate: (offset: -1 | 1) => void;
  motionDirection: "forward" | "backward" | null;
  onCreateLessonNote: (lesson: LessonSlot, date: Date, intent: "note" | "homework") => void;
  outsideSchedulePeriod: boolean;
  scheduleValidFrom?: string;
  scheduleValidThrough?: string;
  schedulePeriodEstimated?: boolean;
}) {
  const titleClass = heroSubject.length > 44 ? "dense-title" : heroSubject.length > 30 ? "compact-title" : "";
  const personalEvents = usePersonalEvents();
  const selectedPersonalEvents = personalEventsOnDate(personalEvents, selectedDate);
  const minutesToNext = next && isSelectedToday ? minutesUntilStart(next, now) : 0;
  const nextView = next ? lessonView(next, getLessonChoice(next, weekMode), weekMode) : null;
  const upcomingWeekMode = nextStudyDay ? weekModeForDate(nextStudyDay.date, weekMode, selectedDate) : weekMode;
  const hero = heroCopy({
    mode: heroMode,
    isSelectedToday,
    lessonProgress: progress,
    minutesToNext,
    minutesRemaining: remaining,
    nextStart: next?.start,
    completedCount,
    lessonCount: lessons.length,
    nextStudyDayLabel: nextStudyDay ? `${nextStudyDay.dayName}, ${nextStudyDay.firstLesson.start}` : undefined,
    hasLoadedLessons,
    formatDuration
  });
  const calendarDay = selectedDate.getDate();
  const calendarMonth = new Intl.DateTimeFormat("ru-RU", { month: "short" }).format(selectedDate).replace(".", "");
  const calendarLabel = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(selectedDate);
  const dateEyebrow = relativeDayLabel(selectedDate, now);
  const dateCopyRef = useRef<HTMLSpanElement>(null);
  const dateKey = dateKeyFromDate(selectedDate);

  useLayoutEffect(() => {
    if (!motionDirection || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = dateCopyRef.current?.animate([
      { opacity: .6 },
      { opacity: 1 }
    ], { duration: 220, easing: "ease-out" });
    return () => animation?.cancel();
  }, [dateKey, motionDirection]);

  function moveDay(offset: number) {
    onShiftDate(offset > 0 ? 1 : -1);
  }

  return (
    <div className="view-stack today-view">
      <div className="today-primary">
        <div className="today-date-navigator">
          <button className="date-step" type="button" onClick={() => moveDay(-1)} aria-label="Предыдущий день"><ChevronLeft size={21} /></button>
          <button
            className="today-date-launch"
            type="button"
            onClick={onOpenCalendar}
            aria-label={`Открыть календарь: ${calendarLabel}`}
            data-testid="today-calendar-launch"
          >
            <span className="today-date-tile" aria-hidden="true">
              <small>{calendarMonth}</small>
              <strong>{calendarDay}</strong>
            </span>
            <span className="today-date-copy" ref={dateCopyRef}>
              <small><CalendarDays size={14} /> {dateEyebrow}</small>
              <strong>{calendarLabel}</strong>
            </span>
          </button>
          <button className="date-step" type="button" onClick={() => moveDay(1)} aria-label="Следующий день"><ChevronRight size={21} /></button>
        </div>

        {selectedPersonalEvents.length > 0 && <section className="personal-day-events" aria-label="Личные события">
          {selectedPersonalEvents.map((event) => <button type="button" key={event.id} onClick={onOpenCalendar}>
            <CalendarDays size={18} /><span><strong>{event.title}</strong><small>{new Date(event.start).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}–{new Date(event.end).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}{event.location ? ` · ${event.location}` : ""}</small></span><ChevronRight size={18} />
          </button>)}
        </section>}
        {outsideSchedulePeriod ? (
          <section className="schedule-period-empty" role="status">
            <CalendarDays size={27} aria-hidden="true" />
            <h2>На эту дату расписание не подтверждено</h2>
            <p>{schedulePeriodEstimated
              ? "Есть только расписание этого семестра. Для выбранной даты пары пока не подтверждены."
              : `Расписание действует с ${scheduleValidFrom ? formatScheduleDate(scheduleValidFrom) : "начала семестра"} по ${scheduleValidThrough ? formatScheduleDate(scheduleValidThrough) : "конец семестра"}. Выбери дату в его пределах или другую группу.`}</p>
            <button type="button" onClick={onOpenCalendar}>Выбрать дату <ChevronRight size={17} /></button>
          </section>
        ) : <section className={`hero-card mode-${heroMode} ${titleClass} ${dayCompleted ? "completed-day" : ""} ${lightHero ? "light-hero" : ""}`}>
          <img className="hero-visual hero-visual-backdrop" src={heroVisual} alt="" aria-hidden="true" />
          <img className="hero-visual hero-visual-fit" src={heroVisual} alt="" aria-hidden="true" />
          <div className="hero-sigil" aria-hidden="true">
            <span>{hero.sigilLabel}</span>
            <strong>{hero.sigilValue}</strong>
          </div>
          {hero.status && (
            <div className="status-pill">
              <span className={hero.status.live ? "live-dot" : "idle-dot"} />
              {hero.status.copy}
            </div>
          )}
          <h2>{heroSubject}</h2>
          <div className="hero-meta">
            <span>{heroChange && current && getLessonChoice(current, weekMode) !== "all" ? <Video size={21} /> : <MapPin size={21} />} {heroRoom}</span>
            <span><Clock3 size={21} /> {heroTime}</span>
          </div>
          {heroChange && <p className="lesson-change hero-change">{heroChange}</p>}

          {hero.showProgressRow && (
            <div className="progress-row" aria-label="Прогресс пары">
              <div className="progress-track">
                <span style={{ width: `${progress}%` }} />
              </div>
              <div className="progress-copy">
                <strong>{hero.progressTitle}</strong>
              </div>
            </div>
          )}
        </section>}
      </div>

      <div className="today-detail-scroll">
        <button className="today-add-event" type="button" onClick={onAddEvent}>
          <CalendarPlus size={20} aria-hidden="true" />
          <span>Добавить событие</span>
          <ChevronRight size={19} aria-hidden="true" />
        </button>
        {!outsideSchedulePeriod && (!lessons.length || (dayCompleted && isSelectedToday)) && nextStudyDay && hasLoadedLessons && (
          <section className="upcoming-study" aria-label="Следующий учебный день">
            <button className="upcoming-day-launch" type="button" onClick={() => onSelectDate(nextStudyDay.date)}>
              <span>
                <small>Следующий учебный день</small>
                <strong>{new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(nextStudyDay.date)}</strong>
              </span>
              <ChevronRight size={20} aria-hidden="true" />
            </button>
            <div className="upcoming-lessons">
              {nextStudyDay.lessons.slice(0, 3).map((lesson) => {
                const view = lessonView(lesson, getLessonChoice(lesson, upcomingWeekMode), upcomingWeekMode);
                return <div className="upcoming-lesson" key={lesson.id}>
                  <time>{lesson.start}</time>
                  <span><strong>{view.subject}</strong>{view.room && <small>{view.room}</small>}</span>
                </div>;
              })}
            </div>
          </section>
        )}
        {focusNote && (
          <button className="focus-note-card" type="button" onClick={onOpenNotes}>
            <span className="focus-note-icon"><BookCheck size={22} /></span>
            <span>
              <small>{focusNote.subjectLabel ? "К ближайшей паре" : focusNote.topic ?? focusNote.space}</small>
              <strong>{focusNote.title}</strong>
              <i>{[focusNote.subjectLabel, focusNote.dueLabel].filter(Boolean).join(" · ") || "Открыть запись"}</i>
            </span>
            <ChevronRight size={20} />
          </button>
        )}

        {current && (
          <section className="next-card">
            <div className="next-icon"><Waves size={28} /></div>
            <div>
              <span>Следующая пара</span>
              <strong>{nextView?.subject ?? nextLabel}</strong>
              {next && <small><Clock3 size={14} /> {next.start}–{next.end}</small>}
              {nextView?.room && <small><MapPin size={14} /> {nextView.room}</small>}
            </div>
          </section>
        )}

        {!outsideSchedulePeriod && <Timeline
          lessons={lessons}
          current={current}
          next={next}
          now={now}
          selectedDate={selectedDate}
          isSelectedToday={isSelectedToday}
          isSelectedPast={isSelectedPast}
          notes={notes}
          groupNrec={groupNrec}
          onToggleNote={onToggleNote}
          onCreateLessonNote={onCreateLessonNote}
          getLessonChoice={getLessonChoice}
          onChooseLesson={onChooseLesson}
          selectedWeekMode={weekMode}
        />}
      </div>
    </div>
  );
}

function Timeline({
  lessons,
  current,
  next,
  now,
  selectedDate,
  isSelectedToday,
  isSelectedPast,
  notes,
  groupNrec,
  onToggleNote,
  onCreateLessonNote,
  getLessonChoice,
  onChooseLesson,
  selectedWeekMode
}: {
  lessons: LessonSlot[];
  current?: LessonSlot;
  next?: LessonSlot;
  now: Date;
  selectedDate: Date;
  isSelectedToday: boolean;
  isSelectedPast: boolean;
  notes: SmartNote[];
  groupNrec?: string;
  onToggleNote: (noteId: string) => void;
  onCreateLessonNote: (lesson: LessonSlot, date: Date, intent: "note" | "homework") => void;
  getLessonChoice: LessonChoiceResolver;
  onChooseLesson: LessonChoiceSetter;
  selectedWeekMode: WeekMode;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!lessons.length) return null;

  const completedCount = isSelectedPast
    ? lessons.length
    : isSelectedToday
      ? lessons.filter((lesson) => lessonTimingState(lesson, now) === "past").length
      : 0;
  const timelineLabel = isSelectedToday
    ? "Сегодня"
    : new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(selectedDate).replace(".", "");

  return (
    <section className="timeline-card">
      <div className="timeline-summary">
        <div>
          <span>{timelineLabel}</span>
          <strong>{isSelectedToday || isSelectedPast ? `${completedCount}/${lessons.length} пройдено` : `Занятий: ${lessons.length}`}</strong>
        </div>
        <p>{lessons[0].start}–{lessons[lessons.length - 1].end}</p>
      </div>
      {lessons.map((lesson, index) => {
        // Перерыв рисуется там, где он и происходит — между парами. Раньше окна
        // были сведены в отдельную строку наверху, и день не читался как форма:
        // непонятно, где он плотный, а где можно выдохнуть.
        const previous = lessons[index - 1];
        const gapMinutes = previous
          ? minutesFromTime(lesson.start) - minutesFromTime(previous.end)
          : 0;
        const showGap = gapMinutes >= MIN_STUDY_WINDOW;

        return (
        <Fragment key={lesson.id}>
        {showGap && (
          <p className="timeline-gap" aria-label={`Перерыв ${formatDuration(gapMinutes)}`}>
            <span>{formatDuration(gapMinutes)}</span>
          </p>
        )}
        <LessonRow
          key={lesson.id}
          lesson={lesson}
          isCurrent={lesson.id === current?.id}
          isNext={lesson.id === next?.id}
          isPast={isSelectedPast || (isSelectedToday && lessonTimingState(lesson, now) === "past")}
          isExpanded={expandedId === lesson.id}
          onToggle={() => setExpandedId((value) => (value === lesson.id ? null : lesson.id))}
          linkedNotes={notesLinkedToLesson(lessonWithSelectedVariant(lesson, getLessonChoice(lesson, selectedWeekMode)), notes, selectedDate, groupNrec)}
          onToggleNote={onToggleNote}
          onCreateNote={(intent) => onCreateLessonNote(lesson, selectedDate, intent)}
          choice={getLessonChoice(lesson, selectedWeekMode)}
          onChoose={(choice) => onChooseLesson(lesson, selectedWeekMode, choice)}
          weekMode={selectedWeekMode}
          groupNrec={groupNrec}
          dateKey={dateKeyFromDate(selectedDate)}
          index={index}
        />
        </Fragment>
        );
      })}
    </section>
  );
}

function LessonRow({
  lesson,
  isCurrent,
  isNext,
  isPast,
  isExpanded,
  onToggle,
  linkedNotes,
  onToggleNote,
  onCreateNote,
  choice,
  onChoose,
  weekMode,
  groupNrec,
  dateKey,
  index
}: {
  lesson: LessonSlot;
  isCurrent?: boolean;
  isNext?: boolean;
  isPast?: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  linkedNotes: SmartNote[];
  onToggleNote: (noteId: string) => void;
  onCreateNote: (intent: "note" | "homework") => void;
  choice: SubgroupChoice;
  onChoose: (choice: number | "all") => void;
  weekMode: WeekMode;
  groupNrec?: string;
  dateKey: string;
  index: number;
}) {
  const rowRef = useRef<HTMLElement>(null);
  const view = lessonView(lesson, choice, weekMode);
  const change = lessonChangeMessage(groupNrec, dateKey, lesson, choice);

  function handleToggle() {
    const willExpand = !isExpanded;
    onToggle();
    if (!willExpand) return;

    window.setTimeout(() => {
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      rowRef.current?.scrollIntoView({ block: "center", behavior });
    }, 70);
  }

  return (
    <article
      ref={rowRef}
      className={`lesson-row ${isCurrent ? "current" : ""} ${isNext ? "next" : ""} ${isPast ? "past" : ""} ${isExpanded ? "expanded" : ""}`}
      style={{ animationDelay: `${index * 55}ms` }}
    >
      <button type="button" className="lesson-row-button" onClick={handleToggle} aria-expanded={isExpanded}>
        <span className="lesson-time">
          <strong>{lesson.start}</strong>
          <span>{lesson.end}</span>
        </span>
        <span className="route-dot" aria-hidden="true" />
        <span className="lesson-title">{view.subject}</span>
        {change && <span className="lesson-change lesson-row-change">{change}</span>}
        <span className="lesson-place">
          {change && choice !== "all" ? <Video size={16} /> : <MapPin size={16} />}
          {change && choice !== "all" ? "Дистант" : view.room || "Аудитория уточняется"}
          {view.kind ? <span>{view.kind}</span> : null}
          {(lesson.variants?.length ?? 0) > 1 && <span className="lesson-choice-hint">{formatVariantCount(lesson.variants?.length ?? 0)} · выбрать</span>}
        </span>
        <span className="row-end" aria-hidden="true">
          {isCurrent && <span className="row-chip">Сейчас</span>}
          {linkedNotes.length > 0 && <span className="lesson-note-count"><BookCheck size={14} /> {linkedNotes.length}</span>}
          {!isCurrent && linkedNotes.length === 0 && <ChevronRight className="row-chevron" size={20} />}
        </span>
      </button>
      {isExpanded && (
        <div className="lesson-detail">
          <span>{formatWeekMode(weekMode)}</span>
          {lesson.variants && lesson.variants.length > 1 ? (
            <LessonVariantPicker lesson={lesson} choice={choice} onChoose={onChoose} />
          ) : view.teacher ? <span>{view.teacher}</span> : null}
          <div className="lesson-note-actions" aria-label="Добавить к паре">
            <button type="button" onClick={() => onCreateNote("note")}><NotebookPen size={16} /> Записка</button>
            <button type="button" onClick={() => onCreateNote("homework")}><BookCheck size={16} /> ДЗ</button>
          </div>
          {linkedNotes.length > 0 && (
            <div className="lesson-linked-notes">
              <strong><BookCheck size={15} /> Связано с предметом</strong>
              {linkedNotes.map((note) => (
                <button key={note.id} type="button" onClick={() => onToggleNote(note.id)}>
                  <span className="linked-note-check"><CheckCircle2 size={15} /></span>
                  <span>{note.title}</span>
                  {note.dueLabel && <small>{note.dueLabel}</small>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function LessonVariantPicker({ lesson, choice, onChoose }: {
  lesson: LessonSlot;
  choice: SubgroupChoice;
  onChoose: (choice: number | "all") => void;
}) {
  if (!lesson.variants || lesson.variants.length < 2) return null;
  return (
    <div className="lesson-variants" role="group" aria-label="Выбрать свою пару">
      <strong className="lesson-variants-label">Какая у тебя пара?</strong>
      {lesson.variants.map((variant, index) => (
        <button
          className={`lesson-variant ${choice === index ? "chosen" : ""}`}
          key={`${variant.rawText}-${index}`}
          type="button"
          aria-pressed={choice === index}
          onClick={() => onChoose(index)}
        >
          <strong>{variant.subject}</strong>
          <span>{[variant.room, variant.kind, variant.teacher].filter(Boolean).join(" · ")}</span>
        </button>
      ))}
      <button className="lesson-variants-all" type="button" aria-pressed={choice === "all"} onClick={() => onChoose("all")}>Показать все варианты</button>
    </div>
  );
}

interface WeekDayLoad {
  count: number;
  date: Date;
  dayName: string;
  lessons: LessonSlot[];
  outsidePeriod: boolean;
  short: string;
}

function buildWeekLoads(lessons: LessonSlot[], weekMode: WeekMode, validFrom?: string, validThrough?: string): WeekDayLoad[] {
  const weekStart = weekStartForMode(weekMode);
  return WEEK_DAYS.map((dayName, index) => {
    const date = dateForWeekDay(index + 1, weekStart);
    const dateKey = dateKeyFromDate(date);
    const dayLessons = selectDayLessons(lessons, index + 1, weekMode, date);
    return {
      count: dayLessons.length,
      date,
      dayName,
      lessons: dayLessons,
      outsidePeriod: Boolean(validFrom && validThrough && (dateKey < validFrom || dateKey > validThrough)),
      short: WEEK_DAYS_SHORT[index]
    };
  });
}

function WeekView({
  getLessonChoice,
  onChooseLesson,
  lessons,
  weekMode,
  weekOverride,
  setWeekOverride,
  validFrom,
  validThrough,
  notes,
  groupNrec,
  onToggleNote,
  onOpenCalendar,
  onSelectDate,
  onCreateLessonNote
}: {
  getLessonChoice: LessonChoiceResolver;
  onChooseLesson: LessonChoiceSetter;
  lessons: LessonSlot[];
  weekMode: WeekMode;
  weekOverride: WeekMode | "current";
  setWeekOverride: (mode: WeekMode | "current") => void;
  validFrom?: string;
  validThrough?: string;
  notes: SmartNote[];
  groupNrec?: string;
  onToggleNote: (noteId: string) => void;
  onOpenCalendar: () => void;
  onSelectDate: (date: Date) => void;
  onCreateLessonNote: (lesson: LessonSlot, date: Date, intent: "note" | "homework") => void;
}) {
  const [expandedLessonId, setExpandedLessonId] = useState<string | null>(null);
  const [loadMapOpen, setLoadMapOpen] = useState(() => window.matchMedia("(min-width: 960px) and (min-height: 600px)").matches);
  const personalEvents = usePersonalEvents();
  useEffect(() => {
    const media = window.matchMedia("(min-width: 960px) and (min-height: 600px)");
    const onChange = () => setLoadMapOpen(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  if (hasDatedLessons(lessons)) {
    return <SessionScheduleView lessons={lessons} notes={notes} groupNrec={groupNrec} onToggleNote={onToggleNote} onOpenCalendar={onOpenCalendar} onCreateLessonNote={onCreateLessonNote} />;
  }

  const dayLoads = buildWeekLoads(lessons, weekMode, validFrom, validThrough);
  const totalLessons = dayLoads.reduce((sum, day) => sum + day.count, 0);
  const noVerifiedDays = dayLoads.every((day) => day.outsidePeriod);
  const partialWeek = !noVerifiedDays && dayLoads.some((day) => day.outsidePeriod);
  const todayKey = dateKeyFromDate(new Date());
  const weekRange = `${WEEK_DATE_FORMATTER.format(dayLoads[0].date)} – ${WEEK_DATE_FORMATTER.format(dayLoads[dayLoads.length - 1].date)}`;

  return (
    <div className="view-stack week-view">
      <div className="week-overview">
        <section className="week-toolbar week-primary-toolbar">
          <div className="week-toolbar-copy">
            <span><Activity size={13} /> Расписание</span>
            <h2>Неделя</h2>
            <p>{weekRange} · {noVerifiedDays ? "нет данных" : partialWeek ? `${formatLessonCount(totalLessons)} · частично` : formatLessonCount(totalLessons)}</p>
          </div>
          <button className="week-calendar-button" type="button" onClick={onOpenCalendar} aria-label="Открыть календарь расписания" title="Календарь">
            <CalendarDays size={22} />
          </button>
        </section>

        <details className="week-map-disclosure" open={loadMapOpen} onToggle={(event) => setLoadMapOpen(event.currentTarget.open)}>
          <summary><Activity size={15} aria-hidden="true" /> Карта нагрузки <ChevronDown size={17} aria-hidden="true" /></summary>
          <WeekMap dayLoads={dayLoads} onSelectDate={onSelectDate} />
        </details>

        <div className="mode-switch" role="radiogroup" aria-label="Тип недели">
          {[
            ["current", "Текущая"],
            ["numerator", "Числитель"],
            ["denominator", "Знаменатель"]
          ].map(([mode, label]) => (
            <button
              key={mode}
              className={weekOverride === mode ? "active" : ""}
              type="button"
              role="radio"
              aria-checked={weekOverride === mode}
              onClick={() => setWeekOverride(mode as WeekMode | "current")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <section className="week-list">
        {dayLoads.map((day) => {
          const isToday = dateKeyFromDate(day.date) === todayKey;
          const outsidePeriod = day.outsidePeriod;
          const dayEvents = personalEventsOnDate(personalEvents, day.date);
          return (
            <article className={`day-block ${isToday ? "current-day" : ""} ${day.count ? "" : "empty-day"}`} key={day.dayName}>
              <button className="day-title" type="button" onClick={() => onSelectDate(day.date)} aria-label={`Открыть расписание: ${day.dayName}`}>
                <div className="day-title-main">
                  <span className="day-date-tile">{String(day.date.getDate()).padStart(2, "0")}</span>
                  <div>
                    <h3>{day.dayName}</h3>
                    <small>{isToday ? "Сегодня" : WEEK_DATE_FORMATTER.format(day.date).replace(".", "")}</small>
                  </div>
                </div>
                <span>{day.count ? formatLessonCount(day.count) : outsidePeriod ? "нет данных" : "без пар"}</span>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
              {day.lessons.length ? (
                day.lessons.map((lesson) => {
                  const choice = getLessonChoice(lesson, weekMode);
                  const linkedNotes = notesLinkedToLesson(lessonWithSelectedVariant(lesson, choice), notes, day.date, groupNrec);
                  const expanded = expandedLessonId === `${dateKeyFromDate(day.date)}-${lesson.id}`;
                  const view = lessonView(lesson, choice, weekMode);
                  const change = lessonChangeMessage(groupNrec, dateKeyFromDate(day.date), lesson, choice);
                  return (
                    <article className={`mini-lesson ${expanded ? "expanded" : ""}`} key={lesson.id}>
                      <button className="mini-lesson-main" type="button" onClick={() => setExpandedLessonId((value) => value === `${dateKeyFromDate(day.date)}-${lesson.id}` ? null : `${dateKeyFromDate(day.date)}-${lesson.id}`)} aria-expanded={expanded}>
                        <span className="mini-lesson-time" aria-label={`С ${lesson.start} до ${lesson.end}`}>
                          <time dateTime={lesson.start}>{lesson.start}</time>
                          <time dateTime={lesson.end}>{lesson.end}</time>
                        </span>
                        <strong>{view.subject}</strong>
                        <small className="mini-lesson-meta">
                          <span>{[change && choice !== "all" ? "Дистант" : view.room, view.kind].filter(Boolean).join(" · ") || "ВлГУ"}</span>
                          <span className="mini-lesson-teacher">{view.teacher || "Преподаватель не указан"}</span>
                          {(lesson.variants?.length ?? 0) > 1 && <span className="lesson-choice-hint">{formatVariantCount(lesson.variants?.length ?? 0)} · выбрать</span>}
                          {change && <span className="lesson-change">{change}</span>}
                        </small>
                        {linkedNotes.length > 0 && <span className="mini-note-badge"><BookCheck size={13} /> {linkedNotes.length}</span>}
                        <ChevronRight className="mini-lesson-chevron" size={18} aria-hidden="true" />
                      </button>
                      {expanded && (
                        <div className="mini-lesson-actions">
                          {(lesson.variants?.length ?? 0) > 1 && <LessonVariantPicker lesson={lesson} choice={choice} onChoose={(nextChoice) => onChooseLesson(lesson, weekMode, nextChoice)} />}
                          <button type="button" onClick={() => onCreateLessonNote(lesson, day.date, "note")}><NotebookPen size={15} /> Записка</button>
                          <button type="button" onClick={() => onCreateLessonNote(lesson, day.date, "homework")}><BookCheck size={15} /> Добавить ДЗ</button>
                          {linkedNotes.map((note) => (
                            <button className="mini-linked-note" key={note.id} type="button" onClick={() => onToggleNote(note.id)} aria-label={`Отметить выполненным: ${note.title}`}>
                              <CheckCircle2 size={14} /> <span>{note.title}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </article>
                  );
                })
              ) : !dayEvents.length ? (
                <p className="quiet-copy">{outsidePeriod ? "Расписание не действует на эту дату." : "В расписании на этот день занятий нет."}</p>
              ) : null}
              {dayEvents.map((event) => (
                <button className="week-personal-event" type="button" key={event.id} onClick={() => onSelectDate(day.date)} aria-label={`Открыть день: ${event.title}`}>
                  <CalendarDays size={17} aria-hidden="true" />
                  <span><strong>{event.title}</strong><small>{[new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(event.start)), event.location].filter(Boolean).join(" · ")}</small></span>
                  <ChevronRight size={17} aria-hidden="true" />
                </button>
              ))}
            </article>
          );
        })}
      </section>
    </div>
  );
}

function SessionScheduleView({ lessons, notes, groupNrec, onToggleNote, onOpenCalendar, onCreateLessonNote }: {
  lessons: LessonSlot[];
  notes: SmartNote[];
  groupNrec?: string;
  onToggleNote: (noteId: string) => void;
  onOpenCalendar: () => void;
  onCreateLessonNote: (lesson: LessonSlot, date: Date, intent: "note" | "homework") => void;
}) {
  const [expandedLessonId, setExpandedLessonId] = useState<string | null>(null);
  const todayKey = dateKeyFromDate();
  const upcoming = lessons.filter((lesson) => !lesson.date || lesson.date >= todayKey);
  const visibleLessons = (upcoming.length ? upcoming : lessons).sort((a, b) => `${a.date ?? ""} ${a.start}`.localeCompare(`${b.date ?? ""} ${b.start}`, "ru"));
  const groups = visibleLessons.reduce<Array<{ key: string; title: string; lessons: LessonSlot[] }>>((items, lesson) => {
    const key = lesson.date ?? lesson.dayName;
    const existing = items.find((item) => item.key === key);
    const title = lesson.dateLabel ? `${lesson.dateLabel}` : lesson.dayName;
    if (existing) {
      existing.lessons.push(lesson);
      return items;
    }
    return [...items, { key, title, lessons: [lesson] }];
  }, []);

  return (
    <div className="view-stack week-view session-view">
      <div className="week-overview">
        <section className="week-toolbar">
          <div className="week-toolbar-copy">
            <span><Activity size={13} /> Расписание</span>
            <h2>Сессия</h2>
            <p>{formatLessonCount(visibleLessons.length)} в ближайшем плане</p>
          </div>
          <div className="week-index-visual" aria-label={`${groups.length} дат в расписании`}>
            <ShieldCheck size={18} />
            <strong>{groups.length}</strong>
            <small>дат</small>
          </div>
          <button className="week-calendar-button" type="button" onClick={onOpenCalendar} aria-label="Открыть календарь расписания" title="Календарь">
            <CalendarDays size={22} />
          </button>
        </section>

        <section className="week-map session-map" aria-label="Карта сессии">
          <div className="week-map-head">
            <span>Ближайшие даты</span>
            <strong>{formatLessonCount(visibleLessons.length)}</strong>
          </div>
          <div className="session-map-grid">
            {groups.slice(0, 6).map((group) => (
              <div className="session-date-card" key={group.key}>
                <strong>{group.title}</strong>
                <span>{formatLessonCount(group.lessons.length)}</span>
                <small>{group.lessons[0] ? `${group.lessons[0].start}–${group.lessons[0].end}` : ""}</small>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="week-list">
        {groups.map((group) => (
          <article className="day-block" key={group.key}>
            <div className="day-title">
              <h3>{group.title}</h3>
              <span>{formatLessonCount(group.lessons.length)}</span>
            </div>
            {group.lessons.map((lesson) => {
              const lessonDate = lesson.date ? new Date(`${lesson.date}T00:00:00`) : new Date();
              const linkedNotes = notesLinkedToLesson(lesson, notes, lessonDate, groupNrec);
              const expanded = expandedLessonId === lesson.id;
              return (
                <article className={`mini-lesson ${expanded ? "expanded" : ""}`} key={lesson.id}>
                  <button className="mini-lesson-main" type="button" onClick={() => setExpandedLessonId((value) => value === lesson.id ? null : lesson.id)} aria-expanded={expanded}>
                    <span className="mini-lesson-time" aria-label={`С ${lesson.start} до ${lesson.end}`}>
                      <time dateTime={lesson.start}>{lesson.start}</time>
                      <time dateTime={lesson.end}>{lesson.end}</time>
                    </span>
                    <strong>{lesson.subject}</strong>
                    <small className="mini-lesson-meta">
                      <span>{[lesson.room, lesson.kind].filter(Boolean).join(" · ") || "ВлГУ"}</span>
                      <span className="mini-lesson-teacher">{lesson.teacher || "Преподаватель не указан"}</span>
                    </small>
                    {linkedNotes.length > 0 && <span className="mini-note-badge"><BookCheck size={13} /> {linkedNotes.length}</span>}
                    <ChevronRight className="mini-lesson-chevron" size={18} aria-hidden="true" />
                  </button>
                  {expanded && (
                    <div className="mini-lesson-actions">
                      <button type="button" onClick={() => onCreateLessonNote(lesson, lessonDate, "note")}><NotebookPen size={15} /> Записка</button>
                      <button type="button" onClick={() => onCreateLessonNote(lesson, lessonDate, "homework")}><BookCheck size={15} /> Добавить ДЗ</button>
                      {linkedNotes.map((note) => (
                        <button className="mini-linked-note" key={note.id} type="button" onClick={() => onToggleNote(note.id)} aria-label={`Отметить выполненным: ${note.title}`}>
                          <CheckCircle2 size={14} /> <span>{note.title}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </article>
        ))}
      </section>
    </div>
  );
}

function WeekMap({ dayLoads, onSelectDate }: { dayLoads: WeekDayLoad[]; onSelectDate: (date: Date) => void }) {
  const todayKey = dateKeyFromDate(new Date());
  const maxCount = Math.max(1, ...dayLoads.map((day) => day.count));
  return (
    <section className="week-map week-rhythm" aria-label="Нагрузка по дням недели">
      <div className="week-rhythm-grid">
        {dayLoads.map((day) => (
          <button
            type="button"
            className={`week-rhythm-day ${dateKeyFromDate(day.date) === todayKey ? "active" : ""}`}
            key={day.dayName}
            onClick={() => onSelectDate(day.date)}
            aria-label={`Открыть ${day.dayName}: ${day.count ? formatLessonCount(day.count) : day.outsidePeriod ? "нет данных" : "без пар"}`}
            aria-current={dateKeyFromDate(day.date) === todayKey ? "date" : undefined}
          >
            <span className="week-rhythm-meter" aria-hidden="true"><i style={{ height: day.count ? `${Math.max(16, Math.round((day.count / maxCount) * 100))}%` : "3px" }} /></span>
            <strong>{day.short}</strong>
            <small>{day.outsidePeriod ? "·" : day.count}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function SettingsView({
  settings,
  notice,
  capability,
  busy,
  onEnable,
  onTest,
  onMinutes,
  schedule,
  themeId,
  customThemeName,
  onThemeOpen,
  notes,
  folders,
  onImportNotes
}: {
  settings: ReminderSettings;
  notice: string;
  capability: NotificationCapability;
  busy: boolean;
  onEnable: () => void;
  onTest: () => void;
  onMinutes: (minutes: number) => void;
  schedule: ScheduleState | null;
  themeId: ThemeId;
  customThemeName: string;
  onThemeOpen: () => void;
  notes: SmartNote[];
  folders: NoteFolder[];
  onImportNotes: (notes: SmartNote[], folders?: NoteFolder[]) => Promise<number>;
}) {
  const activeTheme = THEMES.find((theme) => theme.id === themeId) ?? THEMES[0];
  const activeThemeName = themeId === "custom" ? customThemeName || "Своя тема" : activeTheme.name;
  const importInputRef = useRef<HTMLInputElement>(null);
  const [backupNotice, setBackupNotice] = useState("");
  const [pendingBackupSignature, setPendingBackupSignature] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<NoteDraft[]>([]);
  const [draftsStatus, setDraftsStatus] = useState<NotesLoadStatus | "loading">("loading");
  const personalEvents = usePersonalEvents();
  useEffect(() => {
    let active = true;
    void loadDraftsWithStatus().then((loaded) => {
      if (!active) return;
      setDrafts(loaded.drafts);
      setDraftsStatus(loaded.status);
    });
    return () => { active = false; };
  }, []);
  const currentBackupSignature = useMemo(
    () => backupSignature({ notes, folders: folders.filter((folder) => !folder.system), events: personalEvents, drafts }),
    [notes, folders, personalEvents, drafts]
  );
  const backupMade = draftsStatus === "database" && readBackupMade(currentBackupSignature);
  const [importBusy, setImportBusy] = useState(false);
  async function importBackup(file?: File) {
    if (!file || importBusy) return;
    setImportBusy(true);
    let archive: ReturnType<typeof parseNotesArchive>;
    try {
      archive = parseNotesArchive(await file.text());
    } catch {
      setBackupNotice("Не удалось прочитать копию. Выбери файл, сохранённый в «Лад».");
      setImportBusy(false);
      if (importInputRef.current) importInputRef.current.value = "";
      return;
    }
    try {
      const imported = await onImportNotes(archive.notes, archive.folders);
      const calendar = importPersonalEvents(archive.events);
      const restoredDrafts = archive.drafts.length ? await importDrafts(archive.drafts) : { added: 0, conflicts: 0 };
      const loaded = await loadDraftsWithStatus();
      setDrafts(loaded.drafts);
      setDraftsStatus(loaded.status);
      setBackupNotice(`${imported ? `Добавлено или обновлено записей: ${imported}.` : "Все записи уже актуальны."}${archive.folders.length ? " Папки восстановлены; существующие сохранены." : ""} Событий добавлено: ${calendar.added}. Черновиков восстановлено: ${restoredDrafts.added}.${calendar.conflicts || restoredDrafts.conflicts ? " Разные версии сохранены отдельно." : ""}`);
    } catch {
      setBackupNotice("Импорт не завершён: устройству не удалось сохранить данные. Часть копии могла восстановиться. Сохраните исходный файл и повторите импорт после освобождения места.");
    } finally {
      setImportBusy(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  return (
    <div className="view-stack settings-view">
      <section className="settings-hero">
        <div>
          <BellRing size={34} />
          <h2>Напоминания перед парами</h2>
          <p>
            Напоминания работают, пока приложение открыто. Если закрыть его, уведомления о парах могут не прийти.
          </p>
        </div>
      </section>

      <div className="settings-panels">
        <section className="settings-panel">
          <div className="setting-row appearance-row">
            <div>
              <span>Оформление</span>
              <strong>{activeThemeName}</strong>
            </div>
            <button type="button" className="theme-settings-button" onClick={onThemeOpen}>
              <Palette size={18} />
              Сменить
            </button>
          </div>

          <div className={`capability-card ${capability.status}`}>
            <div>
              {capability.status === "available" ? <CheckCircle2 size={24} /> : capability.status === "denied" ? <ShieldAlert size={24} /> : <Info size={24} />}
            </div>
            <div>
              <span>Статус уведомлений</span>
              <strong>{capability.title}</strong>
              <p>{capability.detail}</p>
            </div>
          </div>

          <div className="setting-row">
            <div>
              <span>Напоминать за</span>
              <strong>{settings.minutesBefore} минут</strong>
            </div>
            <button type="button" onClick={onEnable} disabled={!capability.canRequestPermission && capability.status !== "available"} className="primary-action">
              <Bell size={18} />
              Включить
            </button>
          </div>

          <div className="reminder-options" aria-label="За сколько минут напоминать">
            {REMINDER_OPTIONS.map((minutes) => (
              <button
                key={minutes}
                className={settings.minutesBefore === minutes ? "active" : ""}
                type="button"
                onClick={() => onMinutes(minutes)}
              >
                {minutes} мин
              </button>
            ))}
          </div>

          <button type="button" className="test-action" onClick={onTest} disabled={busy || capability.status === "install-required" || capability.status === "unsupported" || capability.status === "denied"}>
            <Send size={18} />
            {busy ? "Отправляем..." : "Проверить уведомление"}
          </button>

          <div className="setting-row subtle">
            <div>
              <span>Расписание без интернета</span>
              <strong>{schedule ? `Сохранено ${formatUpdatedAt(schedule.fetchedAt)}` : "Пока не сохранено"}</strong>
              <small>{schedule ? "Откроется и без интернета" : "Появится после первой загрузки"}</small>
            </div>
            {schedule ? <CheckCircle2 size={24} /> : <CloudOff size={24} />}
          </div>

          {notice && <p className="notice">{notice}</p>}
        </section>

        <section className="settings-panel personal-data-panel">
          <header className="personal-data-head">
            <span className="personal-data-icon"><HardDrive size={21} /></span>
            <div>
              <span>Личное пространство</span>
              <strong>{formatNoteCount(notes.length)}</strong>
            </div>
          </header>
          <p>Записи хранятся на этом устройстве. Сохрани копию, чтобы перенести их на другой телефон или восстановить позже.</p>
          <details className="privacy-details">
            <summary>Не вижу прежние записи</summary>
            <p>Записи остаются в том приложении и браузере, где ты их создал. При смене адреса они не переносятся автоматически.</p>
            <p>Открой прежнее приложение, выбери «Настройки → Экспорт» и импортируй сохранённый файл здесь. До сохранения копии не удаляй прежнее приложение.</p>
            <p>Копия содержит сохранённые записи, фотографии и свои папки. Несохранённый текст в неё не входит.</p>
          </details>
          <div className="privacy-map" aria-label="Как приложение работает с данными">
            <div>
              <ShieldCheck size={18} />
              <span><strong>Только на устройстве</strong><small>Записи, фотографии и личные настройки.</small></span>
            </div>
            <div>
              <CloudOff size={18} />
              <span><strong>Без слежения</strong><small>Нет аккаунта, рекламы и аналитики.</small></span>
            </div>
            <div>
              <Smartphone size={18} />
              <span><strong>Работает без сети</strong><small>Ранее открытое расписание остаётся доступным.</small></span>
            </div>
          </div>
          <details className="privacy-details">
            <summary>О приложении и данных</summary>
            <p>«Лад ВлГУ» - независимое приложение для студентов. Сверяй важные изменения с официальным расписанием ВлГУ.</p>
            <p>Личные записи и фотографии не отправляются на сервер. Для их переноса сохрани копию.</p>
          </details>
          {(notes.length > 0 || personalEvents.length > 0 || drafts.length > 0) && draftsStatus !== "loading" && !backupMade && (
            <p className="backup-warning" role="status">
              <TriangleAlert size={14} aria-hidden="true" />
              <span>
                Нет подтверждённой копии текущих записей. Если удалить приложение,
                изменения без копии могут исчезнуть.
              </span>
            </p>
          )}
          <div className="backup-actions">
            <button type="button" onClick={() => {
              try {
                downloadNotesBackup(notes, folders, personalEvents, drafts);
                setPendingBackupSignature(draftsStatus === "database" ? currentBackupSignature : null);
                setBackupNotice(draftsStatus === "database"
                  ? "Проверь, что файл сохранился в «Файлах» или загрузках, затем подтверди ниже."
                  : "Файл создан из доступных данных, но часть черновиков может быть недоступна. Не удаляй старое приложение.");
              } catch {
                setPendingBackupSignature(null);
                setBackupNotice("Не удалось начать экспорт. Попробуйте ещё раз.");
              }
            }} disabled={importBusy || draftsStatus === "loading" || (!notes.length && !personalEvents.length && !drafts.length && !folders.some((folder) => !folder.system))}>
              <Download size={17} /> Экспорт
            </button>
            <button type="button" disabled={importBusy} onClick={() => importInputRef.current?.click()}>
              <Upload size={17} /> Импорт
            </button>
          </div>
          {pendingBackupSignature && (
            <button className="backup-confirm" type="button" onClick={() => {
              markBackupMade(pendingBackupSignature);
              setPendingBackupSignature(null);
              setBackupNotice(pendingBackupSignature === currentBackupSignature
                ? "Копия подтверждена. Храните файл отдельно от приложения."
                : "Файл сохранён, но записи уже изменились. Создайте новую копию.");
            }}>
              <CheckCircle2 size={17} /> Файл сохранён
            </button>
          )}
          <p className="backup-notice">Копия содержит записи, черновики, папки и личные события календаря.</p>
          <input
            ref={importInputRef}
            className="visually-hidden"
            type="file"
            accept="application/json,.json"
            onChange={(event) => void importBackup(event.target.files?.[0])}
            aria-label="Импортировать резервную копию записей"
          />
          {backupNotice && <p className="backup-notice" role="status">{backupNotice}</p>}
        </section>
      </div>
    </div>
  );
}

function SkeletonView() {
  return (
    <div className="view-stack" aria-label="Загрузка расписания">
      <section className="hero-card skeleton-hero">
        <div className="skeleton-line short" />
        <div className="skeleton-line title" />
        <div className="skeleton-line title second" />
        <div className="skeleton-line meta" />
        <div className="skeleton-line progress" />
      </section>
      <section className="timeline-card skeleton-list">
        <div className="skeleton-row" />
        <div className="skeleton-row" />
        <div className="skeleton-row" />
      </section>
    </div>
  );
}

function BottomNav({ activeTab, onTabChange }: { activeTab: AppTab; onTabChange: (tab: AppTab) => void }) {
  const items = [
    { tab: "today" as const, label: "Сегодня", icon: CalendarDays },
    { tab: "week" as const, label: "Неделя", icon: Grid2X2 },
    { tab: "notes" as const, label: "Записи", icon: NotebookPen },
    { tab: "settings" as const, label: "Настройки", icon: Settings }
  ];
  const activeIndex = items.findIndex((item) => item.tab === activeTab);

  return (
    <nav className="bottom-nav" aria-label="Основная навигация" data-active-index={activeIndex}>
      <span className="nav-selection" aria-hidden="true">
        <i key={activeTab} />
      </span>
      {items.map(({ tab, label, icon: Icon }) => (
        <button
          key={tab}
          className={activeTab === tab ? "active" : ""}
          type="button"
          onClick={(event) => {
            event.currentTarget.blur();
            onTabChange(tab);
          }}
          aria-current={activeTab === tab ? "page" : undefined}
        >
          <span className="nav-icon" aria-hidden="true"><Icon size={23} /></span>
          <span className="nav-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}

function ScheduleUnavailableView({ onRetry, onGroupOpen, onRestore }: { groupNrec?: string; selectedDateKey: string; onRetry: () => void; onGroupOpen: () => void; onRestore?: () => void }) {
  return (
    <section className="schedule-unavailable" role="status" aria-live="polite">
      <span className="schedule-unavailable-icon" aria-hidden="true"><CalendarX2 size={27} /></span>
      <span className="schedule-unavailable-copy">
        <small>Данных для группы пока нет</small>
        <strong>Расписание не получено</strong>
        <p>Для этой группы пока нет доступного расписания. Попробуй обновить данные или проверь официальный источник.</p>
      </span>
      {onRestore && <button type="button" onClick={onRestore}>Вернуться к прошлой группе</button>}
      <button type="button" onClick={onRetry}>
        <RefreshCw size={17} />
        Повторить
      </button>
      <button type="button" className="secondary" onClick={onGroupOpen}>Выбрать другую группу</button>
      <a href="https://www.vlsu.ru/studentu/raspisanie-zanjatii/" target="_blank" rel="noopener noreferrer">
        <ExternalLink size={17} /> Расписание на сайте ВлГУ
      </a>
    </section>
  );
}
