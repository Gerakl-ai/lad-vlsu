import path from 'node:path';
import { watch } from 'node:fs';
import { prepareUniversityData, writeUniversityData } from './buildUniversityBundle.mjs';

export function universityDataPlugin() {
  let config;
  let prepared;
  let payloads;
  let refreshPromise;
  let revision = 0;
  const dataDir = () => path.join(config.publicDir, 'data');
  const refresh = () => {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      let capturedRevision;
      do {
        capturedRevision = revision;
        const next = await prepareUniversityData(dataDir());
        prepared = next;
        payloads = new Map(Object.entries(next.files).map(([name, value]) => [name, `${JSON.stringify(value)}\n`]));
      } while (capturedRevision !== revision);
    })().finally(() => { refreshPromise = undefined; });
    return refreshPromise;
  };

  return {
    name: 'lad-university-data',
    config(userConfig, { command }) {
      if (command !== 'serve') return;
      const root = path.resolve(userConfig.root || process.cwd());
      const directory = path.resolve(root, userConfig.publicDir || 'public', 'data').replace(/\\/g, '/');
      const ignored = userConfig.server?.watch?.ignored;
      return { server: { watch: { ignored: [...(Array.isArray(ignored) ? ignored : ignored ? [ignored] : []), directory, `${directory}/**`] } } };
    },
    configResolved(resolved) { config = resolved; },
    async configureServer(server) {
      const prefix = new URL(config.base, 'http://localhost').pathname.replace(/\/$/, '') + '/data/';
      let closed = false;
      let timer;
      const notify = () => {
        void refresh().then(() => {
          if (!closed) server.ws.send({ type: 'custom', event: 'lad-static-data-updated',
            data: { type: 'static-schedule-updated', pathname: prefix + 'university-schedule.json' } });
        }).catch((error) => {
          server.config.logger.error(`Schedule data: ${error.message}`);
          if (!closed) server.ws.send({ type: 'error', err: { message: error.message, stack: error.stack } });
        });
      };
      // Public-file changes normally reload the page. Data uses its own watch
      // so schedule refreshes cannot discard an open editor or selected tab.
      const sourceWatcher = watch(dataDir(), { recursive: true }, (_event, filename) => {
        if (filename && !String(filename).endsWith('.json')) return;
        revision += 1;
        clearTimeout(timer);
        timer = setTimeout(notify, 80);
      });
      sourceWatcher.on('error', (error) => server.config.logger.error(`Schedule watch: ${error.message}`));
      const close = () => { closed = true; clearTimeout(timer); sourceWatcher.close(); };
      server.httpServer?.once('close', close);
      try { await refresh(); } catch (error) { close(); throw error; }
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.originalUrl || request.url, 'http://localhost').pathname;
        if (!pathname.startsWith(prefix)) return next();
        const body = payloads.get(pathname.slice(prefix.length));
        if (body === undefined) return next();
        if (!['GET', 'HEAD'].includes(request.method)) return next();
        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Length', Buffer.byteLength(body));
        response.end(request.method === 'HEAD' ? undefined : body);
      });
    },
    async buildStart() {
      if (config.command === 'build') await refresh();
    },
    async writeBundle() {
      if (config.command === 'build') await writeUniversityData(prepared, path.resolve(config.root, config.build.outDir, 'data'));
    }
  };
}
