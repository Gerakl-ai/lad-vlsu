import { describe, expect, it } from "vitest";
import type { LessonSlot } from "../types";
import { lessonChangeMessage } from "./lessonChange";

const lesson = {
  pairIndex: 1,
  variants: [
    { subject: "Основы искусственного интеллекта" },
    { subject: "Основы архитектуры и интеграции информационных систем" }
  ]
} as LessonSlot;

describe("date-specific lesson change", () => {
  const group = "7936a2a43b11b20b01d30f5b00c73166";
  it("marks only the affected subgroup on the affected date", () => {
    expect(lessonChangeMessage(group, "2026-10-06", lesson, 1)).toContain("перенесена на дистант");
    expect(lessonChangeMessage(group, "2026-10-06", lesson, "all")).toContain("Для архитектуры");
    expect(lessonChangeMessage(group, "2026-10-06", lesson, 0)).toBeNull();
    expect(lessonChangeMessage(group, "2026-10-13", lesson, 1)).toBeNull();
    expect(lessonChangeMessage("a".repeat(32), "2026-10-06", lesson, 1)).toBeNull();
  });
});
