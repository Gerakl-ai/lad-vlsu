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
  if (candidate.groupNrec !== reference.groupNrec
    || candidate.currentInfo?.semester !== reference.currentInfo?.semester) return candidate;
  const key = (lesson: LessonSlot) => `${lesson.dayIndex}:${lesson.pairIndex}:${lesson.weekMode}:${lesson.date ?? ""}`;
  const slotKey = (lesson: LessonSlot) => `${lesson.dayIndex}:${lesson.pairIndex}:${lesson.date ?? ""}`;
  const referenceLessons = new Map(reference.allLessons.map((lesson) => [key(lesson), lesson]));
  const referenceBySlot = new Map<string, LessonSlot[]>();
  for (const lesson of reference.allLessons) {
    const slot = slotKey(lesson);
    referenceBySlot.set(slot, [...(referenceBySlot.get(slot) ?? []), lesson]);
  }
  const candidateSlotCounts = new Map<string, number>();
  for (const lesson of candidate.allLessons) {
    const slot = slotKey(lesson);
    candidateSlotCounts.set(slot, (candidateSlotCounts.get(slot) ?? 0) + 1);
  }
  const fingerprints = (variants: LessonVariant[]) => variants.map((variant) => variant.rawText.trim()).sort();
  const sameVariants = (left: LessonVariant[], right: LessonVariant[]) =>
    left.length >= 2 && left.length === right.length
      && JSON.stringify(fingerprints(left)) === JSON.stringify(fingerprints(right));
  let changed = false;
  const allLessons = candidate.allLessons.flatMap((lesson) => {
    if (lesson.weekMode === "all" && candidateSlotCounts.get(slotKey(lesson)) === 1) {
      const split = referenceBySlot.get(slotKey(lesson)) ?? [];
      const numerator = split.find((item) => item.weekMode === "numerator");
      const denominator = split.find((item) => item.weekMode === "denominator");
      if (split.length === 2 && numerator && denominator
        && sameVariants(lesson.variants ?? [], numerator.variants ?? [])
        && sameVariants(lesson.variants ?? [], denominator.variants ?? [])) {
        changed = true;
        return [numerator, denominator];
      }
    }
    const verified = referenceLessons.get(key(lesson));
    const received = lesson.variants ?? [];
    const expected = verified?.variants ?? [];
    if (!sameVariants(received, expected)) return [lesson];
    if (received.every((variant, index) => variant.rawText.trim() === expected[index].rawText.trim())) return [lesson];
    changed = true;
    return [{
      ...lesson,
      rawText: verified!.rawText,
      subject: verified!.subject,
      room: verified!.room,
      kind: verified!.kind,
      teacher: verified!.teacher,
      variants: expected,
      id: verified!.id
    }];
  });
  return changed ? { ...candidate, allLessons } : candidate;
}

const PI124_2026_AUTUMN_ORDER = [
  { dayIndex: 2, weekMode: "numerator", first: "архитектуры и интеграции" },
  { dayIndex: 2, weekMode: "denominator", first: "искусственного интеллекта" },
  { dayIndex: 5, weekMode: "numerator", first: "Информационная безопасность" },
  { dayIndex: 5, weekMode: "denominator", first: "backend" }
] as const;

/** Verified autumn 2026 assignments survive an offline launch with an older device cache. */
export function correctVerifiedSubgroups(state: ScheduleState): ScheduleState {
  if (state.groupNrec !== "7936a2a43b11b20b01d30f5b00c73166"
    || state.currentInfo.semester !== 5
    || state.fetchedAt < "2026-08-01" || state.fetchedAt >= "2027-01-01") return state;
  let changed = false;
  const allLessons = state.allLessons.flatMap((lesson) => {
    if (lesson.pairIndex !== 1 || lesson.variants?.length !== 2) return [lesson];
    if (lesson.weekMode === "all") {
      const rules = PI124_2026_AUTUMN_ORDER.filter((item) => item.dayIndex === lesson.dayIndex);
      if (rules.length === 2 && rules.every((rule) => lesson.variants!.some((variant) =>
        variant.subject.toLowerCase().includes(rule.first.toLowerCase())))) {
        changed = true;
        return rules.map((rule) => {
          const variants = [
            ...lesson.variants!.filter((variant) => variant.subject.toLowerCase().includes(rule.first.toLowerCase())),
            ...lesson.variants!.filter((variant) => !variant.subject.toLowerCase().includes(rule.first.toLowerCase()))
          ];
          const rawText = variants.map((variant) => variant.rawText).join("\n");
          return {
            ...lesson,
            weekMode: rule.weekMode,
            id: `${lesson.dayIndex}-${lesson.pairIndex}-${rule.weekMode}-${rawText}`,
            rawText,
            variants,
            subject: variants.map((variant) => variant.subject).join(" / "),
            room: variants.map((variant) => variant.room).filter(Boolean).join(" / "),
            kind: variants.map((variant) => variant.kind).filter(Boolean).join(" / "),
            teacher: variants.map((variant) => variant.teacher).filter(Boolean).join(" / ")
          };
        });
      }
    }
    const rule = PI124_2026_AUTUMN_ORDER.find((item) => item.dayIndex === lesson.dayIndex && item.weekMode === lesson.weekMode);
    if (!rule) return [lesson];
    const first = lesson.variants.find((variant) => variant.subject.toLowerCase().includes(rule.first.toLowerCase()));
    if (!first || first === lesson.variants[0]) return [lesson];
    const variants = [first, ...lesson.variants.filter((variant) => variant !== first)];
    const unique = (field: "subject" | "room" | "kind" | "teacher") =>
      [...new Set(variants.map((variant) => variant[field]).filter((value): value is string => Boolean(value)))].join(" / ") || undefined;
    const rawText = variants.map((variant) => variant.rawText).join("\n");
    changed = true;
    return [{
      ...lesson,
      id: `${lesson.dayIndex}-${lesson.pairIndex}-${lesson.weekMode}-${rawText}`,
      rawText,
      variants,
      subject: unique("subject") ?? lesson.subject,
      room: unique("room"),
      kind: unique("kind"),
      teacher: unique("teacher")
    }];
  });
  return changed ? { ...state, allLessons } : state;
}
