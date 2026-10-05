import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeSchedule } from '../../src/lib/scheduleApi';
import { vlsuWeekModeForDate } from '../../src/lib/academicWeek';
import { lessonView } from '../../src/lib/subgroup';
import { selectDayLessons } from '../../src/lib/time';

const id = '7936a2a43b11b20b01d30f5b00c73166';
const snapshot = JSON.parse(readFileSync(new URL(`../../public/data/schedule/${id}.json`, import.meta.url), 'utf8'));
const lessons = normalizeSchedule(snapshot.schedule);

function subjectOn(date, subgroup) {
  const weekMode = vlsuWeekModeForDate(date);
  const day = selectDayLessons(lessons, date.getDay(), weekMode, date);
  return lessonView(day.find((lesson) => lesson.pairIndex === 1), subgroup, weekMode).subject;
}

describe('ПИ-124 subgroup rotation', () => {
  it('shows the documented Tuesday and Friday assignment on alternating weeks', () => {
    expect(subjectOn(new Date(2026, 9, 6), 0)).toContain('искусственного интеллекта');
    expect(subjectOn(new Date(2026, 9, 6), 1)).toContain('архитектуры и интеграции');
    expect(subjectOn(new Date(2026, 9, 9), 0)).toContain('backend');
    expect(subjectOn(new Date(2026, 9, 9), 1)).toContain('Информационная безопасность');
    expect(subjectOn(new Date(2026, 9, 16), 0)).toContain('Информационная безопасность');
    expect(subjectOn(new Date(2026, 9, 16), 1)).toContain('backend');
  });
});
