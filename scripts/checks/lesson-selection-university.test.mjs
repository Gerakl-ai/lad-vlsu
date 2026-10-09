import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLessonText } from '../../src/lib/scheduleApi';
import { selectedLessonVariant, setLessonSelection, variantIdentity } from '../../src/lib/lessonSelection';

const scheduleDir = join(process.cwd(), 'public', 'data', 'schedule');

function makeLesson(rawText, dayIndex, pairIndex, weekMode) {
  return {
    id: `${dayIndex}-${pairIndex}-${weekMode}`,
    dayIndex,
    dayName: String(dayIndex),
    pairIndex,
    start: '08:30',
    end: '10:00',
    weekMode,
    rawText,
    ...parseLessonText(rawText)
  };
}

describe('выбор пары в расписаниях университета', () => {
  it('сохраняет ручной выбор каждого варианта при перестановке строк в источнике', () => {
    let checkedChoices = 0;
    const checkedGroups = new Set();

    for (const file of readdirSync(scheduleDir).filter((name) => /^[a-f\d]{32}\.json$/i.test(name))) {
      const snapshot = JSON.parse(readFileSync(join(scheduleDir, file), 'utf8'));
      for (const [dayOffset, day] of (snapshot.schedule ?? []).entries()) {
        for (let pairIndex = 1; pairIndex <= 7; pairIndex += 1) {
          for (const [field, weekMode] of [['n', 'numerator'], ['z', 'denominator']]) {
            const rawText = day[`${field}${pairIndex}`];
            if (!rawText) continue;
            const original = makeLesson(rawText, dayOffset + 1, pairIndex, weekMode);
            const variants = original.variants ?? [];
            if (variants.length < 2) continue;
            const identities = variants.map((variant) => variantIdentity(variant, variants));
            if (new Set(identities).size !== variants.length) continue;
            const reordered = makeLesson(variants.map((variant) => variant.rawText).reverse().join('\n'), dayOffset + 1, pairIndex, weekMode);

            for (let index = 0; index < variants.length; index += 1) {
              const selections = setLessonSelection({}, original, weekMode, index);
              const selectedIndex = selectedLessonVariant(reordered, weekMode, selections);
              expect(selectedIndex, `${file}: day ${dayOffset + 1}, pair ${pairIndex}, variant ${index}`).not.toBe('all');
              expect(variantIdentity(reordered.variants[selectedIndex], reordered.variants), `${file}: day ${dayOffset + 1}, pair ${pairIndex}, variant ${index}`)
                .toBe(identities[index]);
              checkedChoices += 1;
              checkedGroups.add(file);
            }
          }
        }
      }
    }

    expect(checkedChoices).toBeGreaterThan(300);
    expect(checkedGroups.size).toBeGreaterThan(100);
  });

  it('чередует все реальные слоты с двумя одинаковыми альтернативами', () => {
    let checkedSlots = 0;
    const checkedGroups = new Set();

    for (const file of readdirSync(scheduleDir).filter((name) => /^[a-f\d]{32}\.json$/i.test(name))) {
      const snapshot = JSON.parse(readFileSync(join(scheduleDir, file), 'utf8'));
      for (const [dayOffset, day] of (snapshot.schedule ?? []).entries()) {
        for (let pairIndex = 1; pairIndex <= 7; pairIndex += 1) {
          const numeratorText = day[`n${pairIndex}`];
          const denominatorText = day[`z${pairIndex}`];
          if (!numeratorText || !denominatorText) continue;
          const numerator = makeLesson(numeratorText, dayOffset + 1, pairIndex, 'numerator');
          const denominator = makeLesson(denominatorText, dayOffset + 1, pairIndex, 'denominator');
          const numeratorVariants = numerator.variants ?? [];
          const denominatorVariants = denominator.variants ?? [];
          if (numeratorVariants.length !== 2 || denominatorVariants.length !== 2) continue;
          const firstWeek = numeratorVariants.map((variant) => variantIdentity(variant, numeratorVariants));
          const secondWeek = denominatorVariants.map((variant) => variantIdentity(variant, denominatorVariants));
          if (new Set(firstWeek).size !== 2 || !firstWeek.every((key) => secondWeek.includes(key))) continue;

          const selections = setLessonSelection({}, numerator, 'numerator', 0);
          const selectedIndex = selectedLessonVariant(denominator, 'denominator', selections, numerator);
          expect(selectedIndex, `${file}: day ${dayOffset + 1}, pair ${pairIndex}`).not.toBe('all');
          expect(secondWeek[selectedIndex], `${file}: day ${dayOffset + 1}, pair ${pairIndex}`).not.toBe(firstWeek[0]);
          checkedSlots += 1;
          checkedGroups.add(file);
        }
      }
    }

    expect(checkedSlots).toBeGreaterThan(100);
    expect(checkedGroups.size).toBeGreaterThan(50);
  });
});
