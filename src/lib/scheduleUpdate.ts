import { staticDataUrl } from './staticData';

export function isSelectedScheduleUpdate(data: unknown, nrec: string): boolean {
  if (!data || typeof data !== 'object' || !/^[a-f\d]{32}$/i.test(nrec)) return false;
  const message = data as Record<string, unknown>;
  return message.type === 'static-schedule-updated' && [
    `schedule/${nrec}.json`, `ocr-schedule/${nrec}.json`, 'ocr-schedule/bundle.json', 'university-schedule.json'
  ].some((relativePath) => message.pathname === staticDataUrl(relativePath));
}
