/**
 * Минимальный клиент публичного API ВлГУ для сборки статических снимков.
 *
 * Принципы:
 *  - вежливость к upstream: ограниченная параллельность, пауза между запросами,
 *    экспоненциальный backoff и жёсткий таймаут;
 *  - честный User-Agent со ссылкой на репозиторий, чтобы служба ВлГУ понимала,
 *    кто к ней ходит, и могла связаться;
 *  - строгая проверка ответов: пустой HTTP 200 считается сбоем, а не данными.
 */

export const API_BASE = "https://abiturient-api.vlsu.ru/api";

// Только ASCII: HTTP-заголовок не принимает кириллицу.
export const USER_AGENT =
  "LadVLSU-SnapshotBot/1.0 (+https://github.com/Gerakl-ai/lad-vlsu; open student schedule project)";

/** Формы обучения в терминах API ВлГУ. */
export const STUDY_FORMS = [
  { id: 0, key: "full-time", label: "Очная" },
  { id: 1, key: "extramural", label: "Заочная" },
  { id: 2, key: "part-time", label: "Очно-заочная" }
];

export class UpstreamError extends Error {
  constructor(message, { status, path, retryable = false } = {}) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
    this.path = path;
    this.retryable = retryable;
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * ВлГУ иногда отдаёт JSON, завёрнутый в JSON-строку: `"[{...}]"` вместо `[{...}]`.
 * Клиент приложения разбирает это так же (decodeApiPayload в src/lib/scheduleApi.ts).
 */
export function decodePayload(payload) {
  if (typeof payload !== "string") return payload;
  const trimmed = payload.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return payload;
  try {
    return JSON.parse(trimmed);
  } catch {
    return payload;
  }
}

/**
 * Один запрос к API с таймаутом. Пустое тело при HTTP 200 — это сбой ВлГУ,
 * который мы ловили вживую: он не должен выглядеть как «расписания нет».
 */
async function requestOnce(path, { method = "GET", body, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        ...(body === undefined ? {} : { "Content-Type": "application/json" })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });

    const text = await response.text();

    if (!response.ok) {
      throw new UpstreamError(`HTTP ${response.status}`, {
        status: response.status,
        path,
        retryable: isRetryableStatus(response.status)
      });
    }

    if (!text.trim()) {
      throw new UpstreamError("пустой ответ при HTTP 200", {
        status: 200,
        path,
        retryable: true
      });
    }

    try {
      return assertNotEmptyPayload(decodePayload(JSON.parse(text)), path);
    } catch (error) {
      if (error instanceof UpstreamError) throw error;
      throw new UpstreamError("ответ не является корректным JSON", {
        status: 200,
        path,
        retryable: false
      });
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Запрос с повторами: только для тех сбоев, которые имеет смысл повторять. */
export async function request(path, options = {}) {
  const { retries = 2, timeoutMs = 15_000, backoffMs = 800 } = options;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await requestOnce(path, { ...options, timeoutMs });
    } catch (error) {
      lastError = error;
      const abortedByTimeout = error?.name === "AbortError" || error?.message === "timeout";
      const retryable = error instanceof UpstreamError ? error.retryable : true;
      if (!retryable && !abortedByTimeout) break;
      if (attempt === retries) break;
      await sleep(backoffMs * 2 ** attempt);
    }
  }

  throw lastError;
}

/**
 * ВлГУ умеет отвечать HTTP 200 с пустой строкой вместо данных — вживую так себя
 * ведёт GetGroupSchedule во время сбоя. Это отказ upstream, а не «занятий нет»,
 * поэтому такой ответ обязан попадать в отчёт как сбой и не доходить до диска.
 */
function assertNotEmptyPayload(payload, path) {
  if (typeof payload === 'string' && payload.trim() === '') {
    throw new UpstreamError('ВлГУ вернул пустой ответ вместо данных (HTTP 200)', {
      status: 200,
      path,
      retryable: true
    });
  }
  return payload;
}

function asArray(payload, label) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object" && Array.isArray(payload.value)) return payload.value;
  throw new UpstreamError(`неожиданная форма ответа: ${label}`, { retryable: false });
}

export async function fetchInstitutes(options) {
  const payload = await request("/catalogs/GetInstitutes", { method: "GET", ...options });
  const institutes = asArray(payload, "institutes")
    .filter((item) => item && typeof item.Value === "string" && typeof item.Text === "string")
    .map((item) => ({ id: item.Value, name: item.Text.trim() }))
    .filter((item) => item.id && item.name);

  if (!institutes.length) {
    throw new UpstreamError("каталог институтов пуст", { retryable: true });
  }
  return institutes;
}

export async function fetchGroups(instituteId, studyForm, options) {
  const payload = await request("/student/GetStudGroups", {
    method: "POST",
    body: { Institut: instituteId, WFormed: studyForm },
    ...options
  });

  return asArray(payload, "groups")
    .filter((item) => item && typeof item.Nrec === "string" && typeof item.Name === "string")
    .map((item) => ({
      nrec: item.Nrec,
      name: item.Name.trim(),
      course: typeof item.Course === "string" ? item.Course.trim() : ""
    }))
    .filter((item) => /^[a-f\d]{32}$/i.test(item.nrec) && item.name);
}

export async function fetchGroupSchedule(nrec, options) {
  const payload = await request("/student/GetGroupSchedule", {
    method: "POST",
    body: { Nrec: nrec, WeekType: 0, WeekDays: "1,2,3,4,5,6" },
    ...options
  });
  return asArray(payload, "schedule");
}

export async function fetchGroupCurrentInfo(nrec, options) {
  // Этот эндпоинт принимает groupNrec как JSON-строку, а не как объект.
  const payload = await request("/student/GetGroupCurrentInfo", {
    method: "POST",
    body: nrec,
    ...options
  });
  if (!payload || typeof payload !== "object") {
    throw new UpstreamError("неожиданная форма ответа: current info", { retryable: false });
  }
  return payload;
}

/**
 * Выполняет задачи с ограничением параллельности и паузой между запусками.
 * Пауза важнее скорости: 973 запроса залпом в логах ВлГУ выглядят как атака.
 */
export async function runPolitely(items, worker, { concurrency = 3, delayMs = 200 } = {}) {
  const queue = [...items.entries()];
  const results = new Array(items.length);

  async function drain() {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      const [index, item] = next;
      results[index] = await worker(item, index);
      if (delayMs > 0) await sleep(delayMs);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, drain));
  return results;
}
