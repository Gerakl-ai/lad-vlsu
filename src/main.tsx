import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { applyTheme, readTheme } from "./features/themes/theme";
import { assetUrl } from "./lib/assetUrl";
import { manageAppUpdates } from "./lib/appUpdate";
import { hasConstrainedFramePacing, shouldUseLiteVisuals } from "./lib/visualQuality";
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

function initializeVisualQuality() {
  const root = document.documentElement;
  if (root.dataset.visualQualityProbe === "started") return;
  root.dataset.visualQualityProbe = "started";

  const hints = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
  const quality = shouldUseLiteVisuals({
    deviceMemory: hints.deviceMemory,
    hardwareConcurrency: hints.hardwareConcurrency,
    saveData: hints.connection?.saveData
  });
  root.dataset.visualQuality = quality ? "lite" : "full";
  if (quality) return;

  let frame = 0;
  let previousTime = 0;
  let probing = false;
  let complete = false;
  let idleCallbackId: number | undefined;
  let fallbackTimer = 0;
  const intervals: number[] = [];

  const sample = (time: number) => {
    if (document.hidden) {
      frame = 0;
      previousTime = 0;
      intervals.length = 0;
      probing = false;
      return;
    }
    if (previousTime) intervals.push(time - previousTime);
    previousTime = time;
    if (intervals.length < 36) {
      frame = window.requestAnimationFrame(sample);
      return;
    }

    complete = true;
    probing = false;
    const threads = (navigator as Navigator & { hardwareConcurrency?: number }).hardwareConcurrency ?? 8;
    const narrowPhone = window.matchMedia("(max-width: 560px)").matches;
    if (hasConstrainedFramePacing(intervals) && (threads <= 4 || narrowPhone)) {
      root.dataset.visualQuality = "lite";
    }
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("pageshow", onPageShow);
  };

  const beginProbe = () => {
    if (complete || probing || document.hidden) return;
    probing = true;
    frame = window.requestAnimationFrame(sample);
  };
  const onVisibilityChange = () => {
    if (document.hidden) {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      previousTime = 0;
      intervals.length = 0;
      probing = false;
      return;
    }
    beginProbe();
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted && !complete) beginProbe();
  };
  const onPageHide = (event: PageTransitionEvent) => {
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    previousTime = 0;
    intervals.length = 0;
    probing = false;
    if (idleCallbackId !== undefined) {
      idleWindow.cancelIdleCallback?.(idleCallbackId);
      idleCallbackId = undefined;
    }
    if (fallbackTimer) {
      window.clearTimeout(fallbackTimer);
      fallbackTimer = 0;
    }
    if (!event.persisted) {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onPageShow);
    }
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  const idleWindow = window as typeof window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (idleWindow.requestIdleCallback) idleCallbackId = idleWindow.requestIdleCallback(beginProbe, { timeout: 1200 });
  else fallbackTimer = window.setTimeout(beginProbe, 500);

  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
}

commitAppViewportHeight();
syncDocumentVisibility();
applyTheme(readTheme());
initializeVisualQuality();
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
