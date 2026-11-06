export type ThemeId =
  | "ember"
  | "obsidian"
  | "porcelain"
  | "signal"
  | "field"
  | "midnight"
  | "aurora"
  | "glacier"
  | "atelier"
  | "custom";

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  caption: string;
  themeColor: string;
  colors: [string, string, string, string];
  isLight?: boolean;
  isCustom?: boolean;
}

export interface CustomTheme {
  name: string;
  mode: "dark" | "light";
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  signal: string;
  success: string;
}

export const THEME_STORAGE_KEY = "lad.theme";
export const CUSTOM_THEME_STORAGE_KEY = "lad.custom-theme";
export const THEME_SCHEMA_VERSION_KEY = "lad.theme-schema";
export const THEME_SCHEMA_VERSION = "2026-08-ember";
export const DEFAULT_THEME_ID: ThemeId = "ember";

export const DEFAULT_CUSTOM_THEME: CustomTheme = {
  name: "Моя тема",
  mode: "dark",
  background: "#080b12",
  surface: "#131c2a",
  text: "#f7f9fc",
  muted: "#94a2b5",
  accent: "#ffffff",
  signal: "#ff6b72",
  success: "#61dfbd"
};

export const THEMES: ThemeDefinition[] = [
  {
    id: "ember",
    name: "Ember Atelier",
    caption: "Тёплый фарфор, жжёный апельсин и глубокая бирюза",
    themeColor: "#f5eee5",
    colors: ["#f5eee5", "#211b17", "#c9602d", "#2f7d78"],
    isLight: true
  },
  {
    id: "obsidian",
    name: "Obsidian",
    caption: "Глубокий графит, белый текст и чистый белый свет",
    themeColor: "#080b12",
    colors: ["#080b12", "#f7f9fc", "#ffffff", "#ff6b72"]
  },
  {
    id: "porcelain",
    name: "Porcelain",
    caption: "Холодный фарфор, чернила и киноварь",
    themeColor: "#eef2f7",
    colors: ["#eef2f7", "#111827", "#2457d6", "#e4473e"],
    isLight: true
  },
  {
    id: "signal",
    name: "Signal Room",
    caption: "Карбон, эфирный красный и мятный свет",
    themeColor: "#090a0c",
    colors: ["#090a0c", "#f2f0ea", "#ff4d52", "#58dfc2"]
  },
  {
    id: "field",
    name: "Field Notes",
    caption: "Тёмный лес, сталь и сигнальный лайм",
    themeColor: "#07110f",
    colors: ["#07110f", "#edf3ee", "#bdd45a", "#78a9ff"]
  },
  {
    id: "midnight",
    name: "Midnight",
    caption: "Ночной индиго, ледяной свет и янтарный импульс",
    themeColor: "#070914",
    colors: ["#070914", "#f2f5ff", "#7aa2ff", "#ffbf69"]
  },
  {
    id: "aurora",
    name: "Aurora",
    caption: "Северная зелень, холодное стекло и розовый сигнал",
    themeColor: "#06110f",
    colors: ["#06110f", "#effff9", "#62e6c5", "#ff7895"]
  },
  {
    id: "glacier",
    name: "Glacier",
    caption: "Снежный воздух, глубокие чернила и арктический циан",
    themeColor: "#f1f7fb",
    colors: ["#f1f7fb", "#102333", "#087f9c", "#e75564"],
    isLight: true
  },
  {
    id: "atelier",
    name: "Atelier",
    caption: "Чистая бумага, ультрамарин и малиновая печать",
    themeColor: "#f7f5fa",
    colors: ["#f7f5fa", "#201b2c", "#4c5bd4", "#c53f68"],
    isLight: true
  },
  {
    id: "custom",
    name: "Своя тема",
    caption: "Персональная палитра из семи живых токенов",
    themeColor: DEFAULT_CUSTOM_THEME.background,
    colors: [DEFAULT_CUSTOM_THEME.background, DEFAULT_CUSTOM_THEME.text, DEFAULT_CUSTOM_THEME.accent, DEFAULT_CUSTOM_THEME.signal],
    isCustom: true
  }
];

const CUSTOM_PROPERTIES = [
  "--bg", "--bg-deep", "--surface", "--surface-strong", "--line", "--line-strong", "--text", "--muted",
  "--cyan", "--blue", "--coral", "--green", "--warning", "--ruby", "--ice", "--accent-rgb",
  "--accent-soft-rgb", "--signal-rgb", "--signal-deep-rgb", "--success-rgb", "--theme-body", "--theme-frame",
  "--theme-panel", "--theme-panel-solid", "--theme-panel-border", "--theme-control", "--theme-control-active",
  "--theme-nav", "--theme-nav-text", "--theme-grid-rgb", "--theme-image-filter", "--theme-image-opacity", "--shadow",
  "--status-bar-bg"
];

function isHex(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function hexToRgb(value: string) {
  const normalized = value.slice(1);
  return [Number.parseInt(normalized.slice(0, 2), 16), Number.parseInt(normalized.slice(2, 4), 16), Number.parseInt(normalized.slice(4, 6), 16)] as const;
}

function shiftHex(value: string, amount: number) {
  const rgb = hexToRgb(value).map((channel) => Math.max(0, Math.min(255, Math.round(channel + amount))));
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function rgbString(value: string) {
  return hexToRgb(value).join(", ");
}

function validCustomTheme(value: unknown): value is CustomTheme {
  if (!value || typeof value !== "object") return false;
  const theme = value as Record<string, unknown>;
  return (
    typeof theme.name === "string" &&
    (theme.mode === "dark" || theme.mode === "light") &&
    ["background", "surface", "text", "muted", "accent", "signal", "success"].every((key) => isHex(theme[key]))
  );
}

export function isThemeId(value: string | null): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

export function readTheme(): ThemeId {
  try {
    if (localStorage.getItem(THEME_SCHEMA_VERSION_KEY) !== THEME_SCHEMA_VERSION) {
      localStorage.setItem(THEME_SCHEMA_VERSION_KEY, THEME_SCHEMA_VERSION);
      localStorage.setItem(THEME_STORAGE_KEY, DEFAULT_THEME_ID);
      return DEFAULT_THEME_ID;
    }
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeId(stored)) return stored;
  } catch {
    // Storage can be unavailable in private browsing; the default remains usable.
  }
  return DEFAULT_THEME_ID;
}

export function readCustomTheme(): CustomTheme {
  try {
    const stored = localStorage.getItem(CUSTOM_THEME_STORAGE_KEY);
    if (!stored) return DEFAULT_CUSTOM_THEME;
    const parsed: unknown = JSON.parse(stored);
    if (!validCustomTheme(parsed)) return DEFAULT_CUSTOM_THEME;

    const isPreviousDefault =
      (parsed.name === "Мой свет" || parsed.name === "Моя тема") &&
      parsed.mode === "dark" &&
      parsed.background === "#080b12" &&
      parsed.surface === "#131c2a" &&
      parsed.text === "#f7f9fc" &&
      parsed.muted === "#94a2b5" &&
      parsed.accent === "#72b8ff" &&
      parsed.signal === "#ff6b72" &&
      parsed.success === "#61dfbd";

    if (!isPreviousDefault) return parsed;

    const migrated = { ...DEFAULT_CUSTOM_THEME };
    localStorage.setItem(CUSTOM_THEME_STORAGE_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return DEFAULT_CUSTOM_THEME;
  }
}

export function saveCustomTheme(theme: CustomTheme) {
  try {
    localStorage.setItem(CUSTOM_THEME_STORAGE_KEY, JSON.stringify(theme));
  } catch {
    // The live preview remains active even when persistence is unavailable.
  }
}

function clearCustomProperties() {
  CUSTOM_PROPERTIES.forEach((property) => document.documentElement.style.removeProperty(property));
}

function applyCustomProperties(theme: CustomTheme) {
  const root = document.documentElement;
  const deep = shiftHex(theme.background, theme.mode === "dark" ? -12 : -20);
  const strongSurface = shiftHex(theme.surface, theme.mode === "dark" ? 8 : 14);
  const signalDeep = shiftHex(theme.signal, -52);
  const accentSoft = shiftHex(theme.accent, theme.mode === "dark" ? 62 : 28);
  const navText = theme.muted;
  const imageFilter = theme.mode === "dark" ? "saturate(.72) contrast(1.12) brightness(.72)" : "saturate(.62) contrast(1.08) brightness(.82)";
  const values: Record<string, string> = {
    "--bg": theme.background,
    "--bg-deep": deep,
    "--surface": `rgba(${rgbString(theme.surface)}, .86)`,
    "--surface-strong": `rgba(${rgbString(strongSurface)}, .94)`,
    "--line": `rgba(${rgbString(accentSoft)}, .15)`,
    "--line-strong": `rgba(${rgbString(theme.accent)}, .58)`,
    "--text": theme.text,
    "--muted": theme.muted,
    "--cyan": theme.accent,
    "--blue": theme.signal,
    "--coral": theme.signal,
    "--green": theme.success,
    "--warning": shiftHex(theme.signal, 34),
    "--ruby": signalDeep,
    "--ice": accentSoft,
    "--accent-rgb": rgbString(theme.accent),
    "--accent-soft-rgb": rgbString(accentSoft),
    "--signal-rgb": rgbString(theme.signal),
    "--signal-deep-rgb": rgbString(signalDeep),
    "--success-rgb": rgbString(theme.success),
    "--theme-body": `linear-gradient(118deg, rgba(${rgbString(theme.accent)}, .12), transparent 38%), linear-gradient(316deg, rgba(${rgbString(theme.signal)}, .08), transparent 50%), ${theme.background}`,
    "--theme-frame": `repeating-linear-gradient(90deg, rgba(${rgbString(accentSoft)}, .025) 0 1px, transparent 1px 40px), radial-gradient(520px 360px at 92% -6%, rgba(${rgbString(theme.accent)}, .13), transparent 70%), linear-gradient(180deg, ${strongSurface}, ${deep})`,
    "--theme-panel": `linear-gradient(135deg, rgba(${rgbString(theme.text)}, .05), transparent 40%), linear-gradient(145deg, rgba(${rgbString(theme.surface)}, .94), rgba(${rgbString(deep)}, .96))`,
    "--theme-panel-solid": `rgba(${rgbString(theme.surface)}, .98)`,
    "--theme-panel-border": `rgba(${rgbString(theme.accent)}, .22)`,
    "--theme-control": `rgba(${rgbString(theme.accent)}, .1)`,
    "--theme-control-active": `rgba(${rgbString(theme.accent)}, .23)`,
    "--theme-nav": `linear-gradient(180deg, rgba(${rgbString(strongSurface)}, .99), rgba(${rgbString(deep)}, .995))`,
    "--theme-nav-text": navText,
    "--theme-grid-rgb": rgbString(accentSoft),
    "--theme-image-filter": imageFilter,
    "--theme-image-opacity": ".7",
    "--shadow": theme.mode === "dark" ? "0 30px 90px rgba(0, 0, 0, .58)" : "0 30px 90px rgba(25, 39, 60, .22)"
  };
  Object.entries(values).forEach(([property, value]) => root.style.setProperty(property, value));
}

export function applyTheme(themeId: ThemeId, customTheme = readCustomTheme()) {
  const theme = THEMES.find((item) => item.id === themeId) ?? THEMES[0];
  const custom = theme.id === "custom";
  const mode = custom ? customTheme.mode : theme.isLight ? "light" : "dark";
  const chromeColor = custom ? customTheme.background : theme.themeColor;
  clearCustomProperties();
  if (custom) applyCustomProperties(customTheme);
  document.documentElement.dataset.theme = theme.id;
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.style.colorScheme = mode;
  document.documentElement.style.backgroundColor = chromeColor;
  document.documentElement.style.setProperty("--status-bar-bg", chromeColor);
  document.body.style.backgroundColor = chromeColor;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", chromeColor);
  document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-status-bar-style"]')?.setAttribute(
    "content",
    mode === "light" ? "default" : "black-translucent"
  );
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme.id);
    localStorage.setItem(THEME_SCHEMA_VERSION_KEY, THEME_SCHEMA_VERSION);
  } catch {
    // Theme still applies for the current session.
  }
}
