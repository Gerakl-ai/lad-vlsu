import { beforeEach, describe, expect, it } from "vitest";
import { normalizeSchedule, parseLessonText } from "./scheduleApi";
import s424Snapshot from "../../public/data/schedule/0107a80d5bdd182f4b2609a637266fb7.json";
import pi124Snapshot from "../../public/data/schedule/7936a2a43b11b20b01d30f5b00c73166.json";
import ib125Snapshot from "../../public/data/schedule/05f189c025a7ea913397401598195430.json";
import { lessonWithSelectedVariant, readLessonSelections, selectedLessonVariant, setLessonSelection, writeLessonSelections } from "./lessonSelection";
import type { LessonSlot } from "../types";

const ai = "109-3, лб, Васильев Д.Н., Основы искусственного интеллекта";
const architecture = "111-3, лб, Аджамиех С.М., Основы архитектуры и интеграции информационных систем";
const security = "428-2, лб, Матвеева А.П., Информационная безопасность";
const backend = "109-3, лб, Аджамиех С.М., Основы backend разработки";
const group = "7936a2a43b11b20b01d30f5b00c73166";

function lesson(dayIndex: number, rawText: string): LessonSlot {
  return {
    id: `${dayIndex}-1-all`, dayIndex, dayName: dayIndex === 2 ? "Вторник" : "Пятница",
    pairIndex: 1, start: "08:30", end: "10:00", weekMode: "all", rawText,
    ...parseLessonText(rawText)
  };
}

describe("выбор конкретной пары", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key)
    } as Storage;
  });

  it("выбирает предмет вторника и меняет его на другой в следующую неделю", () => {
    const tuesday = lesson(2, `${architecture}\n${ai}`);
    const choices = setLessonSelection({}, tuesday, "denominator", 1);
    expect(selectedLessonVariant(tuesday, "denominator", choices)).toBe(1);
    expect(selectedLessonVariant(tuesday, "numerator", choices)).toBe(0);
    expect(lessonWithSelectedVariant(tuesday, 1).subject).toContain("искусственного интеллекта");
    writeLessonSelections(group, 5, choices);
    expect(selectedLessonVariant(tuesday, "denominator", readLessonSelections(group, 5))).toBe(1);
  });

  it("без старого номера подгруппы показывает первые варианты каждой проверенной недели ПИ-124", () => {
    const lessons = normalizeSchedule(pi124Snapshot.schedule as Parameters<typeof normalizeSchedule>[0]);
    const bySlot = (dayIndex: number, weekMode: "numerator" | "denominator") => {
      const found = lessons.find((item) => item.dayIndex === dayIndex && item.pairIndex === 1 && item.weekMode === weekMode);
      if (!found) throw new Error(`Missing ${dayIndex} ${weekMode}`);
      return found;
    };
    const tuesday6 = bySlot(2, "denominator");
    const tuesday13 = bySlot(2, "numerator");
    const friday9 = bySlot(5, "denominator");
    const friday16 = bySlot(5, "numerator");
    expect(lessonWithSelectedVariant(tuesday6, selectedLessonVariant(tuesday6, "denominator", {}, tuesday13)).subject).toContain("искусственного интеллекта");
    expect(lessonWithSelectedVariant(tuesday13, selectedLessonVariant(tuesday13, "numerator", {}, tuesday6)).subject).toContain("архитектуры");
    expect(lessonWithSelectedVariant(friday9, selectedLessonVariant(friday9, "denominator", {}, friday16)).subject).toContain("backend");
    expect(lessonWithSelectedVariant(friday16, selectedLessonVariant(friday16, "numerator", {}, friday9)).subject).toContain("безопасность");
  });

  it("применяет тот же выбор по предмету к другим группам", () => {
    const lessons = normalizeSchedule(ib125Snapshot.schedule as Parameters<typeof normalizeSchedule>[0]);
    const numerator = lessons.find((item) => item.dayIndex === 3 && item.pairIndex === 4 && item.weekMode === "numerator");
    const denominator = lessons.find((item) => item.dayIndex === 3 && item.pairIndex === 4 && item.weekMode === "denominator");
    if (!numerator || !denominator) throw new Error("ИБ-125: missing Wednesday pair");
    expect(selectedLessonVariant(numerator, "numerator", {}, denominator)).toBe(0);
    expect(selectedLessonVariant(denominator, "denominator", {}, numerator)).toBe(0);
    const choices = setLessonSelection({}, numerator, "numerator", 1);
    expect(selectedLessonVariant(numerator, "numerator", choices, denominator)).toBe(1);
    expect(selectedLessonVariant(denominator, "denominator", choices, numerator)).toBe(1);
  });

  it("на реальном порядке ПИ-124 показывает ИИ 6-го и архитектуру 13-го, а в пятницу backend затем ИБ", () => {
    const tuesdayDenominator = lesson(2, `${ai}\n${architecture}`);
    const tuesdayNumerator = lesson(2, `${architecture}\n${ai}`);
    const fridayDenominator = lesson(5, `${backend}\n${security}`);
    const fridayNumerator = lesson(5, `${security}\n${backend}`);
    let choices = setLessonSelection({}, tuesdayDenominator, "denominator", 0);
    choices = setLessonSelection(choices, fridayDenominator, "denominator", 0);
    expect(lessonWithSelectedVariant(tuesdayDenominator, selectedLessonVariant(tuesdayDenominator, "denominator", choices)).subject).toContain("искусственного интеллекта");
    expect(lessonWithSelectedVariant(tuesdayNumerator, selectedLessonVariant(tuesdayNumerator, "numerator", choices, tuesdayDenominator)).subject).toContain("архитектуры");
    expect(lessonWithSelectedVariant(fridayDenominator, selectedLessonVariant(fridayDenominator, "denominator", choices)).subject).toContain("backend");
    expect(lessonWithSelectedVariant(fridayNumerator, selectedLessonVariant(fridayNumerator, "numerator", choices, fridayDenominator)).subject).toContain("безопасность");
  });

  it("пятница выбирается независимо от вторника и допускает собственное правило", () => {
    const tuesday = lesson(2, `${architecture}\n${ai}`);
    const friday = lesson(5, `${security}\n${backend}`);
    let choices = setLessonSelection({}, tuesday, "denominator", 1);
    choices = setLessonSelection(choices, friday, "denominator", 1);
    expect(selectedLessonVariant(friday, "denominator", choices)).toBe(1);
    expect(selectedLessonVariant(friday, "numerator", choices)).toBe(0);
    choices = setLessonSelection(choices, friday, "numerator", 1);
    expect(selectedLessonVariant(friday, "numerator", choices)).toBe(1);
    expect(selectedLessonVariant(tuesday, "numerator", choices)).toBe(0);
  });

  it("не угадывает выбор для другой группы и не чередует три варианта", () => {
    const tuesday = lesson(2, `${architecture}\n${ai}`);
    expect(selectedLessonVariant(tuesday, "denominator", {})).toBe("all");
    const three = lesson(2, `${architecture}\n${ai}\n${backend}`);
    const choices = setLessonSelection({}, three, "denominator", 1);
    expect(selectedLessonVariant(three, "numerator", choices)).toBe("all");
    const selected = setLessonSelection({}, tuesday, "denominator", 1);
    writeLessonSelections("other-group", 3, selected);
    expect(readLessonSelections("other-group", 3)).toEqual(selected);
    expect(readLessonSelections("another-group", 3)).toEqual({});
  });

  it("для другой группы чередует только проверенную перестановку двух одинаковых предметов", () => {
    const numerator = lesson(2, `${architecture}\n${ai}`);
    const denominator = lesson(2, `${ai}\n${architecture}`);
    const sameOrder = lesson(2, `${architecture}\n${ai}`);
    const changed = lesson(2, `${backend}\n${ai}`);
    const choices = setLessonSelection({}, numerator, "numerator", 0);
    expect(selectedLessonVariant(denominator, "denominator", choices, numerator)).toBe(0);
    expect(selectedLessonVariant(sameOrder, "denominator", choices, numerator)).toBe(1);
    expect(selectedLessonVariant(changed, "denominator", choices, numerator)).toBe("all");
  });

  it("не подменяет гидрологию строительством у С-424 при переходе на другую неделю", () => {
    const snapshot = s424Snapshot;
    const monday = snapshot.schedule.find((day) => day.name === "Понедельник");
    if (!monday) throw new Error("Monday is missing");
    const numerator = lesson(1, monday.n3);
    const denominator = lesson(1, monday.z3);
    const choices = setLessonSelection({}, numerator, "numerator", 0);
    expect(selectedLessonVariant(denominator, "denominator", choices, numerator)).toBe("all");
  });

  it("не переносит старый выбор подгруппы, а ручной выбор имеет приоритет", () => {
    const tuesday = lesson(2, `${architecture}\n${ai}`);
    expect(selectedLessonVariant(tuesday, "denominator", {})).toBe("all");
    const choices = setLessonSelection({}, tuesday, "denominator", 0);
    expect(selectedLessonVariant(tuesday, "denominator", choices)).toBe(0);
    expect(selectedLessonVariant(tuesday, "numerator", choices)).toBe(1);
    expect(selectedLessonVariant(tuesday, "denominator", setLessonSelection(choices, tuesday, "denominator", "all"))).toBe("all");
  });

  it("сохраняет выбор конкретной даты при любом режиме недели, не переносит его на другую дату", () => {
    const dated = { ...lesson(3, `${architecture}\n${ai}`), date: "2025-12-03" };
    const choices = setLessonSelection({}, dated, "all", 1);
    writeLessonSelections(group, 0, choices);
    const saved = readLessonSelections(group, 0);
    for (const mode of ["all", "numerator", "denominator"] as const) {
      expect(selectedLessonVariant(dated, mode, saved)).toBe(1);
      expect(selectedLessonVariant({ ...dated, date: "2025-12-10" }, mode, saved)).toBe("all");
      expect(selectedLessonVariant(dated, mode, setLessonSelection(saved, dated, mode, "all"))).toBe("all");
    }
  });

  it("различает преподавателей одинакового предмета и сохраняет выбор при перестановке строк", () => {
    const first = "408-1, экз, Первый А.А., Иностранный язык (англ.)";
    const second = "418-1, экз, Второй А.А., Иностранный язык (англ.)";
    const dated = { ...lesson(3, `${first}\n${second}`), date: "2025-12-03" };
    const choices = setLessonSelection({}, dated, "numerator", 1);
    const reordered = { ...dated, ...parseLessonText(`${second}\n${first}`) };
    expect(selectedLessonVariant(reordered, "all", choices)).toBe(0);
    expect(selectedLessonVariant(reordered, "denominator", choices)).toBe(0);
  });
});
