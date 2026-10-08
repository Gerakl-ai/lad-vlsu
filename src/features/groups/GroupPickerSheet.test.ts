import { describe, expect, it } from "vitest";
import type { StaticCoverage, StaticQuality } from "../../lib/staticData";
import { snapshotLabel } from "./GroupPickerSheet";

const nrec = "a".repeat(32);
const coverage: StaticCoverage = {
  checkedAt: "2026-10-06T00:00:00Z",
  catalogGroups: 2,
  available: 1,
  groups: {
    [nrec]: {
      capturedAt: "2026-10-05T00:00:00Z",
      semester: 5,
      scheduleHash: "b".repeat(64),
      validThrough: "2026-12-31"
    }
  }
};

describe("подписи доступности группы", () => {
  it("отличает предварительный снимок от подтверждённого", () => {
    const quality: StaticQuality = {
      assessedAt: "2026-10-06T00:00:00Z",
      groups: { [nrec]: { category: "preliminary" } }
    };
    expect(snapshotLabel(coverage, nrec, {}, quality)).toBe("Предварительное расписание");
    expect(snapshotLabel(coverage, nrec, {}, quality, true)).toBe("Сохранено здесь · предварительно");
    quality.groups[nrec].category = "reviewedDocument";
    expect(snapshotLabel(coverage, nrec, {}, quality)).toBe("Сверенное расписание");
  });

  it("не выдаёт архив или отсутствующий снимок за актуальное расписание", () => {
    const expired: StaticCoverage = {
      ...coverage,
      groups: { [nrec]: { ...coverage.groups[nrec], validThrough: "2025-12-31" } }
    };
    expect(snapshotLabel(expired, nrec, {}, null)).toMatch(/^Архив до/);
    expect(snapshotLabel(expired, nrec, {}, null, true)).toMatch(/^Сохранённый архив до/);
    expect(snapshotLabel(coverage, "c".repeat(32), {}, null)).toBe("Нет сохранённого расписания");
    expect(snapshotLabel(coverage, nrec, {}, null)).toMatch(/^Снимок от/);
  });
});
