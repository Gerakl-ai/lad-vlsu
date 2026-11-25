import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAppApiOrigin, resolveVlsuApiBase } from "./apiOrigins";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveVlsuApiBase", () => {
  it("uses same-origin proxy on root deploy", () => {
    vi.stubEnv("BASE_URL", "/");
    expect(resolveVlsuApiBase()).toBe("/vlsu-api");
  });

  it("routes GitHub Pages builds through the worker fallback", () => {
    vi.stubEnv("BASE_URL", "/lad-vlsu/");
    vi.stubEnv("VITE_SCHEDULE_FALLBACK_URL", "https://vlsu-pi-124-schedule.polkin-06.workers.dev");
    expect(resolveVlsuApiBase()).toBe("https://vlsu-pi-124-schedule.polkin-06.workers.dev/vlsu-api");
  });

  it("respects explicit VITE_VLSU_API_BASE", () => {
    vi.stubEnv("VITE_VLSU_API_BASE", "https://api.example/vlsu-api/");
    expect(resolveVlsuApiBase()).toBe("https://api.example/vlsu-api");
  });
});

describe("resolveAppApiOrigin", () => {
  it("returns worker origin for Pages subpath", () => {
    vi.stubEnv("BASE_URL", "/lad-vlsu/");
    vi.stubEnv("VITE_SCHEDULE_FALLBACK_URL", "https://vlsu-pi-124-schedule.polkin-06.workers.dev");
    expect(resolveAppApiOrigin()).toBe("https://vlsu-pi-124-schedule.polkin-06.workers.dev");
  });

  it("returns null for same-origin worker deploy", () => {
    vi.stubEnv("BASE_URL", "/");
    expect(resolveAppApiOrigin()).toBeNull();
  });
});