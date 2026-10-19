import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeftRight, CalendarDays, ChevronLeft, ChevronRight, Clock3, GitCompareArrows, MapPin, RefreshCw, UsersRound, Video, X } from "lucide-react";
import type { ScheduleState } from "../../types";
import { loadSchedule, normalizeCachedSchedule } from "../../lib/scheduleApi";
import { preferNewerSchedule, scheduleNotice } from "../../lib/freshness";
import { addDays, dateForWeekDay, dateKeyFromDate, formatUpdatedAt, formatWeekMode, lessonTimeLabel, relativeDayLabel } from "../../lib/time";
import { readLessonSelections, selectedLessonVariant } from "../../lib/lessonSelection";
import { lessonChangeMessage } from "../../lib/lessonChange";
import { readGroupScheduleCache } from "./groupStorage";
import type { GroupProfile } from "./groupTypes";
import { GroupPickerSheet } from "./GroupPickerSheet";
import { readComparisonGroup, writeComparisonGroup } from "./comparisonStorage";
import { compareDayRows, compareScheduleDays, comparisonDay, comparisonLessonCount, COMPARISON_RANGE, type ComparisonChoice, type ComparisonDay, type ComparisonMatch } from "./scheduleComparison";
import "./comparison.css";

interface Props {
  group: GroupProfile;
  schedule: ScheduleState | null;
  initialDate: Date;
  getLessonChoice: ComparisonChoice;
  onClose: () => void;
}
type Loaded = { nrec: string; schedule: ScheduleState | null; status: "loading" | "ready" | "offline" | "error" };
const MATCH_LABELS: Record<ComparisonMatch, string> = {
  "same-subject": "Один предмет", "same-room": "Одна аудитория", "same-building": "Один корпус",
  different: "Разные пары", "one-sided": "Пара у одной группы", uncertain: "Нужно уточнить"
};

function savedSchedule(group: GroupProfile | null) {
  return group ? normalizeCachedSchedule(readGroupScheduleCache(group)) : null;
}

function dayStatus(day: ComparisonDay, loading: boolean) {
  if (day.availability === "missing") return loading ? "Получаем расписание" : "Расписание недоступно";
  if (day.availability === "outside-period") return "Нет данных на эту дату";
  return day.lessons.length ? comparisonLessonCount(day.lessons.length) : "Без занятий";
}

function ComparisonColumn({ group, state, day, date, overlaps, loading = false }: {
  group: GroupProfile; state: ScheduleState | null; day: ComparisonDay; date: Date; overlaps: Set<string>; loading?: boolean;
}) {
  const notice = scheduleNotice(state);
  return <section className="comparison-column" aria-label={`Расписание ${group.name}`}>
    <header>
      <span>{group.instituteShortName}</span>
      <h3>{group.name}</h3>
      <p>{dayStatus(day, loading)}</p>
      {state && <small className={notice?.warn ? "comparison-stale" : ""}>
        {notice?.warn ? notice.title : `Обновлено ${formatUpdatedAt(state.fetchedAt)}`}
      </small>}
    </header>
    <div className="comparison-lessons">
      {day.lessons.map((lesson) => {
        const multiple = (lesson.variants?.length ?? 0) > 1;
        const change = lessonChangeMessage(group.nrec, dateKeyFromDate(date), lesson, multiple ? "all" : 0);
        return <article key={lesson.id} className={`comparison-lesson${overlaps.has(lesson.id) ? " overlaps" : ""}`}>
        <time>{lessonTimeLabel(lesson)}</time>
        <h4>{lesson.subject}</h4>
        {change && !multiple ? <p><Video size={13} aria-hidden="true" />Дистант</p>
          : lesson.room && <p><MapPin size={13} aria-hidden="true" />{lesson.room}</p>}
        {change && <p className="comparison-change">{change}</p>}
        {(lesson.kind || lesson.teacher) && <small>{[lesson.kind, lesson.teacher].filter(Boolean).join(" · ")}</small>}
        {overlaps.has(lesson.id) && <span className="comparison-overlap-label"><ArrowLeftRight size={12} aria-hidden="true" />Пересечение</span>}
      </article>;
      })}
      {!day.lessons.length && <p className="comparison-empty">{day.availability === "ready" ? "По расписанию день свободен" : dayStatus(day, loading)}</p>}
    </div>
  </section>;
}

function WeekLesson({ lessons }: { lessons: ComparisonDay["lessons"] }) {
  if (!lessons.length) return <p className="comparison-week-empty">Нет пары</p>;
  return <div className="comparison-week-lessons">{lessons.map((lesson) => <div key={lesson.id}>
    <strong>{lesson.subject}</strong>
    {(lesson.room || lesson.teacher) && <small>{[lesson.room, lesson.teacher].filter(Boolean).join(" · ")}</small>}
    {(lesson.variants?.length ?? 0) > 1 && <small>Варианты: {lesson.variants!.map((variant) => variant.subject).join(" / ")}</small>}
  </div>)}</div>;
}

export function ScheduleComparisonSheet({ group, schedule, initialDate, getLessonChoice, onClose }: Props) {
  const [secondGroup, setSecondGroup] = useState<GroupProfile | null>(() => {
    const saved = readComparisonGroup();
    return saved?.nrec === group.nrec ? null : saved;
  });
  const [date, setDate] = useState(() => new Date(initialDate));
  const [view, setView] = useState<"day" | "week">("week");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(() => secondGroup
    ? { nrec: secondGroup.nrec, schedule: savedSchedule(secondGroup), status: "loading" } : null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!secondGroup) return;
    let cancelled = false;
    const cached = savedSchedule(secondGroup);
    setLoaded({ nrec: secondGroup.nrec, schedule: cached, status: navigator.onLine ? "loading" : cached ? "offline" : "error" });
    if (navigator.onLine) {
      void loadSchedule(secondGroup, Boolean(cached)).then((incoming) => {
        if (cancelled || incoming.groupNrec !== secondGroup.nrec) return;
        setLoaded({ nrec: secondGroup.nrec, schedule: preferNewerSchedule(cached, incoming), status: "ready" });
      }).catch(() => {
        if (!cancelled) setLoaded({ nrec: secondGroup.nrec, schedule: cached, status: cached ? "offline" : "error" });
      });
    }
    return () => { cancelled = true; };
  }, [secondGroup, attempt]);

  useEffect(() => {
    const refresh = () => setAttempt((value) => value + 1);
    window.addEventListener("online", refresh);
    return () => window.removeEventListener("online", refresh);
  }, []);

  useEffect(() => {
    const previous = document.querySelector<HTMLButtonElement>(".week-compare-button") ?? document.activeElement;
    const dialog = dialogRef.current;
    dialogRef.current?.focus();
    return () => { requestAnimationFrame(() => {
      if (!dialog?.isConnected && previous instanceof HTMLElement && previous.isConnected) previous.focus();
    }); };
  }, []);

  useEffect(() => {
    if (pickerOpen) return;
    const focusFrame = requestAnimationFrame(() => dialogRef.current?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== "Tab") return;
      const buttons = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input, [tabindex="0"]') ?? [])]
        .filter((element) => element.getClientRects().length);
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (!first || !last) return;
      const inside = dialogRef.current?.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || !inside || document.activeElement === dialogRef.current)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !inside || document.activeElement === dialogRef.current)) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => { cancelAnimationFrame(focusFrame); document.removeEventListener("keydown", keydown); };
  }, [pickerOpen]);

  const secondState = loaded?.nrec === secondGroup?.nrec ? loaded?.schedule ?? null : savedSchedule(secondGroup);
  const secondarySelections = useMemo(() => readLessonSelections(secondState?.groupNrec, secondState?.currentInfo.semester), [secondState]);
  const left = useMemo(() => comparisonDay(schedule, date, getLessonChoice), [schedule, date, getLessonChoice]);
  const right = useMemo(() => comparisonDay(secondState, date, (lesson, mode) => {
    const opposite = mode === "numerator" ? "denominator" : "numerator";
    const counterpart = secondState?.allLessons.find((item) => item.weekMode === opposite && item.dayIndex === lesson.dayIndex
      && item.pairIndex === lesson.pairIndex && item.start === lesson.start);
    return selectedLessonVariant(lesson, mode, secondarySelections, counterpart);
  }), [secondState, date, secondarySelections]);
  const result = useMemo(() => compareScheduleDays(left, right), [left, right]);
  const weekDays = useMemo(() => Array.from({ length: 6 }, (_, index) => {
    const dayDate = dateForWeekDay(index + 1, date);
    const first = comparisonDay(schedule, dayDate, getLessonChoice);
    const second = comparisonDay(secondState, dayDate, (lesson, mode) => {
      const opposite = mode === "numerator" ? "denominator" : "numerator";
      const counterpart = secondState?.allLessons.find((item) => item.weekMode === opposite && item.dayIndex === lesson.dayIndex
        && item.pairIndex === lesson.pairIndex && item.start === lesson.start);
      return selectedLessonVariant(lesson, mode, secondarySelections, counterpart);
    });
    return { date: dayDate, left: first, right: second, rows: compareDayRows(first, second) };
  }), [date, schedule, getLessonChoice, secondState, secondarySelections]);
  const secondLoading = loaded?.nrec === secondGroup?.nrec && loaded?.status === "loading";
  const chooseGroup = (selected: GroupProfile) => {
    if (selected.nrec === group.nrec) return;
    setSecondGroup(selected);
    writeComparisonGroup(selected);
    setPickerOpen(false);
  };

  return createPortal(<>
    <div className="comparison-backdrop" data-screen-swipe="ignore">
      <section className="comparison-sheet" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="comparison-title" inert={pickerOpen || undefined}>
        <header className="comparison-header">
          <GitCompareArrows size={23} aria-hidden="true" />
          <div><small>Расписание</small><h2 id="comparison-title">Сравнить группы</h2></div>
          <button type="button" className="comparison-icon" onClick={onClose} aria-label="Закрыть сравнение" title="Закрыть"><X size={21} /></button>
        </header>
        <div className="comparison-controls">
          <div className="comparison-groups">
            <span><UsersRound size={17} aria-hidden="true" />{group.name}</span>
            <ArrowLeftRight size={18} aria-hidden="true" />
            <button type="button" onClick={() => setPickerOpen(true)} aria-label="Выбрать вторую группу">
              {secondGroup?.name ?? "Выбрать группу"}<ChevronRight size={17} aria-hidden="true" />
            </button>
          </div>
          <div className="comparison-view" role="group" aria-label="Период сравнения">
            <button type="button" aria-pressed={view === "day"} onClick={() => setView("day")}>День</button>
            <button type="button" aria-pressed={view === "week"} onClick={() => setView("week")}>Неделя</button>
          </div>
          <div className="comparison-date">
            <button type="button" className="comparison-icon" onClick={() => setDate(addDays(date, view === "week" ? -7 : -1))} aria-label={view === "week" ? "Предыдущая неделя" : "Предыдущий день"} title="Назад"><ChevronLeft size={20} /></button>
            <label><CalendarDays size={17} aria-hidden="true" /><input aria-label="Дата сравнения" type="date" value={dateKeyFromDate(date)} onChange={(event) => {
              if (event.target.value) setDate(new Date(`${event.target.value}T12:00:00`));
            }} /></label>
            <button type="button" className="comparison-icon" onClick={() => setDate(addDays(date, view === "week" ? 7 : 1))} aria-label={view === "week" ? "Следующая неделя" : "Следующий день"} title="Вперёд"><ChevronRight size={20} /></button>
          </div>
          <div className="comparison-day-label"><span>{view === "week"
            ? `${weekDays[0].date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })} - ${weekDays[5].date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}`
            : `${relativeDayLabel(date)} · ${date.toLocaleDateString("ru-RU", { weekday: "long" })}`}</span>
            {dateKeyFromDate(date) !== dateKeyFromDate() && <button type="button" onClick={() => setDate(new Date())}>Сегодня</button>}
          </div>
        </div>
        <div className="comparison-scroll" tabIndex={0} aria-label="Результат сравнения">
          {!secondGroup ? <div className="comparison-start"><UsersRound size={36} aria-hidden="true" /><h3>С кем сравним?</h3>
            <button type="button" onClick={() => setPickerOpen(true)}>Выбрать вторую группу<ChevronRight size={18} aria-hidden="true" /></button></div>
          : view === "week" ? <div className="comparison-week" aria-label="Сравнение расписаний на неделю">
            <div className="comparison-week-head"><span>Пара</span><strong>{group.name}</strong><strong>{secondGroup.name}</strong></div>
            {weekDays.map((day) => <section key={dateKeyFromDate(day.date)} className="comparison-week-day">
              <h3>{day.date.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" })}
                <span>{day.left.weekMode && formatWeekMode(day.left.weekMode)}</span></h3>
              {day.left.availability !== "ready" || day.right.availability !== "ready"
                ? <p className="comparison-week-unavailable">{secondLoading && day.right.availability === "missing" ? "Загружаем вторую группу" : "Недостаточно данных для сравнения"}</p>
                : day.rows.length ? day.rows.map((row) => <div className="comparison-week-row" key={row.key}>
                  <div className="comparison-week-time"><strong>{row.pairIndex > 0 ? `${row.pairIndex} пара` : "Событие"}</strong><time>{row.start}</time>
                    {(row.left[0]?.end ?? row.right[0]?.end) && <time>{row.left[0]?.end ?? row.right[0]?.end}</time>}</div>
                  <WeekLesson lessons={row.left} /><WeekLesson lessons={row.right} />
                  <span className={`comparison-week-match is-${row.match}`}>{MATCH_LABELS[row.match]}</span>
                </div>) : <p className="comparison-week-unavailable">У обеих групп занятий нет</p>}
            </section>)}
          </div> : <>
            <section className="comparison-windows" aria-label="Общие свободные окна">
              <h3><Clock3 size={17} aria-hidden="true" />Общие свободные окна</h3>
              <p>По расписаниям · {COMPARISON_RANGE.start}-{COMPARISON_RANGE.end} · от 20 минут</p>
              {result.windows === null ? <p className="comparison-caution" role="status">{result.reason === "unconfirmed"
                ? "Время некоторых занятий уточняется. Точные окна пока не рассчитаны."
                : secondLoading ? "Проверяем расписание второй группы" : "Для расчёта нужны данные обеих групп на эту дату."}</p>
              : result.windows.length ? <ul>{result.windows.map((window) => <li key={window.start}><time>{window.start}-{window.end}</time><span>{window.minutes} мин</span></li>)}</ul>
              : <p className="comparison-caution">Общих окон от 20 минут нет</p>}
            </section>
            <div className="comparison-columns">
              <ComparisonColumn group={group} state={schedule} day={left} date={date} overlaps={result.leftOverlaps} />
              <ComparisonColumn group={secondGroup} state={secondState} day={right} date={date} overlaps={result.rightOverlaps} loading={secondLoading} />
            </div>
          </>}
        </div>
        <footer className="comparison-footer">
          <span>{secondGroup ? loaded?.status === "offline" ? "Сохранённое расписание" : loaded?.status === "error" ? "Вторая группа не загрузилась" : [left.weekMode && formatWeekMode(left.weekMode), right.weekMode !== left.weekMode && right.weekMode && `${secondGroup.name}: ${formatWeekMode(right.weekMode)}`].filter(Boolean).join(" · ") : "Любой институт ВлГУ"}</span>
          {secondGroup && <button type="button" className="comparison-icon" onClick={() => setAttempt((value) => value + 1)} disabled={secondLoading} aria-label="Обновить вторую группу" title="Обновить"><RefreshCw size={18} /></button>}
        </footer>
      </section>
    </div>
    <GroupPickerSheet open={pickerOpen} selectedGroup={secondGroup ?? group} onClose={() => setPickerOpen(false)} onSelect={chooseGroup} purpose="comparison" excludedGroupNrec={group.nrec} />
  </>, document.body);
}
