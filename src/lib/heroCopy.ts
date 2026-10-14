/**
 * Что показывать в карточке дня — и, главное, чего не показывать дважды.
 *
 * Экран «Сегодня» набрал четыре блока, пересказывающих одно состояние: на дне с
 * двумя парами слово «пройден» встречалось шесть раз, «08:30» — пять. Читать это
 * тяжело, а выглядит нарядно.
 *
 * Здесь действует одно правило: **каждый факт появляется ровно один раз**.
 * Решение вынесено из разметки в чистую функцию, чтобы правило проверялось
 * тестом, а не глазами при каждой правке.
 */

export type HeroMode = "current" | "next" | "done" | "free" | "loading" | "unconfirmed";

export interface HeroStatus {
  copy: string;
  /** Точка «в эфире»: имеет смысл только пока пара действительно идёт. */
  live: boolean;
}

export interface HeroCopy {
  sigilLabel: string;
  sigilValue: string;
  /** Плашка состояния. Отсутствует, когда заголовок уже сказал то же самое. */
  status?: HeroStatus;
  /** Строка под прогрессом. Отсутствует, когда добавить нечего. */
  progressTitle?: string;
  /** Прогресс-строка целиком: скрыта, когда сигил и заголовок уже всё сказали. */
  showProgressRow: boolean;
}

export interface HeroCopyInput {
  mode: HeroMode;
  isSelectedToday: boolean;
  /** Процент прохождения текущей пары. */
  lessonProgress: number;
  minutesToNext: number;
  minutesRemaining: number;
  nextStart?: string;
  completedCount: number;
  lessonCount: number;
  nextStudyDayLabel?: string;
  hasLoadedLessons: boolean;
  formatDuration: (minutes: number) => string;
}

export function heroCopy(input: HeroCopyInput): HeroCopy {
  const {
    mode,
    isSelectedToday,
    lessonProgress,
    minutesToNext,
    minutesRemaining,
    nextStart,
    completedCount,
    lessonCount,
    nextStudyDayLabel,
    hasLoadedLessons,
    formatDuration
  } = input;

  switch (mode) {
    case "unconfirmed":
      return { sigilLabel: "Начало", sigilValue: nextStart ?? "...", showProgressRow: false };
    case "current":
      // Идущая пара — единственный случай, когда плашка «в эфире» что-то добавляет.
      return {
        sigilLabel: "Прошло",
        sigilValue: `${lessonProgress}%`,
        status: { copy: "Пара идёт", live: true },
        progressTitle: `${minutesRemaining} мин осталось`,
        showProgressRow: true
      };

    case "next":
      // Сигил показывает, сколько ждать; строка прогресса — во сколько начало.
      // Для другого дня «сколько ждать» смысла не имеет, и сигил берёт время.
      return isSelectedToday
        ? {
            sigilLabel: "Через",
            sigilValue: formatDuration(minutesToNext),
            progressTitle: nextStart ? `Начало в ${nextStart}` : undefined,
            showProgressRow: Boolean(nextStart)
          }
        : {
            sigilLabel: "Старт",
            sigilValue: nextStart ?? "—",
            showProgressRow: false
          };

    case "done":
      // «Готово 2/2» и заголовок «Все пары пройдены» уже говорят всё.
      // Третья формулировка про закрытый день была лишней.
      return {
        sigilLabel: "Готово",
        sigilValue: `${completedCount}/${lessonCount}`,
        showProgressRow: false
      };

    case "free":
      // Единственное, что стоит сказать про свободный день, — когда следующий.
      return {
        sigilLabel: "Свободно",
        sigilValue: "0 пар",
        progressTitle: nextStudyDayLabel ? `Дальше: ${nextStudyDayLabel}` : undefined,
        showProgressRow: Boolean(nextStudyDayLabel)
      };

    default:
      return {
        sigilLabel: "ВлГУ",
        sigilValue: "...",
        status: { copy: hasLoadedLessons ? "Данные готовы" : "Ждём ВлГУ", live: false },
        showProgressRow: false
      };
  }
}

/**
 * Все строки, которые карточка выведет на экран. Нужно тесту, который следит,
 * чтобы среди них не было повторов.
 */
export function heroCopyStrings(copy: HeroCopy, heading: string): string[] {
  return [
    `${copy.sigilLabel} ${copy.sigilValue}`,
    copy.status?.copy,
    heading,
    copy.showProgressRow ? copy.progressTitle : undefined
  ].filter((value): value is string => Boolean(value));
}
