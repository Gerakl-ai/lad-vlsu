import { beforeEach, describe, expect, it } from "vitest";

import { parseLessonText } from "./scheduleApi";
import { alignSubgroupOrder, hasSubgroups, lessonView, maxSubgroupCount, readSubgroup, writeSubgroup } from "./subgroup";
import type { LessonSlot, ScheduleState } from "../types";

/** Настоящая ячейка ПИ-124: две подгруппы в одном слоте, разделённые переводом строки. */
const RAW_TWO_SUBGROUPS =
  "428-2, лб, Матвеева А.П., Информационная безопасность \n109-3, лб, Аджамиех С.М., Основы backend разработки";

function lesson(rawText: string): LessonSlot {
  return {
    id: "1-1-numerator",
    dayIndex: 5,
    dayName: "Пятница",
    pairIndex: 1,
    start: "08:30",
    end: "10:00",
    rawText,
    weekMode: "all",
    ...parseLessonText(rawText)
  };
}

describe("lessonView", () => {
  const split = lesson(RAW_TWO_SUBGROUPS);

  it("без выбора показывает склейку целиком", () => {
    const view = lessonView(split, "all");
    expect(view.subject).toBe("Информационная безопасность / Основы backend разработки");
    expect(view.filtered).toBe(false);
    expect(view.subgroupCount).toBe(2);
  });

  it("не придумывает чередование подгрупп при одинаковых данных обеих недель", () => {
    expect(lessonView(split, 0, "numerator").subject).toBe("Информационная безопасность");
    expect(lessonView(split, 0, "denominator").subject).toBe("Информационная безопасность");

    expect(lessonView(split, 1, "numerator").subject).toBe("Основы backend разработки");
    expect(lessonView(split, 1, "denominator").subject).toBe("Основы backend разработки");
  });

  it("аудитория едет вместе с предметом", () => {
    expect(lessonView(split, 0, "numerator").room).toBe("428-2");
    expect(lessonView(split, 0, "denominator").room).toBe("428-2");
  });

  it("не чередует пару, у которой недели в расписании разные", () => {
    // Там записано то, что есть, и выдумывать смещение нельзя.
    const onlyNumerator: LessonSlot = { ...split, weekMode: "numerator" };
    expect(lessonView(onlyNumerator, 0, "numerator").subject).toBe("Информационная безопасность");
    expect(lessonView(onlyNumerator, 0, "denominator").subject).toBe("Информационная безопасность");
  });

  it("с выбранной подгруппой показывает только её занятие и аудиторию", () => {
    const first = lessonView(split, 0);
    expect(first.subject).toBe("Информационная безопасность");
    expect(first.room).toBe("428-2");
    expect(first.teacher).toBe("Матвеева А.П.");
    expect(first.filtered).toBe(true);

    const second = lessonView(split, 1);
    expect(second.subject).toBe("Основы backend разработки");
    expect(second.room).toBe("109-3");
  });

  it("на обычной паре выбор ничего не меняет", () => {
    const single = lesson("119-3, лк, Шутов А.В., Базы данных");
    expect(lessonView(single, 1).subject).toBe("Базы данных");
    expect(lessonView(single, 1).filtered).toBe(false);
    expect(lessonView(single, 1).subgroupCount).toBe(1);
  });

  it("не прячет пару, если выбранной подгруппы у неё нет", () => {
    // Пропущенная пара хуже лишней строки: показываем склейку, а не пустоту.
    const view = lessonView(split, 5);
    expect(view.subject).toContain("Информационная безопасность");
    expect(view.filtered).toBe(false);
  });

  it("переживает занятие без разобранных вариантов", () => {
    const bare: LessonSlot = { ...lesson("Элективные дисциплины"), variants: undefined };
    expect(lessonView(bare, 0).subject).toBe("Элективные дисциплины");
    expect(lessonView(bare, 0).subgroupCount).toBe(0);
  });
});

describe("обнаружение подгрупп в дне", () => {
  it("видит день с подгруппами и день без них", () => {
    const withSplit = [lesson(RAW_TWO_SUBGROUPS), lesson("119-3, лк, Шутов А.В., Базы данных")];
    const without = [lesson("119-3, лк, Шутов А.В., Базы данных")];
    expect(hasSubgroups(withSplit)).toBe(true);
    expect(hasSubgroups(without)).toBe(false);
    expect(maxSubgroupCount(withSplit)).toBe(2);
    expect(maxSubgroupCount(without)).toBe(1);
  });
});

describe("порядок подгрупп при обновлении", () => {
  it("сохраняет проверенную привязку при более свежем ответе с переставленными строками", () => {
    const first = lesson("109-3, лб, Васильев Д.Н., Основы искусственного интеллекта\n111-3, лб, Аджамиех С.М., Основы архитектуры и интеграции информационных систем");
    const reversedText = first.rawText.split("\n").reverse().join("\n");
    const reversed = lesson(reversedText);
    const state = (item: LessonSlot, fetchedAt: string) => ({ groupNrec: "pi124", fetchedAt, allLessons: [item] }) as ScheduleState;
    const aligned = alignSubgroupOrder(state(reversed, "2026-10-05T18:00:00Z"), state(first, "2026-10-01T12:00:00Z"));

    expect(lessonView(aligned.allLessons[0], 0).subject).toContain("искусственного интеллекта");
    expect(lessonView(aligned.allLessons[0], 1).subject).toContain("архитектуры и интеграции");
    expect(aligned.fetchedAt).toBe("2026-10-05T18:00:00Z");
    expect(aligned.allLessons[0].rawText).toBe(first.rawText);
  });

  it("не заменяет действительно изменившееся занятие старым снимком", () => {
    const original = lesson(RAW_TWO_SUBGROUPS);
    const updated = lesson("428-2, лб, Матвеева А.П., Новое занятие\n109-3, лб, Аджамиех С.М., Основы backend разработки");
    const state = (item: LessonSlot) => ({ groupNrec: "pi124", allLessons: [item] }) as ScheduleState;
    expect(alignSubgroupOrder(state(updated), state(original)).allLessons[0]).toBe(updated);
  });
});

describe("хранение выбора", () => {
  // Тесты идут в node-окружении, где localStorage отсутствует.
  beforeEach(() => {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size;
      }
    } as Storage;
  });

  it("помнит выбор и отдаёт его обратно", () => {
    writeSubgroup("abc", 1);
    expect(readSubgroup("abc")).toBe(1);
    writeSubgroup("abc", "all");
    expect(readSubgroup("abc")).toBe("all");
  });

  it("хранит выбор отдельно для каждой группы", () => {
    // У разных групп разное число подгрупп: общий ключ дал бы чужой выбор.
    writeSubgroup("first", 0);
    writeSubgroup("second", 1);
    expect(readSubgroup("first")).toBe(0);
    expect(readSubgroup("second")).toBe(1);
  });

  it("без группы и на мусоре возвращает «обе»", () => {
    expect(readSubgroup(undefined)).toBe("all");
    localStorage.setItem("lad.subgroup.v1:broken", "не число");
    expect(readSubgroup("broken")).toBe("all");
  });
});
