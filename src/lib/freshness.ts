/**
 * Насколько свежо расписание — и когда об этом обязательно надо сказать вслух.
 *
 * 18 сентября 2026 в проде лежал снимок от 8 сентября: эндпоинт расписания ВлГУ
 * отвечал пустотой, защита не давала перезаписать хорошие данные плохими, и
 * приложение уверенно показывало расписание десятидневной давности. Возраст был
 * известен приложению, но виден только мелкой строкой «Обновлено 08.09».
 *
 * Тихо протухшие данные хуже, чем их отсутствие: студент не знает, что смотрит
 * архив, и приходит не на ту пару.
 */

import type { ScheduleState } from "../types";

export type FreshnessLevel = "fresh" | "aging" | "stale";

export interface FreshnessNotice {
  level: FreshnessLevel;
  /** Показывать полосу предупреждения. */
  warn: boolean;
  title: string;
  detail: string;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Сутки — расписание живёт по дням, и разница внутри дня не меняет решений. */
export const AGING_AFTER_MS = DAY;
/** Трое суток — за это время успевают смениться замены и появиться новая неделя. */
export const STALE_AFTER_MS = 3 * DAY;

export function preferNewerSchedule(existing: ScheduleState | null, incoming: ScheduleState): ScheduleState {
  if (!existing || existing.groupNrec !== incoming.groupNrec) return incoming;
  const existingAt = Date.parse(existing.fetchedAt);
  const incomingAt = Date.parse(incoming.fetchedAt);
  return Number.isFinite(existingAt) && (!Number.isFinite(incomingAt) || existingAt > incomingAt)
    ? existing
    : incoming;
}

function formatAge(ageMs: number) {
  if (ageMs < HOUR) return "меньше часа";
  if (ageMs < DAY) {
    const hours = Math.floor(ageMs / HOUR);
    return `${hours} ${plural(hours, "час", "часа", "часов")}`;
  }
  const days = Math.floor(ageMs / DAY);
  return `${days} ${plural(days, "день", "дня", "дней")}`;
}

function plural(value: number, one: string, few: string, many: string) {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = value % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date(timestamp));
}

export function freshnessNotice(fetchedAt: string | undefined, now = Date.now()): FreshnessNotice | null {
  if (!fetchedAt) return null;
  const captured = Date.parse(fetchedAt);
  if (Number.isNaN(captured)) return null;

  const ageMs = Math.max(0, now - captured);

  if (ageMs < AGING_AFTER_MS) {
    return { level: "fresh", warn: false, title: "", detail: "" };
  }

  const age = formatAge(ageMs);
  const date = formatDate(captured);

  // Одна короткая строка вместо блока из двух предложений: сказать о возрасте
  // нужно, но это не повод занимать четверть экрана и пугать формулировками.
  // Человеку важна дата, а не то, какой сервис не ответил.
  if (ageMs < STALE_AFTER_MS) {
    return {
      level: "aging",
      warn: true,
      title: `Расписание от ${date}`,
      detail: ""
    };
  }

  return {
    level: "stale",
    warn: true,
    title: `Расписание от ${date}`,
    detail: `это ${age} назад — стоит свериться с ВлГУ`
  };
}
