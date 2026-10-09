import { CalendarDays, ChevronRight, ExternalLink } from "lucide-react";
import { groupStudyCalendar, studyPeriodRange, studyPeriodTitle, visibleStudyPeriods } from "../../lib/studyPeriods";

export function StudyCalendarPanel({ groupNrec, selectedDateKey, onOpenDate }: {
  groupNrec?: string;
  selectedDateKey: string;
  onOpenDate: (date: string) => void;
}) {
  const calendar = groupStudyCalendar(groupNrec);
  if (!calendar) return null;
  return (
    <section className="study-calendar-panel" aria-label="Учебный календарь">
      <header><h2><CalendarDays size={19} /> Учебный календарь</h2><span>{calendar.academicYear}</span></header>
      <p>Даты сессий и практик опубликованы. Предметы и время занятий пока уточняются.</p>
      <div className="study-period-list">
        {visibleStudyPeriods(calendar.periods, selectedDateKey).map((period) => (
          <button type="button" key={`${period.kind}:${period.start}`} onClick={() => onOpenDate(period.start)}
            className={period.start <= selectedDateKey && period.end >= selectedDateKey ? "active" : ""}>
            <span><strong>{studyPeriodTitle(period.kind)}</strong><small>{studyPeriodRange(period)}</small></span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        ))}
      </div>
      <a href={calendar.sourceUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} /> График ВлГУ</a>
    </section>
  );
}
