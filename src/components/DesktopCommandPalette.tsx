import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, CornerDownLeft, Search, X, type LucideIcon } from "lucide-react";

export interface DesktopCommand {
  id: string;
  label: string;
  description: string;
  category: string;
  keywords?: string;
  icon: LucideIcon;
  run: () => void;
}

interface DesktopCommandPaletteProps {
  open: boolean;
  commands: DesktopCommand[];
  onClose: () => void;
  shortcutLabel: string;
}

export function DesktopCommandPalette({ open, commands, onClose, shortcutLabel }: DesktopCommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredCommands = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ru");
    if (!normalizedQuery) return commands;
    return commands.filter((command) => [command.label, command.description, command.category, command.keywords]
      .filter(Boolean).join(" ").toLocaleLowerCase("ru").includes(normalizedQuery));
  }, [commands, query]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
    setActiveIndex(0);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => setActiveIndex((index) => Math.min(index, Math.max(0, filteredCommands.length - 1))), [filteredCommands.length]);

  if (!open) return null;

  function runCommand(index: number) {
    const command = filteredCommands[index];
    if (!command) return;
    onClose();
    command.run();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const option = (event.target as HTMLElement).closest<HTMLElement>("[role='option']");
      if (option) {
        event.preventDefault();
        const nextIndex = Math.max(0, Math.min(filteredCommands.length - 1, activeIndex + direction));
        setActiveIndex(nextIndex);
        dialogRef.current?.querySelectorAll<HTMLButtonElement>("[role='option']")[nextIndex]?.focus();
      } else if (event.target === inputRef.current && filteredCommands.length) {
        event.preventDefault();
        setActiveIndex((index) => (index + direction + filteredCommands.length) % filteredCommands.length);
      }
      return;
    }
    if (event.key === "Enter" && event.target === inputRef.current) {
      event.preventDefault();
      runCommand(activeIndex);
      return;
    }
    if (event.key === "Tab") {
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])") ?? [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  return createPortal(
    <div className="desktop-command-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="desktop-command-palette" role="dialog" aria-modal="true" aria-label="Быстрый переход" onKeyDown={handleKeyDown}>
        <header className="desktop-command-header">
          <span><Search size={18} aria-hidden="true" /> Быстрый переход</span>
          <button type="button" onClick={onClose} aria-label="Закрыть" title="Закрыть"><X size={18} /></button>
        </header>
        <label className="desktop-command-search">
          <Search size={21} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label="Найти команду"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls="desktop-command-options"
            aria-activedescendant={filteredCommands[activeIndex] ? `desktop-command-${filteredCommands[activeIndex].id}` : undefined}
            placeholder="Куда перейти или что сделать?"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
          />
          {query && <button type="button" onClick={() => { setQuery(""); setActiveIndex(0); }} aria-label="Очистить поиск" title="Очистить"><X size={17} /></button>}
        </label>
        <div className="desktop-command-results" id="desktop-command-options" role="listbox" aria-label="Команды">
          {filteredCommands.length ? filteredCommands.map((command, index) => {
            const Icon = command.icon;
            return (
              <button
                key={command.id}
                id={`desktop-command-${command.id}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={index === activeIndex ? "active" : ""}
                onMouseEnter={() => setActiveIndex(index)}
                onFocus={() => setActiveIndex(index)}
                onClick={() => runCommand(index)}
              >
                <span className="desktop-command-icon"><Icon size={18} aria-hidden="true" /></span>
                <span className="desktop-command-copy"><strong>{command.label}</strong><small>{command.description}</small></span>
                <span className="desktop-command-category">{command.category}</span>
                <CornerDownLeft className="desktop-command-enter" size={15} aria-hidden="true" />
              </button>
            );
          }) : <p className="desktop-command-empty">Команда не найдена</p>}
        </div>
        <footer className="desktop-command-footer">
          <span><kbd><ArrowUp size={11} /></kbd><kbd><ArrowDown size={11} /></kbd> выбор</span>
          <span><kbd><CornerDownLeft size={11} /></kbd> открыть</span>
          <span><kbd>Esc</kbd> закрыть</span>
          <small>{shortcutLabel}</small>
        </footer>
      </section>
    </div>,
    document.body
  );
}
