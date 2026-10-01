import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeSchedule } from '../../src/lib/scheduleApi';
import { selectDayLessons } from '../../src/lib/time';

const groups = [
  ['ВС-123', '26116766749036772b86dae476a17459'],
  ['ВС-223', '4fe693d8e66ed59bb8303121b4ef0a7a'],
  ['ВС-323', '141c15f5dd5ccf2f1b08d465928b4e2f'],
  ['ВС-423', '04bd2331c4bbfdbd408a52e99d336ff6'],
  ['ВС-523', '19e0b11b85d4531de45e3fa23d51e50d']
];

describe('reviewed PI-124 laboratory cells', () => {
  it('keeps subgroup order and applies laboratory types without changing periods', () => {
    const snapshot = JSON.parse(readFileSync(new URL('../../public/data/ocr-schedule/7936a2a43b11b20b01d30f5b00c73166.json', import.meta.url), 'utf8'));
    expect(snapshot.extraction.reviewedCorrectionIds).toHaveLength(5);
    const lessons = normalizeSchedule(snapshot.schedule);
    const monday = selectDayLessons(lessons, 1, 'denominator', new Date('2026-11-02T12:00:00'));
    for (const pairIndex of [1, 2]) {
      expect(monday.find((lesson) => lesson.pairIndex === pairIndex)).toMatchObject({ kind: 'лб', teacher: 'Старовойтов Е.А.' });
    }
    const tuesday = selectDayLessons(lessons, 2, 'denominator', new Date('2026-11-03T12:00:00'));
    const first = tuesday.find((lesson) => lesson.pairIndex === 1);
    expect(first.variants.map((variant) => variant.room)).toEqual(['109-3', '111-3']);
    expect(first.variants.map((variant) => variant.kind)).toEqual(['лб', 'лб']);
    expect(first.variants[1].teacher).toBe('Аджамиех С.М.');
    for (const pairIndex of [3, 4]) {
      expect(tuesday.find((lesson) => lesson.pairIndex === pairIndex)).toMatchObject({ kind: 'лб', teacher: 'Градусов Д.А.' });
    }
    const before = selectDayLessons(lessons, 2, 'denominator', new Date('2026-10-20T12:00:00'));
    expect(before.some((lesson) => [3, 4].includes(lesson.pairIndex))).toBe(false);
  });
});

describe('reviewed shared source periods', () => {
  it.each(groups)('selects subject, type and teacher by the printed period for %s', (name, nrec) => {
    const snapshot = JSON.parse(readFileSync(new URL(`../../public/data/ocr-schedule/${nrec}.json`, import.meta.url), 'utf8'));
    expect(snapshot.group.name).toBe(name);
    expect(snapshot.extraction.reviewedCorrectionIds).toHaveLength(2);
    const lessons = normalizeSchedule(snapshot.schedule);
    const pair = (day, date) => selectDayLessons(lessons, day, 'numerator', new Date(`${date}T12:00:00`))
      .filter((lesson) => lesson.pairIndex === 7);
    expect(pair(2, '2026-09-29')[0]).toMatchObject({ subject: 'Строительная механика (по 6 нед)', kind: 'лк', teacher: 'Маврина С.А.' });
    expect(pair(2, '2026-10-13')[0]).toMatchObject({ subject: 'Строительные машины и оборудование (с 7 по 10 нед)', kind: 'лк', teacher: 'Опарин Е.М.' });
    expect(pair(2, '2026-11-10')[0]).toMatchObject({ subject: 'Строительные машины и оборудование (с 11 по 14 нед)', kind: 'пр', teacher: 'Опарин Е.М.' });
    expect(pair(2, '2026-12-08')).toHaveLength(0);
    expect(pair(4, '2026-10-29')[0]).toMatchObject({ subject: 'Механика грунтов (по 10 нед)', kind: 'лк', teacher: 'Гандельсман И.А.' });
    expect(pair(4, '2026-11-12')[0]).toMatchObject({ subject: 'Механика грунтов (с 11 по 16 нед)', kind: 'пр', teacher: 'Гандельсман И.А.' });
  });
});
