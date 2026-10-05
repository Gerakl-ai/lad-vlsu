const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const dist = path.resolve('dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const makeServer = () => http.createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (pathname.startsWith('/vlsu-api/') || pathname.startsWith('/app-api/')) {
    response.writeHead(503).end();
    return;
  }
  const file = path.resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(dist + path.sep)) { response.writeHead(403).end(); return; }
  try {
    const body = await fs.readFile(file);
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(body);
  } catch { response.writeHead(404).end(); }
});
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}/`)));
const close = (server) => new Promise((resolve) => server.close(resolve));

(async () => {
  const sourceServer = makeServer();
  const destinationServer = makeServer();
  const sourceUrl = await listen(sourceServer);
  const destinationUrl = await listen(destinationServer);
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH, headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 402, height: 874 }, acceptDownloads: true, serviceWorkers: 'block' });
    await context.addInitScript(() => {
      localStorage.setItem('lad.selected-group.v2', JSON.stringify({ id: 'qa', nrec: 'qa', name: 'QA', instituteId: 'qa', instituteName: 'QA', instituteShortName: 'QA', visualKey: 'iite' }));
    });
    const errors = [];
    const source = await context.newPage();
    source.on('pageerror', (error) => errors.push(`source: ${error.message}`));
    await source.goto(sourceUrl);
    await source.locator('.bottom-nav').getByRole('button', { name: 'Настройки' }).click();

    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR7sAAAAASUVORK5CYII=';
    const note = { id: 'transfer-fixture', text: 'Тест переноса', title: 'Тест переноса', space: 'Монтаж QA', kind: 'note', status: 'open', pinned: false, confidence: 1, classificationSource: 'local', createdAt: '2026-09-20T10:00:00Z', updatedAt: '2026-09-20T10:00:00Z', contentHtml: `<p><strong>Тест переноса</strong></p><img src="${image}">` };
    const folder = { id: 'qa-folder', name: 'Монтаж QA', color: '#123456', system: false, createdAt: note.createdAt };
    const event = { id: 'event-qa', title: 'Встреча', start: '2026-10-10T18:00:00+03:00', end: '2026-10-10T19:00:00+03:00', location: 'Корпус', description: 'Обсудить проект' };
    const archive = { app: 'lad', version: 7, exportedAt: note.createdAt, notes: [note], folders: [folder], events: [event] };
    await source.getByLabel('Импортировать резервную копию записей').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(archive)) });
    await source.getByRole('status').filter({ hasText: 'Добавлено или обновлено записей: 1' }).waitFor();
    await source.locator('.bottom-nav').getByRole('button', { name: 'Записи' }).click();
    await source.getByTestId('open-note-composer').click();
    await source.locator('[contenteditable="true"]').fill('Черновик со старого адреса');
    await source.getByRole('button', { name: 'Закрыть запись' }).click();
    await source.getByRole('button', { name: 'Черновик со старого адреса' }).waitFor();
    await source.locator('.bottom-nav').getByRole('button', { name: 'Настройки' }).click();
    const downloadPromise = source.waitForEvent('download');
    await source.getByRole('button', { name: 'Экспорт', exact: true }).click();
    const download = await downloadPromise;
    const exported = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
    assert.equal(exported.version, 8);
    assert.equal(exported.notes[0].contentHtml, note.contentHtml);
    assert.equal(exported.folders.find((item) => item.name === folder.name).color, folder.color);
    assert.deepEqual(exported.events, [event]);
    assert.equal(exported.drafts[0].text, 'Черновик со старого адреса');

    const destination = await context.newPage();
    destination.on('pageerror', (error) => errors.push(`destination: ${error.message}`));
    await destination.goto(destinationUrl);
    await destination.evaluate(() => localStorage.setItem('lad.note-drafts.fallback', JSON.stringify({ new: { id: 'new', text: 'Черновик нового адреса', contentHtml: '<p>Черновик нового адреса</p>', pinned: false, updatedAt: '2026-10-05T10:00:00.000Z' } })));
    await destination.reload();
    await destination.locator('.bottom-nav').getByRole('button', { name: 'Настройки' }).click();
    await destination.getByLabel('Импортировать резервную копию записей').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
    await destination.getByRole('status').filter({ hasText: 'Черновиков восстановлено: 1' }).waitFor();
    await destination.locator('.bottom-nav').getByRole('button', { name: 'Записи' }).click();
    await destination.getByRole('button', { name: 'Черновик нового адреса' }).waitFor();
    await destination.getByRole('button', { name: 'Черновик со старого адреса' }).click();
    assert.equal((await destination.locator('[contenteditable="true"]').innerText()).trim(), 'Черновик со старого адреса');
    await destination.getByRole('button', { name: 'Сохранить запись' }).click();
    await destination.getByText('Черновик со старого адреса').first().waitFor();
    const destinationState = await destination.evaluate(() => ({ events: JSON.parse(localStorage.getItem('lad.personal-events.v1') || '[]'), draftMirror: JSON.parse(localStorage.getItem('lad.note-drafts.fallback') || '{}') }));
    assert.deepEqual(destinationState.events, [event]);
    assert.equal(destinationState.draftMirror.new.text, 'Черновик нового адреса');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ sourceUrl, destinationUrl, version: exported.version, notes: exported.notes.length, events: exported.events.length, photoPreserved: true, draftRecovered: true, destinationDraftPreserved: true, errors }));
  } finally {
    await browser.close();
    await Promise.all([close(sourceServer), close(destinationServer)]);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
