const WORKER_FALLBACK = import.meta.env.VITE_SCHEDULE_FALLBACK_URL?.trim();

export function isPagesSubpathDeploy(): boolean {
  const base = import.meta.env.BASE_URL ?? "/";
  return base.replace(/\/$/, "") !== "";
}

export function normalizeHttpsOrigin(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Expected https worker origin");
  return parsed.origin;
}

/** База для каталогов ВлГУ: same-origin на Worker/preview, иначе HTTPS Worker на GitHub Pages. */
export function resolveVlsuApiBase(): string {
  const explicit = import.meta.env.VITE_VLSU_API_BASE?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  if (isPagesSubpathDeploy() && WORKER_FALLBACK) {
    return `${normalizeHttpsOrigin(WORKER_FALLBACK)}/vlsu-api`;
  }
  const base = import.meta.env.BASE_URL ?? "/";
  const rooted = `${base.replace(/\/?$/, "/")}vlsu-api`;
  return rooted.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/vlsu-api";
}

/** Origin для /app-api/* или null (относительный путь с текущего origin). */
export function resolveAppApiOrigin(): string | null {
  const explicit = import.meta.env.VITE_APP_API_BASE?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  if (isPagesSubpathDeploy() && WORKER_FALLBACK) {
    return normalizeHttpsOrigin(WORKER_FALLBACK);
  }
  return null;
}

export function isCrossOriginApiUrl(url: string): boolean {
  return url.startsWith("https://");
}