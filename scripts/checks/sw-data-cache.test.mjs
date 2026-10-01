import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
const nrec = 'a'.repeat(32);
const item = { schemaVersion: 3, group: { nrec }, quality: { valid: true }, scheduleHash: 'b'.repeat(64), schedule: [{ type: 'Lessons', n1: '111-3, лб, Преподаватель, Предмет' }] };
const json = (value) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const prefix = 'lad-vlsu-scope:%2Fapp%2F:';
const stable = 'lad-vlsu-data:%2Fapp%2F:v1';
const url = 'https://example.org/app/data/ocr-schedule/bundle.json';

function worker(initial = {}, network = async () => { throw new Error('Offline'); }) {
  const listeners = {};
  const messages = [];
  const stores = new Map(Object.entries(initial).map(([key, entries]) => [key, new Map(entries)]));
  const absolute = (value) => new URL(typeof value === 'string' ? value : value.url, 'https://example.org').href;
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        keys: async () => [...store.keys()].map((url) => new Request(url)),
        match: async (request) => store.get(absolute(request))?.clone(),
        put: async (request, response) => store.set(absolute(request), response.clone())
      };
    }
  };
  runInNewContext(source, { URL, Response, Headers, Request, AbortController, setTimeout, clearTimeout, caches, fetch: network,
    self: { location: new URL('https://example.org/app/sw.js?release=new'), registration: {}, clients: { claim: async () => {}, matchAll: async () => [{ postMessage: (data) => messages.push(data) }] }, addEventListener: (name, fn) => { listeners[name] = fn; } } });
  return { stores, listeners, caches, messages };
}

it('migrates valid data before deleting old release assets, preserving other scopes', async () => {
  const bundle = { schemaVersion: 1, groups: { [nrec]: item } };
  const oldAsset = 'https://example.org/app/assets/old.js';
  const state = worker({ [prefix + 'old']: [[url, json(bundle)], [oldAsset, new Response('old')]], 'lad-vlsu-data:%2Fother%2F:v1': [] });
  let activation;
  state.listeners.activate({ waitUntil: (promise) => { activation = promise; } });
  await activation;
  expect(state.stores.has(prefix + 'old')).toBe(false);
  expect(state.stores.has('lad-vlsu-data:%2Fother%2F:v1')).toBe(true);
  expect(await state.stores.get(stable).get(url).json()).toEqual(bundle);
  expect(state.stores.get(stable).has(oldAsset)).toBe(false);
});

it.each([json({ schemaVersion: 1, groups: {} }), json({ schemaVersion: 1, groups: { [nrec]: { ...item, schedule: [] } } }), new Response('<html>bad</html>', { headers: { 'Content-Type': 'text/html' } })])('does not replace a saved bundle with a bad response', async (bad) => {
  const bundle = { schemaVersion: 1, groups: { [nrec]: item } };
  const state = worker({ [stable]: [[url, json(bundle)]] }, async () => bad.clone());
  let response;
  const background = [];
  state.listeners.fetch({ request: new Request(url), respondWith: (promise) => { response = promise; }, waitUntil: (promise) => background.push(promise) });
  expect(await (await response).json()).toEqual(bundle);
  await Promise.all(background);
  expect(await state.stores.get(stable).get(url).json()).toEqual(bundle);
  expect(state.messages).toEqual([]);
});

it.each([false, true])('notifies open clients only when a valid cached schedule changes: changed=%s', async (changed) => {
  const previous = { schemaVersion: 1, groups: { [nrec]: item } };
  const next = changed ? { schemaVersion: 1, groups: { [nrec]: { ...item, scheduleHash: 'c'.repeat(64) } } } : previous;
  const state = worker({ [stable]: [[url, json(previous)]] }, async () => json(next));
  let response;
  const background = [];
  state.listeners.fetch({ request: new Request(url), respondWith: (promise) => { response = promise; }, waitUntil: (promise) => background.push(promise) });
  expect(await (await response).json()).toEqual(previous);
  await Promise.all(background);
  expect(await state.stores.get(stable).get(url).json()).toEqual(next);
  expect(state.messages).toEqual(changed ? [{ type: 'static-schedule-updated', pathname: '/app/data/ocr-schedule/bundle.json' }] : []);
});

it('rejects wrong group identity during legacy migration', async () => {
  const individual = `https://example.org/app/data/schedule/${nrec}.json`;
  const state = worker({ [prefix + 'old']: [[individual, json({ ...item, group: { nrec: 'c'.repeat(32) } })]] });
  let activation;
  state.listeners.activate({ waitUntil: (promise) => { activation = promise; } });
  await activation;
  expect(state.stores.get(stable).size).toBe(0);
});

it('preserves the general university package when a network update is empty', async () => {
  const general = 'https://example.org/app/data/university-schedule.json';
  const bundle = { schemaVersion: 1, groups: { [nrec]: item } };
  const state = worker({ [stable]: [[general, json(bundle)]] }, async () => json({ schemaVersion: 1, groups: {} }));
  let response;
  const background = [];
  state.listeners.fetch({ request: new Request(general), respondWith: (promise) => { response = promise; }, waitUntil: (promise) => background.push(promise) });
  expect(await (await response).json()).toEqual(bundle);
  await Promise.all(background);
  expect(await state.stores.get(stable).get(general).json()).toEqual(bundle);
  expect(state.messages).toEqual([]);
});
