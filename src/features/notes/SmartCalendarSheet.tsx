import {
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  MapPin,
  NotebookPen,
  Share2,
  Sparkles,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { currentDayIndex, dateKeyFromDate, relativeDayLabel, selectDayLessons, weekModeForDate } from "../../lib/time";
import type { LessonSlot, WeekMode } from "../../types";
import type { SmartNote } from "./noteTypes";
import { personalEventsOnDate, usePersonalEvents, type PersonalEvent } from "./personalEvents";
import { PersonalEventForm } from "./PersonalEventForm";
import { shiftCalendarMonth } from "./calendarMonth";
import { groupStudyCalendar, studyPeriodRange, studyPeriodsOnDate, studyPeriodTitle } from "../../lib/studyPeriods";
import { schedulePeriodContains } from "../../lib/schedulePeriod";

interface SmartCalendarSheetProps {
  lessons: LessonSlot[];
  scheduleAvailable?: boolean;
  scheduleValidFrom?: string;
  scheduleValidThrough?: string;
  groupNrec?: string;
  notes: SmartNote[];
  open: boolean;
  initialCreateEvent?: boolean;
  weekMode: WeekMode;
  initialDate?: Date;
  onClose: () => void;
  onCreateForDate: (date: Date) => void;
  onOpenNote: (noteId: string) => void;
  onSelectDate?: (date: Date) => void;
}

interface CalendarEvent {
  id: string;
  title: string;
  detail: string;
  start: Date;
  end: Date;
  location?: string;
  type: "lesson" | "note" | "personal";
  noteId?: string;
  personalId?: string;
}

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function startOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function addDays(date: Date, amount: number) {
  const value = new Date(date);
  value.setDate(value.getDate() + amount);
  return value;
}

function timeOnDate(date: Date, value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

function lessonsForDate(lessons: LessonSlot[], date: Date, currentMode: WeekMode) {
  return selectDayLessons(lessons, currentDayIndex(date), weekModeForDate(date, currentMode), date);
}

function notesForDate(notes: SmartNote[], date: Date) {
  const key = dateKeyFromDate(date);
  return notes.filter((note) => note.status === "open" && (
    note.lessonContext?.date === key
    || Boolean(note.dueAt && dateKeyFromDate(new Date(note.dueAt)) === key)
  ));
}

function eventsForDate(lessons: LessonSlot[], notes: SmartNote[], date: Date, weekMode: WeekMode, personalEvents: PersonalEvent[]): CalendarEvent[] {
  const classEvents = lessonsForDate(lessons, date, weekMode).map((lesson) => ({
    id: `lesson-${lesson.id}-${dateKeyFromDate(date)}`,
    title: lesson.subject,
    detail: [lesson.kind, lesson.teacher].filter(Boolean).join(" · ") || "Пара",
    start: timeOnDate(date, lesson.start),
    end: timeOnDate(date, lesson.end),
    location: lesson.room,
    type: "lesson" as const
  }));
  const noteEvents = notesForDate(notes, date).map((note) => {
    const start = note.dueAt ? new Date(note.dueAt) : timeOnDate(date, note.lessonContext?.start ?? "09:00");
    const end = new Date(start.getTime() + 30 * 60_000);
    return {
      id: `note-${note.id}`,
      title: note.title,
      detail: note.topic ?? note.space,
      start,
      end,
      type: "note" as const,
      noteId: note.id
    };
  });
  const personal = personalEventsOnDate(personalEvents, date).map((event) => ({
    id: `personal-${event.id}`, personalId: event.id, title: event.title, detail: event.description,
    start: new Date(event.start), end: new Date(event.end), location: event.location, type: "personal" as const
  }));
  return [...classEvents, ...noteEvents, ...personal].sort((a, b) => a.start.getTime() - b.start.getTime());
}

function monthCells(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const startOffset = (first.getDay() || 7) - 1;
  const start = addDays(first, -startOffset);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function formatUtc(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeIcs(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function formatEventCount(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} событие`;
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return `${count} события`;
  return `${count} событий`;
}

function formatCount(count: number, one: string, few: string, many: string) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} ${one}`;
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return `${count} ${few}`;
  return `${count} ${many}`;
}

function relativeMonthLabel(month: Date, today: Date) {
  const distance = (month.getFullYear() - today.getFullYear()) * 12 + month.getMonth() - today.getMonth();
  if (distance === 0) return "Текущий месяц";
  if (distance === 1) return "Следующий месяц";
  if (distance === -1) return "Прошлый месяц";
  if (distance > 1) return `Через ${formatCount(distance, "месяц", "месяца", "месяцев")}`;
  return `${formatCount(Math.abs(distance), "месяц", "месяца", "месяцев")} назад`;
}

function buildIcs(events: CalendarEvent[], name: string) {
  const stamp = formatUtc(new Date());
  const rows = events.flatMap((event) => [
    "BEGIN:VEVENT",
    `UID:${escapeIcs(event.id)}@lad-vlsu`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${formatUtc(event.start)}`,
    `DTEND:${formatUtc(event.end)}`,
    `SUMMARY:${escapeIcs(event.title)}`,
    `DESCRIPTION:${escapeIcs(event.detail)}`,
    ...(event.location ? [`LOCATION:${escapeIcs(event.location)}`] : []),
    "END:VEVENT"
  ]);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lad VLSU//Calendar//RU",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcs(name)}`,
    ...rows,
    "END:VCALENDAR"
  ].join("\r\n");
}

async function shareCalendar(events: CalendarEvent[], fileName: string, title: string) {
  if (!events.length) return false;
  const file = new File([buildIcs(events, title)], fileName, { type: "text/calendar;charset=utf-8" });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title });
    return true;
  }
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
  return true;
}

export function SmartCalendarSheet({ lessons, scheduleAvailable = true, scheduleValidFrom, scheduleValidThrough, groupNrec, notes, open, initialCreateEvent = false, weekMode, initialDate, onClose, onCreateForDate, onOpenNote, onSelectDate }: SmartCalendarSheetProps) {
  const personalEvents = usePersonalEvents();
  const [editingEvent, setEditingEvent] = useState<PersonalEvent | "new" | null>(initialCreateEvent ? "new" : null);
  const swipe = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const suppressClickUntil = useRef(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [today, setToday] = useState(() => startOfDay(new Date()));
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(today);
  const [monthTransition, setMonthTransition] = useState<{ from: Date; direction: "next" | "previous" } | null>(null);
  const [exportState, setExportState] = useState<"idle" | "working" | "done">("idle");
  const exportResetTimer = useRef<number | undefined>(undefined);
  const cells = useMemo(() => monthCells(month), [month]);
  const selectedEvents = useMemo(
    () => eventsForDate(lessons, notes, selectedDate, weekMode, personalEvents),
    [lessons, notes, selectedDate, weekMode, personalEvents]
  );
  const monthEvents = useMemo(
    () => cells
      .filter((date) => date.getMonth() === month.getMonth() && date.getFullYear() === month.getFullYear())
      .flatMap((date) => eventsForDate(lessons, notes, date, weekMode, personalEvents))
      .filter((event, index, all) => all.findIndex((item) => item.id === event.id) === index),
    [cells, lessons, month, notes, weekMode, personalEvents]
  );

  useEffect(() => {
    if (!open) return;
    const current = startOfDay(new Date());
    const initial = startOfDay(initialDate ?? current);
    setToday(current);
    setSelectedDate(initial);
    setMonth(new Date(initial.getFullYear(), initial.getMonth(), 1));
    setMonthTransition(null);
    setExportState("idle");
    setEditingEvent(initialCreateEvent ? "new" : null);
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && closeRef.current();
    let midnightTimer: number | undefined;
    const scheduleMidnightRefresh = () => {
      const now = new Date();
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      midnightTimer = window.setTimeout(() => {
        setToday(startOfDay(new Date()));
        scheduleMidnightRefresh();
      }, Math.max(1_000, tomorrow.getTime() - now.getTime() + 750));
    };
    scheduleMidnightRefresh();
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (midnightTimer !== undefined) window.clearTimeout(midnightTimer);
      if (exportResetTimer.current !== undefined) window.clearTimeout(exportResetTimer.current);
    };
  }, [initialCreateEvent, initialDate, open]);

  useEffect(() => {
    if (!monthTransition) return;
    const timer = window.setTimeout(() => setMonthTransition(null), 340);
    return () => window.clearTimeout(timer);
  }, [monthTransition]);

  if (!open) return null;

  async function exportEvents(events: CalendarEvent[], fileName: string, title: string) {
    if (!events.length || exportState === "working") return;
    setExportState("working");
    try {
      await shareCalendar(events, fileName, title);
      setExportState("done");
      if (exportResetTimer.current !== undefined) window.clearTimeout(exportResetTimer.current);
      exportResetTimer.current = window.setTimeout(() => setExportState("idle"), 1800);
    } catch {
      setExportState("idle");
    }
  }

  function moveMonth(offset: number) {
    const target = new Date(month.getFullYear(), month.getMonth() + offset, 1);
    setMonthTransition({ from: month, direction: offset > 0 ? "next" : "previous" });
    setMonth(target);
    setSelectedDate((date) => shiftCalendarMonth(date, offset));
  }

  function selectCalendarDate(date: Date) {
    const target = startOfDay(date);
    const distance = (target.getFullYear() - month.getFullYear()) * 12 + target.getMonth() - month.getMonth();
    if (distance !== 0) {
      setMonthTransition({ from: month, direction: distance > 0 ? "next" : "previous" });
      setMonth(new Date(target.getFullYear(), target.getMonth(), 1));
    }
    setSelectedDate(target);
  }

  function goToToday() {
    const current = startOfDay(new Date());
    setToday(current);
    const distance = (current.getFullYear() - month.getFullYear()) * 12 + current.getMonth() - month.getMonth();
    setMonthTransition(distance ? { from: month, direction: distance > 0 ? "next" : "previous" } : null);
    setMonth(new Date(current.getFullYear(), current.getMonth(), 1));
    setSelectedDate(current);
  }

  const monthLabel = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(month);
  const selectedLabel = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(selectedDate);
  const selectedRelation = relativeDayLabel(selectedDate, today);
  const monthRelation = relativeMonthLabel(month, today);
  const monthKey = `${month.getFullYear()}-${month.getMonth()}`;
  const studyCalendar = groupStudyCalendar(groupNrec);
  const selectedPeriods = studyPeriodsOnDate(studyCalendar?.periods ?? [], dateKeyFromDate(selectedDate));
  const scheduleKnownOnDate = (date: Date) => scheduleAvailable && schedulePeriodContains(dateKeyFromDate(date), scheduleValidFrom, scheduleValidThrough);
  const selectedScheduleKnown = scheduleKnownOnDate(selectedDate);

  function renderMonthCells(gridMonth: Date, interactive: boolean) {
    return monthCells(gridMonth).map((date) => {
      const key = dateKeyFromDate(date);
      const dayLessons = lessonsForDate(lessons, date, weekMode);
      const dayNotes = [...notesForDate(notes, date), ...personalEventsOnDate(personalEvents, date)];
      const dayPeriods = studyPeriodsOnDate(studyCalendar?.periods ?? [], key);
      const selected = key === dateKeyFromDate(selectedDate);
      const isToday = key === dateKeyFromDate(today);
      return (
        <button
          key={key}
          className={`${date.getMonth() !== gridMonth.getMonth() ? "outside" : ""} ${selected ? "selected" : ""} ${isToday ? "today" : ""}`}
          type="button"
          disabled={!interactive}
          onClick={() => selectCalendarDate(date)}
          aria-pressed={selected}
          aria-current={isToday ? "date" : undefined}
          aria-label={`${date.toLocaleDateString("ru-RU")}: ${scheduleKnownOnDate(date) ? formatCount(dayLessons.length, "пара", "пары", "пар") : "расписание пар не получено"}, ${formatCount(dayNotes.length, "событие", "события", "событий")}${dayPeriods.length ? `, ${dayPeriods.map((period) => studyPeriodTitle(period.kind)).join(", ")}` : ""}`}
        >
          <span>{date.getDate()}</span>
          <i className="calendar-dots" aria-hidden="true">
            {dayLessons.length > 0 && <b className="lesson-dot" />}
            {dayNotes.length > 0 && <b className="note-dot" />}
            {dayPeriods.length > 0 && <b className="study-period-dot" />}
          </i>
        </button>
      );
    });
  }

  const layer = (
    <div className="sheet-layer calendar-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="smart-calendar" role="dialog" aria-modal="true" aria-labelledby="smart-calendar-title" data-lesson-count={lessons.length} data-week-mode={weekMode} onClickCapture={(event) => {
        if (Date.now() < suppressClickUntil.current && (event.target as Element).closest(".calendar-grid")) { event.preventDefault(); event.stopPropagation(); }
      }}>
        <div className="sheet-handle" aria-hidden="true" />
        <header className="calendar-header">
          <div>
            <span><Sparkles size={13} /> Личный ритм</span>
            <h2 id="smart-calendar-title">Календарь</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть календарь" title="Закрыть">
            <X size={20} />
          </button>
        </header>

        {editingEvent ? <PersonalEventForm date={selectedDate} event={editingEvent === "new" ? undefined : editingEvent} onClose={() => setEditingEvent(null)} /> : <>
        <div className="calendar-month-nav">
          <button type="button" onClick={() => moveMonth(-1)} aria-label="Предыдущий месяц">
            <ChevronLeft size={19} />
          </button>
          <button className="calendar-month-label" type="button" onClick={goToToday} title="Вернуться к сегодняшней дате">
            <strong>{monthLabel}</strong>
            <small>{monthRelation}</small>
          </button>
          <button type="button" onClick={() => moveMonth(1)} aria-label="Следующий месяц">
            <ChevronRight size={19} />
          </button>
        </div>

        <div className="calendar-weekdays" aria-hidden="true">
          {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
        </div>
        <div className="calendar-grid-track" aria-label={monthLabel}
          style={{ touchAction: "pan-y" }}
          onPointerDown={(event) => {
            if (event.isPrimary && !monthTransition) swipe.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
          }}
          onPointerMove={(event) => {
            const origin = swipe.current;
            if (!origin || origin.pointerId !== event.pointerId) return;
            const dx = event.clientX - origin.x;
            const dy = event.clientY - origin.y;
            if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
            const grid = event.currentTarget.lastElementChild as HTMLElement | null;
            if (grid) grid.style.transform = `translate3d(${Math.sign(dx) * Math.min(Math.abs(dx) * .78, event.currentTarget.clientWidth * .78)}px,0,0)`;
          }}
          onPointerCancel={(event) => {
            swipe.current = null;
            const grid = event.currentTarget.lastElementChild as HTMLElement | null;
            if (grid) grid.style.transform = "";
          }}
          onPointerUp={(event) => {
            const origin = swipe.current;
            swipe.current = null;
            if (!origin || origin.pointerId !== event.pointerId) return;
            const dx = event.clientX - origin.x;
            const dy = event.clientY - origin.y;
            const grid = event.currentTarget.lastElementChild as HTMLElement | null;
            if (grid) grid.style.transform = "";
            if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) {
              event.currentTarget.style.setProperty("--calendar-drag-start", `${Math.sign(dx) * Math.min(Math.abs(dx) * .78, event.currentTarget.clientWidth * .78)}px`);
              suppressClickUntil.current = Date.now() + 350;
              moveMonth(dx < 0 ? 1 : -1);
            }
          }}>
          {monthTransition && <div key={`from-${monthTransition.from.getTime()}`} className={`calendar-grid departing-${monthTransition.direction}`} aria-hidden="true">{renderMonthCells(monthTransition.from, false)}</div>}
          <div key={monthKey} className={`calendar-grid ${monthTransition ? `arriving-${monthTransition.direction}` : ""}`}>{renderMonthCells(month, true)}</div>
        </div>

        <section className="calendar-agenda" aria-label={`События: ${selectedLabel}`}>
          <header>
            <div>
              <span>{selectedLabel}</span>
              <strong>{selectedRelation}</strong>
              <small>{selectedEvents.length ? formatEventCount(selectedEvents.length) : selectedPeriods.length ? studyPeriodTitle(selectedPeriods[0].kind) : selectedScheduleKnown ? "Свободный день" : "Пары не загружены"}</small>
            </div>
            <button type="button" onClick={() => { onClose(); onCreateForDate(selectedDate); }} aria-label="Создать запись на выбранную дату" title="Новая запись">
              <NotebookPen size={18} />
            </button>
            <button className="calendar-add-event" type="button" onClick={() => setEditingEvent("new")} aria-label="Добавить событие" title="Добавить событие"><CalendarPlus size={18} /><span>Событие</span></button>
          </header>
          <div key={dateKeyFromDate(selectedDate)} className="calendar-event-list calendar-event-list-enter">
            {selectedPeriods.map((period) => (
              <div className="calendar-study-period" key={`${period.kind}:${period.start}`}>
                <strong>{studyPeriodTitle(period.kind)}</strong><span>{studyPeriodRange(period)}</span>
              </div>
            ))}
            {selectedEvents.length ? selectedEvents.map((event) => {
              const contents = (
                <>
                  <span className="calendar-event-time"><Clock3 size={14} /> {event.start.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</span>
                  <strong>{event.title}</strong>
                  <small>{event.location ? <><MapPin size={13} /> {event.location}</> : event.detail}</small>
                  {event.noteId && <ChevronRight className="calendar-event-tail" size={18} aria-hidden="true" />}
                </>
              );
              return event.noteId ? (
                <button className="calendar-event note note-action" type="button" key={event.id} onClick={() => onOpenNote(event.noteId!)} aria-label={`Открыть запись: ${event.title}`}>
                  {contents}
                </button>
              ) : event.personalId ? (
                <button className="calendar-event personal note-action" type="button" key={event.id} onClick={() => setEditingEvent(personalEvents.find((item) => item.id === event.personalId) ?? null)} aria-label={`Изменить событие: ${event.title}`}>{contents}</button>
              ) : (
                <article className="calendar-event lesson" key={event.id}>{contents}</article>
              );
            }) : (
              <div className="calendar-empty-day"><CalendarDays size={22} /><span>{selectedScheduleKnown ? "На эту дату пока ничего не запланировано." : "Расписание занятий на эту дату пока не получено."}</span></div>
            )}
          </div>
        </section>

        <footer className="calendar-actions">
          {onSelectDate && (
            <button className="calendar-open-day" type="button" onClick={() => { onSelectDate(selectedDate); onClose(); }}>
              <CalendarDays size={17} /> Показать день
            </button>
          )}
          <button type="button" disabled={!selectedEvents.length || exportState === "working"} onClick={() => void exportEvents(selectedEvents, `lad-${dateKeyFromDate(selectedDate)}.ics`, `Лад · ${selectedLabel}`)}>
            <Share2 size={17} /> День
          </button>
          <button className="calendar-export-primary" type="button" disabled={!monthEvents.length || exportState === "working"} onClick={() => void exportEvents(monthEvents, `lad-${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}.ics`, `Лад · ${monthLabel}`)}>
            <Download size={17} /> {exportState === "done" ? "Готово" : "В календарь"}
          </button>
        </footer>
        </>}
      </section>
    </div>
  );
  const portalHost = document.querySelector(".phone-frame");
  return portalHost ? createPortal(layer, portalHost) : layer;
}
