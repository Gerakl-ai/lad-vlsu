import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const SOURCE_SHA = 'f3a227e0f26fa2ea6542eb5eaede60f5d55ab9a67cf138ab37df20e31d1ddb5a';
const SOURCE_URL = 'https://www.vlsu.ru/fileadmin/class-schedule/2025-2026/osen/exam/DO_IEHIT_190126-240126.pdf';
const args = process.argv.slice(2);
const value = (key) => args[args.indexOf(key) + 1];
if (!args.includes('--inspection') || !args.includes('--out')) throw new Error('Missing --inspection or --out');
const report = JSON.parse(await readFile(value('--inspection'), 'utf8'));
if (report.purpose !== 'inspection-only' || report.source.sha256 !== SOURCE_SHA || report.source.url !== SOURCE_URL) throw new Error('Inspection source changed');
const normal = (value) => value.replace(/\s+/g, '');
const definitions = [
  ['ЗЭБд-125', '2026-01-19', '12:10', 'Физическая культура и спорт', '101-СК1, , Репникова Е.А., Физическая культура и спорт'],
  ['ЗЭБуд-125', '2026-01-19', '15:50', 'Физическая культура и спорт', '101-СК1, , Репникова Е.А., Физическая культура и спорт'],
  ['ЗУКд-125', '2026-01-22', '15:50', 'Физическая культура и спорт', '101-СК1, , Одинцова С.В., Физическая культура и спорт'],
  ['ЗГДуд-125', '2026-01-23', '12:10', 'Элективные дисциплины', '101-СК1, , Репникова Е.А., Физическая культура и спорт\n101-СК1, , Репникова Е.А., Элективные дисциплины по физической культуре и спорту'],
  ['ЗТРуд-125', '2026-01-23', '08:30', 'Элективные дисциплины', '101-СК1, , Репникова Е.А., Физическая культура и спорт\n101-СК1, , Репникова Е.А., Элективные дисциплины по физической культуре и спорту'],
  ['ЗЭКмд-125', '2026-01-21', '12:10', 'Функционально-стоимост ной', '101-6, зач, Гундорова М.А., Функционально-стоимостной анализ деятельности фирмы']
];
const metadata = definitions.map(([groupName, date, start, expected, name], index) => {
  const cells = report.groups.find((group) => group.groupName === groupName)?.cells.filter((cell) => cell.date === date && cell.gridStart === start);
  if (cells?.length !== 1 || !normal(cells[0].visibleText).includes(normal(expected))) throw new Error(`Reviewed metadata cell changed: ${groupName} ${date} ${start}`);
  const cell = cells[0];
  return { id: `ieit-metadata-${index + 1}`, sourceSha256: SOURCE_SHA, groupName, page: cell.page, date, start, end: cell.gridEnd,
    lessonBox: cell.lessonBox, expectedRawText: cell.rawText, name, scheduleKind: 'exam', reason: index === 5
      ? 'На изображении слово «стоимостной» перенесено внутри слова без нового смыслового разделителя; соединены только эти части.'
      : 'Вид аттестации не напечатан, поле kind оставлено пустым. Документ прямо назван экзаменационной сессией. Названия, аудитория и фамилии сверены на изображении; в двух общих ячейках сохранены оба предмета.' };
});
const timing = report.groups.flatMap((group) => group.cells.filter((cell) => cell.explicitStart && cell.explicitStart !== cell.gridStart).map((cell) => {
  const outside = cell.explicitStart < cell.gridStart || cell.explicitStart >= cell.gridEnd;
  const related = group.cells.find((other) => other !== cell && other.date === cell.date && other.explicitStart === cell.explicitStart
    && (other.explicitStart < other.gridStart || other.explicitStart >= other.gridEnd));
  return { id: `ieit-time-${group.groupName}-${cell.date}-${cell.gridStart.replace(':', '')}`, sourceSha256: SOURCE_SHA,
    groupName: group.groupName, date: cell.date, page: cell.page, lessonBox: cell.lessonBox, gridStart: cell.gridStart, gridEnd: cell.gridEnd,
    expectedRawText: cell.rawText, expectedVisibleText: cell.visibleText, printedStart: cell.explicitStart,
    mode: outside || related ? 'unconfirmed' : 'printed-start',
    ...(outside || related ? { conflict: outside ? 'outside-grid' : 'coincident-start' } : {}),
    ...(related && !outside ? { relatedCell: { page: related.page, table: related.table, lessonBox: related.lessonBox,
      timeBox: related.timeBox, timeText: related.timeText, dayBox: related.dayBox, dayText: related.dayText,
      expectedRawText: related.rawText, expectedVisibleText: related.visibleText } } : {}),
    reason: outside ? 'В ячейке напечатано 16:00 вне собственного интервала строки. В этой группе на той же дате есть ещё предмет с 16:00. Ни начало другого предмета, ни окончание не подменены догадкой.'
      : related ? 'В этой группе два предмета напечатаны с 16:00, у другого начало противоречит его строке. Нельзя решить, какой интервал ошибочен; точный конец не заявлен.'
      : 'Явное начало 16:00 находится внутри строки 15:50-17:20. Начало сохранено из текста, окончание 17:20 из напечатанной сетки.' };
}));
if (metadata.length !== 6 || timing.length !== 9 || timing.filter((item) => item.mode === 'unconfirmed').length !== 4) throw new Error('Reviewed cell counts changed');
await mkdir(value('--out'), { recursive: true });
await writeFile(path.join(value('--out'), 'reviewed-dated-ieit-metadata.json'), `${JSON.stringify({ schemaVersion: 1, corrections: metadata }, null, 2)}\n`);
await writeFile(path.join(value('--out'), 'reviewed-dated-ieit-timing.json'), `${JSON.stringify({ schemaVersion: 1, corrections: timing }, null, 2)}\n`);
console.log(JSON.stringify({ metadata: metadata.length, timing: timing.length, unconfirmed: 4, output: value('--out') }));
