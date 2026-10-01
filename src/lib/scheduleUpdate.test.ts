import { expect, it } from 'vitest';
import { isSelectedScheduleUpdate } from './scheduleUpdate';
import { staticDataUrl } from './staticData';

const nrec = 'a'.repeat(32);
it.each([`schedule/${nrec}.json`, `ocr-schedule/${nrec}.json`, 'ocr-schedule/bundle.json', 'university-schedule.json'])('accepts a selected schedule change: %s', (path) => {
  expect(isSelectedScheduleUpdate({ type: 'static-schedule-updated', pathname: staticDataUrl(path) }, nrec)).toBe(true);
});
it.each([null, {}, { type: 'other', pathname: staticDataUrl(`schedule/${nrec}.json`) },
  { type: 'static-schedule-updated', pathname: '/other/data/ocr-schedule/bundle.json' },
  { type: 'static-schedule-updated', pathname: staticDataUrl(`schedule/${'b'.repeat(32)}.json`) }])('ignores unrelated or malformed changes: %j', (data) => {
  expect(isSelectedScheduleUpdate(data, nrec)).toBe(false);
});
