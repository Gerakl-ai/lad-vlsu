/** Публикация на GitHub Pages: только статика + same-origin пути (proxy при Workers/preview). */
export function isPagesSubpathDeploy(): boolean {
  const base = import.meta.env.BASE_URL ?? "/";
  return base.replace(/\/$/, "") !== "";
}

export function hasRemoteScheduleFallback(): boolean {
  return Boolean(import.meta.env.VITE_SCHEDULE_FALLBACK_URL?.trim());
}

export function resolveVlsuApiBase(): string {
  const explicit = import.meta.env.VITE_VLSU_API_BASE?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const base = import.meta.env.BASE_URL ?? "/";
  if (base.replace(/\/$/, "") === "") return "/vlsu-api";
  const rooted = `${base.replace(/\/?$/, "/")}vlsu-api`;
  return rooted.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/vlsu-api";
}

/** Origin для /app-api/* или null (относительный путь с текущего origin). */
export function resolveAppApiOrigin(): string | null {
  const explicit = import.meta.env.VITE_APP_API_BASE?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  return null;
}

export function isCrossOriginApiUrl(url: string): boolean {
  return url.startsWith("https://");
}