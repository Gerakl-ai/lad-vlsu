export type WeekMode = "all" | "numerator" | "denominator";

export type AppTab = "today" | "week" | "notes" | "settings";

export type ApiStatus =
  | "hydrating-from-cache"
  | "loading"
  | "ready"
  | "refreshing"
  | "updated"
  | "stale"
  | "error-without-cache";

export interface LessonVariant {
  subject: string;
  room?: string;
  kind?: string;
  teacher?: string;
  rawText: string;
}

export interface LessonSlot {
  id: string;
  dayIndex: number;
  dayName: string;
  date?: string;
  dateLabel?: string;
  validFrom?: string;
  validThrough?: string;
  scheduleKind?: "classes" | "exam";
  isConsultation?: boolean;
  pairIndex: number;
  start: string;
  end: string;
  subject: string;
  subjectKey?: string;
  room?: string;
  kind?: string;
  teacher?: string;
  variants?: LessonVariant[];
  rawText: string;
  weekMode: WeekMode;
  isCurrent?: boolean;
  isNext?: boolean;
}

export interface CurrentInfo {
  currentLesson: string;
  currentWeekType: 1 | 2;
  name: string;
  semester: number;
}

export type ScheduleDataSource = "live" | "edge-cache" | "global-snapshot" | "static-snapshot" | "pdf-ocr" | "device-cache";

export interface ScheduleQuality {
  valid: boolean;
  scheduleEntries: number;
  lessonDays: number;
  examEntries: number;
  warnings: string[];
}

export interface ScheduleState {
  groupNrec: string;
  currentInfo: CurrentInfo;
  allLessons: LessonSlot[];
  fetchedAt: string;
  validFrom?: string;
  validThrough?: string;
  /** Safety boundary for undated weekly data; not an official document period. */
  periodEstimated?: boolean;
  sourceDocument?: {
    title: string;
    url: string;
    sha256: string;
    reviewedAt: string;
  };
  weekTypeAsOf?: string;
  schemaVersion?: number;
  source?: ScheduleDataSource;
  snapshotAgeSeconds?: number;
  contentHash?: string;
  requestId?: string;
  /** Ссылка на коммит, которым этот снимок попал в приложение. */
  provenance?: { repository: string; commit: string; commitUrl: string; runUrl: string | null };
  quality?: ScheduleQuality;
}

export interface ReminderSettings {
  enabled: boolean;
  minutesBefore: number;
  permission: NotificationPermission | "unsupported";
}

export type NotificationSupportStatus =
  | "available"
  | "permission-needed"
  | "install-required"
  | "denied"
  | "unsupported";

export interface NotificationCapability {
  status: NotificationSupportStatus;
  title: string;
  detail: string;
  canRequestPermission: boolean;
  canSendNow: boolean;
  isStandalone: boolean;
  isIOS: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotificationApi: boolean;
}
