import { describe, expect, it, vi } from "vitest";
import { RELEASE_CHANNEL } from "./release";
import worker from "./worker";

function createEdgeCache() {
  const entries = new Map<string, Response>();
  return {
    match: vi.fn(async (request: RequestInfo | URL) => entries.get(String(request instanceof Request ? request.url : request))?.clone()),
    put: vi.fn(async (request: RequestInfo | URL, response: Response) => {
      entries.set(String(request instanceof Request ? request.url : request), response.clone());
    })
  };
}

function createSnapshotKv() {
  const entries = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => entries.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      entries.set(key, value);
    })
  };
}

function createEnv() {
  return {
    ASSETS: {
      fetch: vi.fn(async () => new Response("app shell", { headers: { "Content-Type": "text/html" } }))
    },
    CF_VERSION_METADATA: {
      id: "worker-version-id",
      tag: "production",
      timestamp: "2026-07-17T12:00:00.000Z"
    }
  };
}

describe("Cloudflare worker", () => {
  const groupNrec = "7936a2a43b11b20b01d30f5b00c73166";
  const currentInfo = { CurrentLesson: "", CurrentWeekType: 1, Name: "ПИ-124", CurrentSemester: 5 };
  const schedule = [{ type: "Lessons", name: "Понедельник", n1: "111-3, лб, Старовойтов Е.А., Базы данных" }];

  it("exposes verifiable deployment metadata", async () => {
    const response = await worker.fetch(new Request("https://app.example/app-api/health"), createEnv());
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Lad-Release")).toBe(RELEASE_CHANNEL);
    expect(response.headers.get("X-Lad-Worker-Version")).toBe("worker-version-id");
    expect(payload).toMatchObject({
      ok: true,
      release: RELEASE_CHANNEL,
      workerVersion: "worker-version-id",
      deployedAt: "2026-07-17T12:00:00.000Z"
    });
  });

  it("does not expose an arbitrary upstream proxy", async () => {
    const response = await worker.fetch(new Request("https://app.example/vlsu-api/private/unknown"), createEnv());
    expect(response.status).toBe(404);
  });

  it("stores and serves an atomic version 2 group snapshot", async () => {
    const snapshotKv = createSnapshotKv();
    const env = { ...createEnv(), SCHEDULE_SNAPSHOT: snapshotKv };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      return jsonResponseForTest(url.endsWith("/GetGroupCurrentInfo") ? currentInfo : schedule);
    }));

    const response = await worker.fetch(new Request(`https://app.example/app-api/schedule/${groupNrec}`), env);
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Lad-Data-Source")).toBe("live");
    expect(response.headers.get("X-Lad-Content-Hash")).toMatch(/^[a-f\d]{64}$/);
    expect(response.headers.get("X-Lad-Request-Id")).toBeTruthy();
    expect(payload).toMatchObject({
      schemaVersion: 2,
      semester: 5,
      weekType: 1,
      source: "live",
      group: { nrec: groupNrec, name: "ПИ-124" },
      quality: { valid: true, scheduleEntries: 1, lessonDays: 1, examEntries: 0 }
    });
    expect(snapshotKv.put).toHaveBeenCalledWith(`snapshot:v2:${groupNrec}:5`, expect.any(String));
    expect(snapshotKv.put).toHaveBeenCalledWith(`snapshot:v2:latest:${groupNrec}`, `snapshot:v2:${groupNrec}:5`);
    vi.unstubAllGlobals();
  });

  it("keeps the last valid v2 snapshot when VLSU returns an empty HTTP 200", async () => {
    const snapshotKv = createSnapshotKv();
    const env = { ...createEnv(), SCHEDULE_SNAPSHOT: snapshotKv };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      return jsonResponseForTest(url.endsWith("/GetGroupCurrentInfo") ? currentInfo : schedule);
    }));
    const first = await worker.fetch(new Request(`https://app.example/app-api/schedule/${groupNrec}`), env);
    const firstPayload = await first.json() as { contentHash: string };
    snapshotKv.put.mockClear();

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      return jsonResponseForTest(url.endsWith("/GetGroupCurrentInfo") ? currentInfo : []);
    }));
    const fallback = await worker.fetch(new Request(`https://app.example/app-api/schedule/${groupNrec}`), env);
    const fallbackPayload = await fallback.json() as { source: string; contentHash: string; schedule: unknown[] };

    expect(fallbackPayload.source).toBe("global-snapshot");
    expect(fallbackPayload.contentHash).toBe(firstPayload.contentHash);
    expect(fallbackPayload.schedule).toEqual(schedule);
    expect(snapshotKv.put).not.toHaveBeenCalledWith(`snapshot:v2:${groupNrec}:5`, expect.any(String));
    vi.unstubAllGlobals();
  });

  it("serves a saved group to the Pages origin without contacting VLSU", async () => {
    const snapshotKv = createSnapshotKv();
    const env = { ...createEnv(), SCHEDULE_SNAPSHOT: snapshotKv };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      return jsonResponseForTest(url.endsWith("/GetGroupCurrentInfo") ? currentInfo : schedule);
    }));
    await worker.fetch(new Request(`https://app.example/app-api/schedule/${groupNrec}`), env);
    const upstream = vi.fn(async () => { throw new Error("VLSU must not be contacted"); });
    vi.stubGlobal("fetch", upstream);

    const request = new Request(`https://app.example/app-api/schedule/${groupNrec}?cached=1`, {
      headers: { Origin: "https://germanpolkin.ru" }
    });
    const response = await worker.fetch(request, env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://germanpolkin.ru");
    expect(response.headers.get("Vary")).toContain("Origin");
    expect((await response.json() as { source: string }).source).toBe("global-snapshot");
    expect(upstream).not.toHaveBeenCalled();

    const missing = await worker.fetch(new Request(`https://app.example/app-api/schedule/${"b".repeat(32)}?cached=1`, {
      headers: { Origin: "https://gerakl-ai.github.io" }
    }), env);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("Access-Control-Allow-Origin")).toBe("https://gerakl-ai.github.io");
    expect(upstream).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("does not expose saved groups to an arbitrary cross-origin caller", async () => {
    const response = await worker.fetch(new Request(`https://app.example/app-api/schedule/${groupNrec}?cached=1`, {
      headers: { Origin: "https://untrusted.example" }
    }), { ...createEnv(), SCHEDULE_SNAPSHOT: createSnapshotKv() });
    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("discovers a missing group for Pages and keeps other origins out", async () => {
    const env = { ...createEnv(), SCHEDULE_SNAPSHOT: createSnapshotKv() };
    const upstream = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      return jsonResponseForTest(url.endsWith("/GetGroupCurrentInfo") ? currentInfo : schedule);
    });
    vi.stubGlobal("fetch", upstream);
    const url = `https://app.example/app-api/schedule/${groupNrec}?discover=1`;
    const denied = await worker.fetch(new Request(url, { headers: { Origin: "https://untrusted.example" } }), env);
    expect(denied.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();

    const response = await worker.fetch(new Request(url, { headers: { Origin: "https://germanpolkin.ru" } }), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://germanpolkin.ru");
    expect((await response.json() as { source: string }).source).toBe("live");
    expect(upstream).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("keeps the last valid v2 snapshot when VLSU returns days without lessons", async () => {
    const snapshotKv = createSnapshotKv();
    const env = { ...createEnv(), SCHEDULE_SNAPSHOT: snapshotKv };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      return jsonResponseForTest(url.endsWith("/GetGroupCurrentInfo") ? currentInfo : schedule);
    }));
    const first = await worker.fetch(new Request(`https://app.example/app-api/schedule/${groupNrec}`), env);
    const firstPayload = await first.json() as { contentHash: string };
    snapshotKv.put.mockClear();

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      return jsonResponseForTest(url.endsWith("/GetGroupCurrentInfo") ? currentInfo : [{ type: "Lessons", name: "Понедельник" }]);
    }));
    const fallback = await worker.fetch(new Request(`https://app.example/app-api/schedule/${groupNrec}`), env);
    const payload = await fallback.json() as { source: string; contentHash: string; schedule: unknown[] };

    expect(payload.source).toBe("global-snapshot");
    expect(payload.contentHash).toBe(firstPayload.contentHash);
    expect(payload.schedule).toEqual(schedule);
    expect(snapshotKv.put).not.toHaveBeenCalledWith(`snapshot:v2:${groupNrec}:5`, expect.any(String));
    vi.unstubAllGlobals();
  });

  it("enforces the method of each VLSU endpoint", async () => {
    const response = await worker.fetch(new Request("https://app.example/vlsu-api/student/GetGroupSchedule"), createEnv());
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });

  it("rejects cross-origin API calls", async () => {
    const response = await worker.fetch(new Request("https://app.example/app-api/schedule/" + "a".repeat(32), {
      headers: { Origin: "https://untrusted.example" }
    }), createEnv());

    expect(response.status).toBe(403);
  });

  it("adds release and security headers to static assets", async () => {
    const env = createEnv();
    const response = await worker.fetch(new Request("https://app.example/"), env);

    expect(await response.text()).toBe("app shell");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Permissions-Policy")).toBe("camera=(), geolocation=(), microphone=(self), payment=(), usb=()");
    expect(response.headers.get("Cache-Control")).toBe("no-cache, no-store, must-revalidate");
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
  });

  it("serves /index.html as a direct app shell response without a redirect", async () => {
    const env = createEnv();
    const response = await worker.fetch(new Request("https://app.example/index.html"), env);
    const assetRequest = (env.ASSETS.fetch as unknown as { mock: { calls: Array<[Request]> } }).mock.calls[0]?.[0];

    expect(assetRequest && new URL(assetRequest.url).pathname).toBe("/");
    expect(response.status).toBe(200);
    expect(response.redirected).toBe(false);
  });

  it("falls back to the last successful edge copy when VLSU is unavailable", async () => {
    const edgeCache = createEdgeCache();
    const env = { ...createEnv(), EDGE_CACHE: edgeCache };
    const snapshotKv = createSnapshotKv();
    const request = () => new Request("https://app.example/vlsu-api/student/GetGroupCurrentInfo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify("group-id")
    });
    const waitUntil: Promise<unknown>[] = [];
    const context = { waitUntil: (promise: Promise<unknown>) => waitUntil.push(promise) };

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponseForTest({ CurrentWeekType: 1 })));
    const live = await worker.fetch(request(), env, context);
    await Promise.all(waitUntil.splice(0));
    expect(live.headers.get("X-Lad-Data-Source")).toBe("live");

    Object.assign(env, { SCHEDULE_SNAPSHOT: snapshotKv });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const cached = await worker.fetch(request(), env, context);
    expect(cached.status).toBe(200);
    expect(cached.headers.get("X-Lad-Data-Source")).toBe("edge-cache");
    expect(await cached.json()).toEqual({ CurrentWeekType: 1 });
    await Promise.all(waitUntil.splice(0));
    expect(snapshotKv.put).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("serves a global KV snapshot in a new edge location when VLSU is unavailable", async () => {
    const snapshotKv = createSnapshotKv();
    const request = () => new Request("https://app.example/vlsu-api/student/GetGroupSchedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Nrec: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", WeekType: 0, WeekDays: "1,2,3,4,5,6" })
    });
    const firstWaitUntil: Promise<unknown>[] = [];
    const firstEnv = { ...createEnv(), EDGE_CACHE: createEdgeCache(), SCHEDULE_SNAPSHOT: snapshotKv };

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponseForTest(schedule)));
    const live = await worker.fetch(request(), firstEnv, { waitUntil: (promise) => firstWaitUntil.push(promise) });
    await Promise.all(firstWaitUntil);
    expect(live.headers.get("X-Lad-Data-Source")).toBe("live");
    expect(snapshotKv.put).toHaveBeenCalledTimes(2);
    expect(snapshotKv.put).toHaveBeenCalledWith("v2:active-groups", expect.any(String));

    const secondWaitUntil: Promise<unknown>[] = [];
    const secondEnv = { ...createEnv(), EDGE_CACHE: createEdgeCache(), SCHEDULE_SNAPSHOT: snapshotKv };
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const snapshot = await worker.fetch(request(), secondEnv, { waitUntil: (promise) => secondWaitUntil.push(promise) });
    expect(snapshot.status).toBe(200);
    expect(snapshot.headers.get("X-Lad-Data-Source")).toBe("global-snapshot");
    expect(snapshot.headers.get("X-Lad-Snapshot-At")).toBeTruthy();
    expect(await snapshot.json()).toEqual(schedule);
    await Promise.all(secondWaitUntil);
    vi.unstubAllGlobals();
  });

  it("does not overwrite resilient caches with an empty successful schedule response", async () => {
    const edgeCache = createEdgeCache();
    const snapshotKv = createSnapshotKv();
    const env = { ...createEnv(), EDGE_CACHE: edgeCache, SCHEDULE_SNAPSHOT: snapshotKv };
    const request = new Request("https://app.example/vlsu-api/student/GetGroupSchedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Nrec: "group-id", WeekType: 0, WeekDays: "1,2,3,4,5,6" })
    });
    const waitUntil: Promise<unknown>[] = [];

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponseForTest("")));
    const response = await worker.fetch(request, env, { waitUntil: (promise) => waitUntil.push(promise) });
    await Promise.all(waitUntil);

    expect(response.status).toBe(200);
    expect(edgeCache.put).not.toHaveBeenCalled();
    expect(snapshotKv.put).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("does not cache a successful schedule response containing only blank days", async () => {
    const edgeCache = createEdgeCache();
    const snapshotKv = createSnapshotKv();
    const env = { ...createEnv(), EDGE_CACHE: edgeCache, SCHEDULE_SNAPSHOT: snapshotKv };
    const request = new Request("https://app.example/vlsu-api/student/GetGroupSchedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Nrec: groupNrec, WeekType: 0, WeekDays: "1,2,3,4,5,6" })
    });
    const waitUntil: Promise<unknown>[] = [];

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponseForTest([{ type: "Lessons", name: "Понедельник" }])));
    await worker.fetch(request, env, { waitUntil: (promise) => waitUntil.push(promise) });
    await Promise.all(waitUntil);

    expect(edgeCache.put).not.toHaveBeenCalled();
    expect(snapshotKv.put).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("refreshes snapshots for groups registered by schedule traffic", async () => {
    const snapshotKv = createSnapshotKv();
    const env = { ...createEnv(), SCHEDULE_SNAPSHOT: snapshotKv };
    const waitUntil: Promise<unknown>[] = [];
    const cronCurrentInfo = { CurrentLesson: "", CurrentWeekType: 1, Name: "PI-124", CurrentSemester: 4 };
    const cronSchedule = [{ type: "Lessons", name: "Monday", n1: "111-3, lab, Databases" }];

    await snapshotKv.put("v2:active-groups", JSON.stringify([{
      nrec: "7936a2a43b11b20b01d30f5b00c73166",
      lastSeenAt: new Date().toISOString()
    }]));
    snapshotKv.put.mockClear();

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      return jsonResponseForTest(url.endsWith("/GetGroupCurrentInfo") ? cronCurrentInfo : cronSchedule);
    }));
    worker.scheduled(
      { cron: "*/15 * * * *", scheduledTime: Date.now() },
      env,
      { waitUntil: (promise) => waitUntil.push(promise) }
    );
    await Promise.all(waitUntil);

    expect(snapshotKv.put).toHaveBeenCalledTimes(2);

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const snapshotResponse = await worker.fetch(new Request(`https://app.example/app-api/schedule/${groupNrec}`), env);
    const snapshot = await snapshotResponse.json() as { source: string; currentInfo: unknown; schedule: unknown };

    expect(snapshot.source).toBe("global-snapshot");
    expect(snapshot.currentInfo).toEqual(cronCurrentInfo);
    expect(snapshot.schedule).toEqual(cronSchedule);
    vi.unstubAllGlobals();
  });
});

function jsonResponseForTest(payload: unknown) {
  return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
}
