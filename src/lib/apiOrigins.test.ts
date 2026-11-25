import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasRemoteScheduleFallback,
  resolveAppApiOrigin,
  resolveVlsuApiBase
} from "./apiOrigins";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveVlsuApiBase", () => {
  it("uses root /vlsu-api on same-origin deploy", () => {
    vi.stubEnv("BASE_URL", "/");
    expect(resolveVlsuApiBase()).toBe("/vlsu-api");
  });

  it("uses base-relative /lad-vlsu/vlsu-api on GitHub Pages", () => {
    vi.stubEnv("BASE_URL", "/lad-vlsu/");
    expect(resolveVlsuApiBase()).toBe("/lad-vlsu/vlsu-api");
  });

  it("respects explicit VITE_VLSU_API_BASE", () => {
    vi.stubEnv("VITE_VLSU_API_BASE", "https://api.example/vlsu-api/");
    expect(resolveVlsuApiBase()).toBe("https://api.example/vlsu-api");
  });
});

describe("resolveAppApiOrigin", () => {
  it("returns null on GitHub Pages (no cross-origin app-api)", () => {
    vi.stubEnv("BASE_URL", "/lad-vlsu/");
    expect(resolveAppApiOrigin()).toBeNull();
  });
});

describe("hasRemoteScheduleFallback", () => {
  it("is false when VITE_SCHEDULE_FALLBACK_URL is unset", () => {
    expect(hasRemoteScheduleFallback()).toBe(false);
  });

  it("is true when Worker URL is configured", () => {
    vi.stubEnv("VITE_SCHEDULE_FALLBACK_URL", "https://worker.example");
    expect(hasRemoteScheduleFallback()).toBe(true);
  });
});