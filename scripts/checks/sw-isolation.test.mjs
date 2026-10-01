import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');

it('activation preserves unrelated apps and other scopes on the same origin', async () => {
  const listeners = {};
  const removed = [];
  const prefix = 'lad-vlsu-scope:%2Fvlsu-pi-124-schedule%2F:';
  let activation;
  runInNewContext(source, {
    URL,
    self: {
      location: new URL('https://example.org/vlsu-pi-124-schedule/sw.js?release=new'),
      addEventListener: (name, handler) => { listeners[name] = handler; },
      clients: { claim() {} },
      registration: {}
    },
    caches: {
      open: async () => ({ keys: async () => [], match: async () => undefined }),
      keys: async () => [prefix + 'old', prefix + 'new', 'portfolio-cache', 'lad-vlsu-v67', 'lad-vlsu-scope:%2Fother%2F:old'],
      delete: async (key) => { removed.push(key); return true; }
    }
  });
  listeners.activate({ waitUntil: (promise) => { activation = promise; } });
  await activation;
  expect(removed).toEqual([prefix + 'old']);
  let intercepted = false;
  listeners.fetch({
    request: { method: 'GET', url: 'https://example.org/portfolio/photo.jpg' },
    respondWith: () => { intercepted = true; }
  });
  expect(intercepted).toBe(false);
});
