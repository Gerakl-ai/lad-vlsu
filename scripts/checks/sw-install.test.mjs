import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8')
  .replace('"__BUILD_RELEASE__"', '"new-build"')
  .replace('/* __BUILD_ASSETS__ */ null', '["assets/main.js", "assets/lazy.js", "assets/main.css"]');

it.each([false, true])('installs all chunks atomically; missing chunk=%s', async (missing) => {
  const listeners = {};
  const stored = [];
  let activated = false;
  let installation;
  let cacheName;
  runInNewContext(source, {
    URL, Response, Headers, AbortController, setTimeout, clearTimeout,
    self: {
      location: new URL('https://example.org/app/sw.js?release=old-build'),
      addEventListener: (name, fn) => { listeners[name] = fn; },
      skipWaiting: async () => { activated = true; }
    },
    caches: { open: async (name) => {
      cacheName = name;
      return { put: async (path) => { stored.push(path); } };
    } },
    fetch: async (path) => {
      if (missing && path.endsWith('lazy.js')) return new Response('', { status: 503 });
      const type = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html';
      return new Response('<meta name="lad-release" content="new-build">', { headers: { 'Content-Type': type } });
    }
  });
  listeners.install({ waitUntil: (promise) => { installation = promise; } });
  if (missing) await expect(installation).rejects.toThrow('Cannot install');
  else await installation;
  expect(cacheName).toBe('lad-vlsu-scope:%2Fapp%2F:new-build');
  expect(activated).toBe(!missing);
  if (!missing) expect(stored).toEqual(expect.arrayContaining(['/app/', '/app/assets/main.js', '/app/assets/lazy.js', '/app/assets/main.css']));
});

it('does not require optional images or icons to install the offline shell', async () => {
  const listeners = {};
  const requested = [];
  let installation;
  let activated = false;
  runInNewContext(source, {
    URL, Response, Headers, AbortController, setTimeout, clearTimeout,
    self: {
      location: new URL('https://example.org/app/sw.js?release=old-build'),
      addEventListener: (name, fn) => { listeners[name] = fn; },
      skipWaiting: async () => { activated = true; }
    },
    caches: { open: async () => ({ put: async () => {} }) },
    fetch: async (resource) => {
      requested.push(resource);
      if (resource.includes('/icons/') || resource.includes('/images/')) {
        return new Response('', { status: 503 });
      }
      const type = resource.endsWith('.js') ? 'text/javascript' : resource.endsWith('.css') ? 'text/css' : 'text/html';
      return new Response('<meta name="lad-release" content="new-build">', { headers: { 'Content-Type': type } });
    }
  });
  listeners.install({ waitUntil: (promise) => { installation = promise; } });
  await installation;
  expect(activated).toBe(true);
  expect(requested).not.toContain('/app/images/hero-obsidian-campus.jpg');
  expect(requested).not.toContain('/app/icons/icon-192.png');
});
