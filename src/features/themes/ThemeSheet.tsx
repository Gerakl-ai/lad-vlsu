import { Check, Moon, Sun, Palette, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { DEFAULT_CUSTOM_THEME, THEMES, type CustomTheme, type ThemeId } from "./theme";

interface ThemeSheetProps {
  currentTheme: ThemeId;
  customTheme: CustomTheme;
  open: boolean;
  onClose: () => void;
  onCustomChange: (theme: CustomTheme) => void;
  onSelect: (theme: ThemeId) => void;
}

const COLOR_CONTROLS: Array<{ key: keyof Pick<CustomTheme, "background" | "surface" | "text" | "muted" | "accent" | "signal" | "success">; label: string }> = [
  { key: "background", label: "Фон" },
  { key: "surface", label: "Панели" },
  { key: "text", label: "Текст" },
  { key: "muted", label: "Вторичный" },
  { key: "accent", label: "Акцент" },
  { key: "signal", label: "Сигнал" },
  { key: "success", label: "Готово" }
];

const LIGHT_CUSTOM_THEME: CustomTheme = {
  name: "Мой свет",
  mode: "light",
  background: "#edf2f7",
  surface: "#ffffff",
  text: "#131a26",
  muted: "#627084",
  accent: "#2864d7",
  signal: "#db4b50",
  success: "#16866d"
};

const QUICK_ACCENTS = [
  { name: "Белый", value: "#ffffff" },
  { name: "Терракота", value: "#c9602d" },
  { name: "Бирюза", value: "#2f7d78" },
  { name: "Ультрамарин", value: "#4c5bd4" },
  { name: "Коралл", value: "#db4b50" },
  { name: "Лайм", value: "#9ab64b" }
] as const;

export function ThemeSheet({ currentTheme, customTheme, open, onClose, onCustomChange, onSelect }: ThemeSheetProps) {
  const [customOpen, setCustomOpen] = useState(currentTheme === "custom");

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);
  useEffect(() => { if (open) setCustomOpen(false); }, [open]);

  if (!open) return null;
  const mode = currentTheme === "custom" ? customTheme.mode : THEMES.find((theme) => theme.id === currentTheme)?.isLight ? "light" : "dark";
  const currentAccent = currentTheme === "custom" ? customTheme.accent : THEMES.find((theme) => theme.id === currentTheme)?.colors[2] ?? DEFAULT_CUSTOM_THEME.accent;

  function quickTheme(nextMode: "light" | "dark", accent?: string) {
    if (nextMode === mode && accent === undefined) return;
    const base = nextMode === "light" ? LIGHT_CUSTOM_THEME : DEFAULT_CUSTOM_THEME;
    const palette = currentTheme === "custom" && nextMode === mode ? customTheme : base;
    onCustomChange({ ...palette, name: "Моя тема", accent: accent ?? currentAccent });
  }

  function updateCustom(patch: Partial<CustomTheme>) {
    onCustomChange({ ...customTheme, ...patch });
  }

  function setCustomMode(mode: CustomTheme["mode"]) {
    if (mode === customTheme.mode) return;
    const surfaces = mode === "light" ? LIGHT_CUSTOM_THEME : DEFAULT_CUSTOM_THEME;
    onCustomChange({
      ...customTheme,
      mode,
      name: customTheme.name || surfaces.name,
      background: surfaces.background,
      surface: surfaces.surface,
      text: surfaces.text,
      muted: surfaces.muted
    });
  }

  return (
    <div className="sheet-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="theme-sheet" role="dialog" aria-modal="true" aria-labelledby="theme-sheet-title">
        <div className="sheet-handle" aria-hidden="true" />
        <header className="sheet-header">
          <div>
            <span className="sheet-kicker"><Palette size={14} /> Атмосфера</span>
            <h2 id="theme-sheet-title">Характер интерфейса</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть выбор темы" title="Закрыть">
            <X size={20} />
          </button>
        </header>

        <div className="theme-quick-controls">
          <div className="custom-mode" role="group" aria-label="Режим оформления">
            <button type="button" className={mode === "light" ? "active" : ""} aria-pressed={mode === "light"} onClick={() => quickTheme("light")}><Sun size={18} /> Светлая</button>
            <button type="button" className={mode === "dark" ? "active" : ""} aria-pressed={mode === "dark"} onClick={() => quickTheme("dark")}><Moon size={18} /> Тёмная</button>
          </div>
          <div className="theme-accent-picker" role="group" aria-label="Акцентный цвет">
            {QUICK_ACCENTS.map((accent) => <button key={accent.value} type="button" className={currentAccent.toLowerCase() === accent.value ? "active" : ""} style={{ "--swatch-color": accent.value } as CSSProperties} onClick={() => quickTheme(mode, accent.value)} aria-label={accent.name} title={accent.name} aria-pressed={currentAccent.toLowerCase() === accent.value}>{currentAccent.toLowerCase() === accent.value && <Check size={16} />}</button>)}
            <label className="theme-accent-custom" title="Свой цвет"><Palette size={17} /><input type="color" aria-label="Свой акцентный цвет" value={currentAccent} onChange={(event) => quickTheme(mode, event.target.value)} /></label>
          </div>
        </div>
        <button className="theme-advanced-toggle" type="button" onClick={() => setCustomOpen(!customOpen)} aria-expanded={customOpen}><SlidersHorizontal size={17} /> Точная настройка</button>
        <details className="theme-presets"><summary>Готовые палитры</summary><div className="theme-grid">
          {THEMES.filter((theme) => !theme.isCustom).map((theme) => {
            const active = currentTheme === theme.id;
            return (
              <button
                key={theme.id}
                className={`theme-option theme-option-${theme.id} ${active ? "active" : ""}`}
                type="button"
                onClick={() => onSelect(theme.id)}
                aria-pressed={active}
              >
                <span className="theme-preview" style={{ background: theme.colors[0] }} aria-hidden="true">
                  <span className="theme-preview-rail" style={{ background: theme.colors[2] }} />
                  <span className="theme-preview-card" style={{ borderColor: theme.colors[1] }} />
                  <span className="theme-preview-line" style={{ background: `linear-gradient(90deg, ${theme.colors[3]}, ${theme.colors[2]})` }} />
                </span>
                <span className="theme-option-copy">
                  <strong>{theme.name}</strong>
                  <small>{theme.caption}</small>
                  <span className="theme-swatches" aria-hidden="true">
                    {theme.colors.map((color) => <i key={color} style={{ background: color }} />)}
                  </span>
                </span>
                <span className="theme-check" aria-hidden="true">{active && <Check size={16} />}</span>
              </button>
            );
          })}

          <button
            className={`theme-option theme-option-custom ${currentTheme === "custom" ? "active" : ""}`}
            type="button"
            onClick={() => { setCustomOpen(true); onSelect("custom"); }}
            aria-pressed={currentTheme === "custom"}
          >
            <span className="theme-preview custom" style={{ background: customTheme.background }} aria-hidden="true">
              <span className="theme-preview-rail" style={{ background: customTheme.accent }} />
              <span className="theme-preview-card" style={{ background: customTheme.surface, borderColor: customTheme.muted }} />
              <span className="theme-preview-line" style={{ background: `linear-gradient(90deg, ${customTheme.signal}, ${customTheme.accent})` }} />
            </span>
            <span className="theme-option-copy">
              <strong>{customTheme.name || "Своя тема"}</strong>
              <small>Соберите палитру под себя</small>
              <span className="theme-swatches" aria-hidden="true">
                {[customTheme.background, customTheme.text, customTheme.accent, customTheme.signal].map((color, index) => <i key={`${color}-${index}`} style={{ background: color }} />)}
              </span>
            </span>
            <span className="theme-check" aria-hidden="true">{currentTheme === "custom" && <SlidersHorizontal size={16} />}</span>
          </button>
        </div></details>

        {customOpen && (
          <section className="custom-theme-editor" aria-label="Конструктор своей темы">
            <header>
              <label>
                <span>Название</span>
                <input value={customTheme.name} onChange={(event) => updateCustom({ name: event.target.value.slice(0, 22) })} aria-label="Название темы" />
              </label>
              <div className="custom-mode" role="group" aria-label="Светлая или тёмная тема">
                <button className={customTheme.mode === "dark" ? "active" : ""} type="button" onClick={() => setCustomMode("dark")}>Тёмная</button>
                <button className={customTheme.mode === "light" ? "active" : ""} type="button" onClick={() => setCustomMode("light")}>Светлая</button>
              </div>
            </header>
            <div className="custom-color-grid">
              {COLOR_CONTROLS.map(({ key, label }) => (
                <label key={key}>
                  <span>{label}</span>
                  <i style={{ background: customTheme[key] }} aria-hidden="true" />
                  <input type="color" value={customTheme[key]} onChange={(event) => updateCustom({ [key]: event.target.value })} aria-label={`${label}: ${customTheme[key]}`} />
                  <code>{customTheme[key]}</code>
                </label>
              ))}
            </div>
            <footer>
              <button type="button" onClick={() => onCustomChange(DEFAULT_CUSTOM_THEME)}><RotateCcw size={16} /> Сбросить</button>
              <button className="custom-theme-done" type="button" onClick={onClose}><Check size={17} /> Готово</button>
            </footer>
          </section>
        )}
      </section>
    </div>
  );
}
