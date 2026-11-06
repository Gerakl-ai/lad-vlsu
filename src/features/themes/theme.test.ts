import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_ID,
  CUSTOM_THEME_STORAGE_KEY,
  DEFAULT_CUSTOM_THEME,
  readCustomTheme,
  readTheme,
  THEME_SCHEMA_VERSION,
  THEME_SCHEMA_VERSION_KEY,
  THEMES,
  THEME_STORAGE_KEY
} from "./theme";

describe("theme definitions", () => {
  it("keeps theme ids unique", () => {
    const ids = THEMES.map((theme) => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("starts with a complete light theme", () => {
    const initialTheme = THEMES.find((theme) => theme.id === DEFAULT_THEME_ID);

    expect(initialTheme).toBeDefined();
    expect(initialTheme?.isLight).toBe(true);
    expect(initialTheme?.themeColor).toBe(initialTheme?.colors[0]);
  });

  it("keeps the warm light and user-matched dark presets as the first two choices", () => {
    expect(THEMES[0]).toMatchObject({ id: "ember", isLight: true });
    expect(THEMES[1].id).toBe("obsidian");
    expect(THEMES[1].isLight).toBeFalsy();
    expect(THEMES[1].colors).toEqual(["#080b12", "#f7f9fc", "#ffffff", "#ff6b72"]);
    expect(DEFAULT_CUSTOM_THEME).toEqual({
      name: "Моя тема",
      mode: "dark",
      background: "#080b12",
      surface: "#131c2a",
      text: "#f7f9fc",
      muted: "#94a2b5",
      accent: "#ffffff",
      signal: "#ff6b72",
      success: "#61dfbd"
    });
  });

  it("migrates only the previous untouched dark custom palette to the white accent", () => {
    const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const previous = { ...DEFAULT_CUSTOM_THEME, name: "Мой свет", accent: "#72b8ff" };
    const values = new Map<string, string>([[CUSTOM_THEME_STORAGE_KEY, JSON.stringify(previous)]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); }
    } as unknown as Storage;

    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    try {
      expect(readCustomTheme()).toEqual(DEFAULT_CUSTOM_THEME);
      expect(JSON.parse(values.get(CUSTOM_THEME_STORAGE_KEY) ?? "null")).toEqual(DEFAULT_CUSTOM_THEME);

      const personalized = { ...previous, surface: "#172033" };
      values.set(CUSTOM_THEME_STORAGE_KEY, JSON.stringify(personalized));
      expect(readCustomTheme()).toEqual(personalized);
    } finally {
      if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });

  it("migrates an existing installation once and preserves later choices", () => {
    const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const values = new Map<string, string>([[THEME_STORAGE_KEY, "signal"]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); }
    } as unknown as Storage;

    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    try {
      expect(readTheme()).toBe(DEFAULT_THEME_ID);
      expect(values.get(THEME_SCHEMA_VERSION_KEY)).toBe(THEME_SCHEMA_VERSION);

      values.set(THEME_STORAGE_KEY, "obsidian");
      expect(readTheme()).toBe("obsidian");
    } finally {
      if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });
});
