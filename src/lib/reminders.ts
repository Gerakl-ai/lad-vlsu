import type { LessonSlot, NotificationCapability, ReminderSettings, WeekMode } from "../types";
import { currentDayIndex, minutesFromTime, nowMinutes, selectDayLessons } from "./time";
import { assetUrl } from "./assetUrl";

const REMINDER_TIMER_KEY = "lad.reminder.timer.v2";
const NOTIFICATION_TIMEOUT_MS = 1800;

function isIOSDevice() {
  const nav = navigator as Navigator & { standalone?: boolean };
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) || nav.standalone === true;
}

export function isStandaloneDisplay() {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone === true;
}

export function getNotificationCapability(settings: ReminderSettings): NotificationCapability {
  const hasNotificationApi = typeof Notification !== "undefined";
  const hasServiceWorker = "serviceWorker" in navigator;
  const hasPushManager = "PushManager" in window;
  const isStandalone = isStandaloneDisplay();
  const isIOS = isIOSDevice();
  const permission = hasNotificationApi ? Notification.permission : settings.permission;

  if (!window.isSecureContext) {
    return {
      status: "unsupported",
      title: "Не поддерживается",
      detail: "Открой приложение через защищённую ссылку.",
      canRequestPermission: false,
      canSendNow: false,
      isStandalone,
      isIOS,
      hasServiceWorker,
      hasPushManager,
      hasNotificationApi
    };
  }

  if (!hasNotificationApi) {
    return {
      status: "unsupported",
      title: "Не поддерживается",
      detail: "Этот браузер не умеет показывать уведомления приложения.",
      canRequestPermission: false,
      canSendNow: false,
      isStandalone,
      isIOS,
      hasServiceWorker,
      hasPushManager,
      hasNotificationApi
    };
  }

  if (permission === "denied") {
    return {
      status: "denied",
      title: "Разрешение отклонено",
      detail: "Разреши уведомления в настройках браузера или iOS, затем вернись в приложение.",
      canRequestPermission: false,
      canSendNow: false,
      isStandalone,
      isIOS,
      hasServiceWorker,
      hasPushManager,
      hasNotificationApi
    };
  }

  if (isIOS && !isStandalone) {
    return {
      status: "install-required",
      title: "Нужно установить на экран Домой",
      detail: "Добавь приложение на экран Домой, затем открой его оттуда.",
      canRequestPermission: false,
      canSendNow: false,
      isStandalone,
      isIOS,
      hasServiceWorker,
      hasPushManager,
      hasNotificationApi
    };
  }

  if (permission !== "granted") {
    return {
      status: "permission-needed",
      title: "Нужно разрешение",
      detail: "Нажми “Включить”, чтобы браузер показал системный запрос.",
      canRequestPermission: true,
      canSendNow: false,
      isStandalone,
      isIOS,
      hasServiceWorker,
      hasPushManager,
      hasNotificationApi
    };
  }

  return {
    status: "available",
    title: "Доступно",
    detail: hasServiceWorker
      ? "Напоминания работают, пока приложение открыто. После закрытия они могут не прийти."
      : "Уведомления доступны, пока приложение открыто.",
    canRequestPermission: false,
    canSendNow: true,
    isStandalone,
    isIOS,
    hasServiceWorker,
    hasPushManager,
    hasNotificationApi
  };
}

export async function requestNotificationPermission() {
  if (typeof Notification === "undefined") return "unsupported" as const;
  if (Notification.permission !== "default") return Notification.permission;
  return Notification.requestPermission();
}

function timeout<T>(promise: Promise<T>, fallback: T) {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => window.setTimeout(() => resolve(fallback), NOTIFICATION_TIMEOUT_MS))
  ]);
}

async function activeServiceWorkerRegistration() {
  if (!("serviceWorker" in navigator)) return null;
  const ready = await timeout(navigator.serviceWorker.ready, null);
  return ready;
}

export async function sendLocalNotification(title: string, body: string, tag = "lad-test") {
  if (typeof Notification === "undefined") {
    throw new Error("Notification API is not available");
  }
  if (Notification.permission !== "granted") {
    throw new Error("Notification permission is not granted");
  }

  const registration = await activeServiceWorkerRegistration();
  if (registration) {
    await registration.showNotification(title, {
      body,
      tag,
      icon: assetUrl("icons/icon-192.png"),
      badge: assetUrl("icons/icon-192.png"),
      data: { url: "/" }
    });
    return;
  }

  new Notification(title, {
    body,
    tag,
    icon: assetUrl("icons/icon-192.png")
  });
}

export async function sendTestNotification() {
  await sendLocalNotification(
    "Лад ВлГУ: тест уведомлений",
    "Если ты видишь это сообщение, локальные уведомления работают.",
    "lad-test-now"
  );
}

export function canUseNotifications(settings: ReminderSettings) {
  return settings.enabled && getNotificationCapability(settings).canSendNow;
}

export function scheduleNextReminder(
  lessons: LessonSlot[],
  weekMode: WeekMode,
  settings: ReminderSettings,
  onScheduled?: (message: string) => void
) {
  const previous = Number(window.sessionStorage.getItem(REMINDER_TIMER_KEY));
  if (previous) window.clearTimeout(previous);

  if (!canUseNotifications(settings)) return;

  const today = selectDayLessons(lessons, currentDayIndex(), weekMode);
  const target = today.find((lesson) => minutesFromTime(lesson.start) - settings.minutesBefore > nowMinutes());
  if (!target) {
    onScheduled?.("На сегодня напоминаний больше нет");
    return;
  }

  const delayMs = (minutesFromTime(target.start) - settings.minutesBefore - nowMinutes()) * 60 * 1000;
  const timer = window.setTimeout(() => {
    sendLocalNotification(
      `Через ${settings.minutesBefore} мин: ${target.subject}`,
      `${target.start}-${target.end}${target.room ? `, ${target.room}` : ""}`,
      `lad-${target.id}`
    ).catch(() => onScheduled?.("Не удалось отправить напоминание. Проверь разрешения браузера."));
  }, Math.max(0, delayMs));

  window.sessionStorage.setItem(REMINDER_TIMER_KEY, String(timer));
  onScheduled?.(`Следующее напоминание: ${target.start}, ${target.subject}`);
}
