import { beforeEach, describe, expect, it } from "vitest";
import { parseLessonText } from "./scheduleApi";
import s424Snapshot from "../../public/data/schedule/0107a80d5bdd182f4b2609a637266fb7.json";
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
    expect(selectedLessonVariant(tuesday, "numerator", choices, group, 5)).toBe(0);
    expect(lessonWithSelectedVariant(tuesday, 1).subject).toContain("искусственного интеллекта");
    writeLessonSelections(group, 5, choices);
    expect(selectedLessonVariant(tuesday, "denominator", readLessonSelections(group, 5))).toBe(1);
  });

  it("на реальном порядке ПИ-124 показывает ИИ 6-го и архитектуру 13-го, а в пятницу backend затем ИБ", () => {
    const tuesdayDenominator = lesson(2, `${ai}\n${architecture}`);
    const tuesdayNumerator = lesson(2, `${architecture}\n${ai}`);
    const fridayDenominator = lesson(5, `${backend}\n${security}`);
    const fridayNumerator = lesson(5, `${security}\n${backend}`);
    let choices = setLessonSelection({}, tuesdayDenominator, "denominator", 0);
    choices = setLessonSelection(choices, fridayDenominator, "denominator", 0);
    expect(lessonWithSelectedVariant(tuesdayDenominator, selectedLessonVariant(tuesdayDenominator, "denominator", choices)).subject).toContain("искусственного интеллекта");
    expect(lessonWithSelectedVariant(tuesdayNumerator, selectedLessonVariant(tuesdayNumerator, "numerator", choices, group, 5)).subject).toContain("архитектуры");
    expect(lessonWithSelectedVariant(fridayDenominator, selectedLessonVariant(fridayDenominator, "denominator", choices)).subject).toContain("backend");
    expect(lessonWithSelectedVariant(fridayNumerator, selectedLessonVariant(fridayNumerator, "numerator", choices, group, 5)).subject).toContain("безопасность");
  });

  it("пятница выбирается независимо от вторника и допускает собственное правило", () => {
    const tuesday = lesson(2, `${architecture}\n${ai}`);
    const friday = lesson(5, `${security}\n${backend}`);
    let choices = setLessonSelection({}, tuesday, "denominator", 1);
    choices = setLessonSelection(choices, friday, "denominator", 1);
    expect(selectedLessonVariant(friday, "denominator", choices)).toBe(1);
    expect(selectedLessonVariant(friday, "numerator", choices, group, 5)).toBe(0);
    choices = setLessonSelection(choices, friday, "numerator", 1);
    expect(selectedLessonVariant(friday, "numerator", choices)).toBe(1);
    expect(selectedLessonVariant(tuesday, "numerator", choices, group, 5)).toBe(0);
  });

  it("не угадывает выбор для другой группы и не чередует три варианта", () => {
    const tuesday = lesson(2, `${architecture}\n${ai}`);
    expect(selectedLessonVariant(tuesday, "denominator", {}, "other", 5, 0)).toBe("all");
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
    expect(selectedLessonVariant(denominator, "denominator", choices, "other", 3, "all", numerator)).toBe(0);
    expect(selectedLessonVariant(sameOrder, "denominator", choices, "other", 3, "all", numerator)).toBe("all");
    expect(selectedLessonVariant(changed, "denominator", choices, "other", 3, "all", numerator)).toBe("all");
  });

  it("не подменяет гидрологию строительством у С-424 при переходе на другую неделю", () => {
    const snapshot = s424Snapshot;
    const monday = snapshot.schedule.find((day) => day.name === "Понедельник");
    if (!monday) throw new Error("Monday is missing");
    const numerator = lesson(1, monday.n3);
    const denominator = lesson(1, monday.z3);
    const choices = setLessonSelection({}, numerator, "numerator", 0);
    expect(selectedLessonVariant(denominator, "denominator", choices, snapshot.group.nrec, snapshot.semester, "all", numerator)).toBe("all");
  });

  it("на старом ПИ-124 использует проверенный выбор, но ручной выбор имеет приоритет", () => {
    const tuesday = lesson(2, `${architecture}\n${ai}`);
    expect(selectedLessonVariant(tuesday, "denominator", {}, group, 5, 0)).toBe(1);
    expect(selectedLessonVariant(tuesday, "numerator", {}, group, 5, 0)).toBe(0);
    const choices = setLessonSelection({}, tuesday, "denominator", 0);
    expect(selectedLessonVariant(tuesday, "denominator", choices, group, 5, 0)).toBe(0);
    expect(selectedLessonVariant(tuesday, "numerator", choices, group, 5, 0)).toBe(1);
    expect(selectedLessonVariant(tuesday, "denominator", setLessonSelection(choices, tuesday, "denominator", "all"), group, 5, 0)).toBe("all");
  });
});
