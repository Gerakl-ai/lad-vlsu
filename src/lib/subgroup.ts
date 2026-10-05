/**
 * Подгруппы: показывать студенту только его половину пары.
 *
 * ВлГУ кладёт занятия двух подгрупп в одну ячейку расписания, разделяя их
 * переводом строки:
 *
 *   428-2, лб, Матвеева А.П., Информационная безопасность
 *   109-3, лб, Аджамиех С.М., Основы backend разработки
 *
 * Приложение склеивало это в одну строку: «Информационная безопасность / Основы
 * backend разработки», аудитория «428-2 / 109-3». Студент физически не может
 * быть в двух аудиториях — половина строки всегда лишняя, и на масштабе
 * университета это системная проблема, а не косметика.
 *
 * Выбор хранится на устройстве и отдельно для каждой группы: у разных групп
 * разное число подгрупп, и общий ключ приводил бы к бессмысленному выбору
 * после смены группы.
 */

import type { LessonSlot, LessonVariant, ScheduleState, WeekMode } from "../types";

/** «Обе» — честный вариант по умолчанию: пока студент не выбрал, мы не угадываем. */
export type SubgroupChoice = "all" | number;

const KEY_PREFIX = "lad.subgroup.v1:";

export function subgroupStorageKey(groupNrec: string) {
  return `${KEY_PREFIX}${groupNrec}`;
}

export function readSubgroup(groupNrec: string | undefined): SubgroupChoice {
  if (!groupNrec) return "all";
  try {
    const raw = localStorage.getItem(subgroupStorageKey(groupNrec));
    if (raw === null || raw === "all") return "all";
    const index = Number.parseInt(raw, 10);
    return Number.isInteger(index) && index >= 0 ? index : "all";
  } catch {
    return "all";
  }
}

export function writeSubgroup(groupNrec: string | undefined, choice: SubgroupChoice) {
  if (!groupNrec) return;
  try {
    localStorage.setItem(subgroupStorageKey(groupNrec), choice === "all" ? "all" : String(choice));
  } catch {
    // Выбор подгруппы — удобство, а не условие работы приложения.
  }
}

export interface LessonView {
  subject: string;
  room?: string;
  kind?: string;
  teacher?: string;
  /** Показана одна подгруппа из нескольких. */
  filtered: boolean;
  /** Сколько подгрупп у пары: 1 означает, что выбирать нечего. */
  subgroupCount: number;
}

function fromVariant(variant: LessonVariant, subgroupCount: number): LessonView {
  return {
    subject: variant.subject,
    room: variant.room,
    kind: variant.kind,
    teacher: variant.teacher,
    filtered: true,
    subgroupCount
  };
}

/**
 * Как показать пару с учётом выбранной подгруппы и недели.
 *
 * Если выбранной подгруппы у конкретной пары нет — например, студент выбрал
 * вторую, а эта пара общая, — показывается склейка целиком. Молча прятать
 * занятие нельзя: пропущенная пара хуже лишней строки.
 */
export function lessonView(lesson: LessonSlot, choice: SubgroupChoice, _weekMode: WeekMode = "all"): LessonView {
  const variants = lesson.variants ?? [];
  const subgroupCount = variants.length;

  const glued: LessonView = {
    subject: lesson.subject,
    room: lesson.room,
    kind: lesson.kind,
    teacher: lesson.teacher,
    filtered: false,
    subgroupCount
  };

  if (choice === "all" || subgroupCount < 2) return glued;
  if (choice >= subgroupCount) return glued;

  // Identical week data does not prove subgroup rotation. Preserve source order.
  const variant = variants[choice];
  return variant ? fromVariant(variant, subgroupCount) : glued;
}

/** Есть ли в дне пары, для которых выбор подгруппы вообще что-то меняет. */
export function hasSubgroups(lessons: LessonSlot[]) {
  return lessons.some((lesson) => (lesson.variants?.length ?? 0) > 1);
}

/** Наибольшее число подгрупп в дне — столько кнопок выбора имеет смысл показать. */
export function maxSubgroupCount(lessons: LessonSlot[]) {
  return lessons.reduce((max, lesson) => Math.max(max, lesson.variants?.length ?? 0), 0);
}

/** Keep verified subgroup order when another source contains the same lessons in a different order. */
export function alignSubgroupOrder(candidate: ScheduleState, reference: ScheduleState): ScheduleState {
  if (candidate.groupNrec !== reference.groupNrec) return candidate;
  const key = (lesson: LessonSlot) => `${lesson.dayIndex}:${lesson.pairIndex}:${lesson.weekMode}:${lesson.date ?? ""}`;
  const referenceLessons = new Map(reference.allLessons.map((lesson) => [key(lesson), lesson]));
  let changed = false;
  const allLessons = candidate.allLessons.map((lesson) => {
    const verified = referenceLessons.get(key(lesson));
    const received = lesson.variants ?? [];
    const expected = verified?.variants ?? [];
    if (received.length < 2 || received.length !== expected.length) return lesson;
    const fingerprints = (variants: LessonVariant[]) => variants.map((variant) => variant.rawText.trim()).sort();
    if (JSON.stringify(fingerprints(received)) !== JSON.stringify(fingerprints(expected))) return lesson;
    if (received.every((variant, index) => variant.rawText.trim() === expected[index].rawText.trim())) return lesson;
    changed = true;
    return {
      ...lesson,
      rawText: verified!.rawText,
      subject: verified!.subject,
      room: verified!.room,
      kind: verified!.kind,
      teacher: verified!.teacher,
      variants: expected,
      id: verified!.id
    };
  });
  return changed ? { ...candidate, allLessons } : candidate;
}
