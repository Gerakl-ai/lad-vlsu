// Build embeds the release and complete chunk list. An update through an old
// worker URL must still install the NEW release, not reuse its previous cache.
const BUILD_RELEASE = "__BUILD_RELEASE__";
const RELEASE = BUILD_RELEASE.startsWith("__")
  ? new URL(self.location.href).searchParams.get("release") || "dev"
  : BUILD_RELEASE;
const BUILD_ASSETS = /* __BUILD_ASSETS__ */ null;

// Базовый путь выводится из адреса самого воркера: на своём домене это "/",
// на проектном сайте GitHub Pages — "/<repo>/". Без этого установленное
// приложение кэшировало бы чужие пути и не запускалось бы офлайн.
const BASE = self.location.pathname.replace(/[^/]*$/, "");
const CACHE_PREFIX = `lad-vlsu-scope:${encodeURIComponent(BASE)}:`;
const CACHE_NAME = `${CACHE_PREFIX}${RELEASE}`;

function path(value) {
  return BASE + String(value).replace(/^\//, "");
}

// Only resources required to boot belong to the atomic install. Decorative
// images and icons enter the runtime cache when requested by the app.
const APP_SHELL = [BASE];

const ASSETS_PREFIX = path("assets/");
const ICON_192 = path("icons/icon-192.png");

function navigationSafeResponse(response) {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers)
  });
}

function validBuildAsset(response, pathname) {
  if (!response?.ok) return false;
  const contentType = response.headers.get("Content-Type") || "";
  if (pathname.endsWith(".js")) return /javascript|ecmascript/i.test(contentType);
  if (pathname.endsWith(".css")) return /text\/css/i.test(contentType);
  return !/text\/html/i.test(contentType);
}

async function discoverBuildAssets() {
  try {
    const response = await fetch(path("index.html"), { cache: "no-store" });
    const html = await response.text();
    const matches = [...html.matchAll(/(?:src|href)="([^"]+)"/g)];
    const directAssets = matches
      .map((match) => new URL(match[1], new URL(path("index.html"), self.location.origin)).pathname)
      .filter((url) => url.startsWith(ASSETS_PREFIX));
    const assets = new Set(directAssets);
    const pendingScripts = directAssets.filter((url) => url.endsWith(".js"));
    const scannedScripts = new Set();

    while (pendingScripts.length && assets.size < 100) {
      const asset = pendingScripts.shift();
      if (!asset || scannedScripts.has(asset)) continue;
      scannedScripts.add(asset);
      try {
        const scriptResponse = await fetch(asset, { cache: "no-store" });
        if (!scriptResponse.ok) continue;
        const script = await scriptResponse.text();
        const nestedAssets = [...script.matchAll(/["'(]((?:\/?assets\/|\.\.?\/)[^"'()\s]+\.(?:js|css|png|jpg|jpeg|webp|svg))/g)]
          .map((match) => {
            const value = match[1];
            if (value.startsWith("assets/")) return path(value);
            return new URL(value, new URL(asset, self.location.origin)).pathname;
          })
          .filter((url) => url.startsWith(ASSETS_PREFIX));
        nestedAssets.forEach((url) => {
          if (assets.has(url)) return;
          assets.add(url);
          if (url.endsWith(".js")) pendingScripts.push(url);
        });
      } catch {
        // A runtime request can still populate the cache when an optional chunk is unavailable during install.
      }
    }
    return [...assets];
  } catch {
    return [];
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      const buildAssets = BUILD_ASSETS ? BUILD_ASSETS.map(path) : await discoverBuildAssets();
      if (!buildAssets.some((asset) => asset.endsWith(".js"))) throw new Error("Missing offline JavaScript");
      const resources = [...new Set([...APP_SHELL, ...buildAssets])];
      await Promise.all(resources.map(async (resource) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        let response;
        try {
          response = await fetch(resource, { cache: "no-store", signal: controller.signal });
        } finally {
          clearTimeout(timeout);
        }
        if (!response.ok || (resource.startsWith(ASSETS_PREFIX) && !validBuildAsset(response, resource))) {
          throw new Error(`Cannot install ${resource}`);
        }
        if (resource === BASE && !BUILD_RELEASE.startsWith("__")) {
          const html = await response.clone().text();
          if (!html.includes(`name="lad-release" content="${RELEASE}"`)) {
            throw new Error("Shell and worker releases differ");
          }
        }
        await cache.put(resource, response);
      }));
      await self.skipWaiting();
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)))
      ),
      self.registration.navigationPreload?.enable?.() ?? Promise.resolve()
    ]).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.pathname.startsWith(path("vlsu-api/"))) return;
  if (url.pathname.startsWith(path("app-api/"))) return;
  // Снимки расписания обновляются отдельным обходом и не входят в app shell:
  // их кэширование по требованию описано в docs/DATA-PIPELINE.md.
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(BASE)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cachedShell = await cache.match(BASE);

        // The release shell and its hashed assets are installed together. Replacing only
        // index.html here would mix releases and can leave an installed PWA unbootable.
        if (cachedShell) return navigationSafeResponse(cachedShell);

        try {
          const preloaded = await event.preloadResponse;
          const response = preloaded || await fetch(request, { cache: "no-store" });
          if (!response.ok) throw new Error(`Navigation failed with ${response.status}`);
          return navigationSafeResponse(response);
        } catch {
          const fallback = await cache.match(BASE);
          return fallback ? navigationSafeResponse(fallback) : Response.error();
        }
      })()
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request) || await cache.match(url.pathname);
      const fresh = fetch(request, { cache: "no-store" })
        .then((response) => {
          if (validBuildAsset(response, url.pathname)) {
            const clone = response.clone();
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(url.pathname, clone)));
          } else if (url.pathname.startsWith(ASSETS_PREFIX)) {
            throw new Error("Invalid build asset response");
          }
          return response;
        })
        .catch(() => cached || new Response("", { status: 504, statusText: "Offline" }));

      if (cached) {
        event.waitUntil(fresh.catch(() => undefined));
        return cached;
      }

      return fresh;
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "schedule-notification") return;
  const { title, body, tag } = event.data.payload;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon: ICON_192,
      badge: ICON_192,
      data: { url: BASE }
    })
  );
});

self.addEventListener("push", (event) => {
  let payload = { title: "Лад ВлГУ", body: "Проверьте ближайшую пару.", tag: "lad-schedule-push", url: BASE };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    if (event.data) payload.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: ICON_192,
      badge: ICON_192,
      data: { url: payload.url || BASE }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      const existing = clients.find((client) => "focus" in client);
      if (existing) return existing.focus();
      if (self.clients.openWindow) return self.clients.openWindow(event.notification.data?.url || BASE);
      return undefined;
    })
  );
});
