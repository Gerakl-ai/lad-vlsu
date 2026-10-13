export interface DatedLessonDto {
  type: "DatedLesson";
  date: string;
  start: string;
  end: string;
  name: string;
  scheduleKind?: "classes" | "exam";
}

export function isDatedLesson(value: unknown): value is DatedLessonDto {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (item.type !== "DatedLesson" || typeof item.name !== "string" || !item.name.trim()
    || typeof item.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)
    || typeof item.start !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.start)
    || typeof item.end !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.end)
    || item.start >= item.end
    || (item.scheduleKind !== undefined && item.scheduleKind !== "classes" && item.scheduleKind !== "exam")) return false;
  const date = new Date(`${item.date}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === item.date;
}
