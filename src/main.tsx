import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { applyTheme, readTheme } from "./features/themes/theme";
import { assetUrl } from "./lib/assetUrl";
import { manageAppUpdates } from "./lib/appUpdate";
import "./styles.css";
import "./theme.css";
import "./features/notes/notes.css";

type ViewportOrientation = "portrait" | "landscape";

const stableViewportHeights: Record<ViewportOrientation, number> = { portrait: 0, landscape: 0 };
let keyboardOpen = false;
let viewportFrame = 0;
let appliedVisualHeight = 0;
let appliedVisualOffset = -1;

function viewportOrientation(): ViewportOrientation {
  return window.matchMedia("(orientation: landscape)").matches ? "landscape" : "portrait";
}

function commitAppViewportHeight() {
  const visualViewport = window.visualViewport;
  const visualHeight = Math.round(visualViewport?.height || window.innerHeight || document.documentElement.clientHeight);
  const orientation = viewportOrientation();
  const stableHeight = stableViewportHeights[orientation];
  const activeElement = document.activeElement;
  const editing = activeElement instanceof HTMLElement && (
    activeElement.isContentEditable || activeElement.matches("input, textarea, select, [role='textbox']")
  );
  const viewportLoss = Math.max(0, stableHeight > 0 ? stableHeight - visualHeight : 0);
  const threshold = keyboardOpen ? 64 : 104;
  const nextKeyboardOpen = Boolean(visualViewport && viewportLoss > threshold && (editing || keyboardOpen));

  keyboardOpen = nextKeyboardOpen;
  if (!keyboardOpen && visualHeight > 0) stableViewportHeights[orientation] = visualHeight;
  // Пока клавиатура закрыта, высоту задаёт CSS (100dvh) — это полный экран.
  // Раньше сюда всегда писалась высота видимой области, а она в установленном
  // приложении на iPhone не включает полосу домашнего индикатора: оболочка
  // заканчивалась выше неё, и под нижней панелью оставалась пустая полоса.
  if (keyboardOpen && stableHeight > 0) {
    document.documentElement.style.setProperty("--app-viewport-height", `${stableHeight}px`);
  } else {
    document.documentElement.style.removeProperty("--app-viewport-height");
  }
  if (Math.abs(visualHeight - appliedVisualHeight) > 1) {
    appliedVisualHeight = visualHeight;
    document.documentElement.style.setProperty("--visual-viewport-height", `${visualHeight}px`);
  }
  const visualOffset = Math.max(0, Math.round(visualViewport?.offsetTop ?? 0));
  if (Math.abs(visualOffset - appliedVisualOffset) > 1) {
    appliedVisualOffset = visualOffset;
    document.documentElement.style.setProperty("--visual-viewport-offset-top", `${visualOffset}px`);
  }
  document.documentElement.dataset.keyboard = keyboardOpen ? "open" : "closed";
}

function syncAppViewportHeight() {
  window.cancelAnimationFrame(viewportFrame);
  viewportFrame = window.requestAnimationFrame(commitAppViewportHeight);
}

function syncDocumentVisibility() {
  document.documentElement.dataset.appVisibility = document.hidden ? "hidden" : "visible";
}

commitAppViewportHeight();
syncDocumentVisibility();
applyTheme(readTheme());
window.addEventListener("resize", syncAppViewportHeight);
window.visualViewport?.addEventListener("resize", syncAppViewportHeight);
window.visualViewport?.addEventListener("scroll", syncAppViewportHeight);
window.addEventListener("orientationchange", syncAppViewportHeight);
document.addEventListener("focusin", syncAppViewportHeight);
document.addEventListener("focusout", syncAppViewportHeight);
document.addEventListener("visibilitychange", syncDocumentVisibility);

for (const eventName of ["gesturestart", "gesturechange", "gestureend"]) {
  document.addEventListener(eventName, (event) => event.preventDefault(), { passive: false });
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
(window as typeof window & { __ladBootComplete?: boolean }).__ladBootComplete = true;

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  const registerServiceWorker = () => {
    // Воркер лежит рядом с приложением: на проектном сайте Pages это подкаталог,
    // а не корень. Абсолютный путь дал бы 404 и область видимости всего домена.
    const base = import.meta.env.BASE_URL || "/";
    const workerUrl = `${base}sw.js`;
    navigator.serviceWorker.register(workerUrl, { updateViaCache: "none" })
      .then(async (registration) => {
        if (!registration) return;
        manageAppUpdates(registration, () => window.location.reload());
        await registration.update();
        if (!navigator.onLine) return;
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) {
          await new Promise<void>((resolve) => {
            navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
          });
        }
        void Promise.all(["hero-obsidian-campus.jpg", "hero-porcelain-campus.jpg"].map(async (name) => {
          const url = assetUrl(`images/${name}`);
          if (await caches.match(url)) return;
          // Drain the response so an unread image stream cannot hold the old worker alive.
          const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
          await response.arrayBuffer();
        })).catch(() => undefined);
      })
      .catch(() => {
        // PWA registration is progressive enhancement; the app still works online.
      });
  };

  // An unreachable image must not prevent installation of the offline shell.
  window.setTimeout(registerServiceWorker, 0);
}

if ("serviceWorker" in navigator && import.meta.env.DEV) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => registration.unregister());
  });
}
