export const SUPPORTED_INTERVAL_HOURS = [1, 2, 3, 4, 6, 8, 12, 24] as const;
export type SupportedIntervalHours = (typeof SUPPORTED_INTERVAL_HOURS)[number];

export interface ScheduleSettings {
  monitoringEnabled: boolean;
  checkIntervalHours: SupportedIntervalHours;
  activeStartHour: number;
  activeEndHour: number;
  timeZone?: string;
  notifyNoPublication?: boolean;
  lastScheduledAt?: Date | string | null;
  nextRunAt?: Date | string | null;
}

export type ScheduleDecisionReason =
  | "monitoring_paused"
  | "outside_active_hours"
  | "interval_not_elapsed"
  | "next_run_not_reached"
  | "final_daily_check"
  | "scheduled_check_due";

export interface ScheduleDecision {
  due: boolean;
  reason: ScheduleDecisionReason;
  message: string;
  localHour: number;
}

const SCHEDULE_TOLERANCE_MS = 60_000;

export function evaluateSchedule(
  settings: ScheduleSettings,
  now = new Date(),
): ScheduleDecision {
  validateSchedule(settings);
  if (Number.isNaN(now.getTime())) throw new TypeError("A valid current time is required.");

  const timeZone = settings.timeZone ?? "Europe/Istanbul";
  const localHour = getZonedHour(now, timeZone);
  if (!settings.monitoringEnabled) {
    return decision(false, "monitoring_paused", "Monitoring is paused.", localHour);
  }
  if (!isHourInsideWindow(localHour, settings.activeStartHour, settings.activeEndHour)) {
    return decision(
      false,
      "outside_active_hours",
      "Outside the configured active hours.",
      localHour,
    );
  }
  if (settings.notifyNoPublication && localHour === settings.activeEndHour) {
    return decision(
      true,
      "final_daily_check",
      "The configured final daily check is due.",
      localHour,
    );
  }

  const nextRunAt = parseOptionalDate(settings.nextRunAt, "nextRunAt");
  if (nextRunAt && now.getTime() + SCHEDULE_TOLERANCE_MS < nextRunAt.getTime()) {
    return decision(
      false,
      "next_run_not_reached",
      "The next scheduled run has not been reached.",
      localHour,
    );
  }

  const lastScheduledAt = parseOptionalDate(settings.lastScheduledAt, "lastScheduledAt");
  if (
    !nextRunAt &&
    lastScheduledAt &&
    now.getTime() - lastScheduledAt.getTime() <
      settings.checkIntervalHours * 3_600_000 - SCHEDULE_TOLERANCE_MS
  ) {
    return decision(
      false,
      "interval_not_elapsed",
      "The configured interval has not elapsed yet.",
      localHour,
    );
  }

  return decision(true, "scheduled_check_due", "Scheduled check is due.", localHour);
}

export function nextRunAtAfterCompletion(
  settings: Pick<
    ScheduleSettings,
    "checkIntervalHours" | "activeStartHour" | "activeEndHour" | "timeZone"
  >,
  completedAt: Date,
): Date {
  validateSchedule({ ...settings, monitoringEnabled: true });
  if (Number.isNaN(completedAt.getTime())) {
    throw new TypeError("A valid completion time is required.");
  }
  const timeZone = settings.timeZone ?? "Europe/Istanbul";
  let candidate = new Date(
    completedAt.getTime() + settings.checkIntervalHours * 3_600_000,
  );

  // The cron route runs hourly. Walk forward to the next eligible active hour;
  // the bounded loop covers more than a full week without date arithmetic that
  // would be fragile around time-zone transitions.
  for (let attempts = 0; attempts < 24 * 8; attempts += 1) {
    const hour = getZonedHour(candidate, timeZone);
    if (isHourInsideWindow(hour, settings.activeStartHour, settings.activeEndHour)) {
      return candidate;
    }
    candidate = new Date(candidate.getTime() + 3_600_000);
  }
  throw new Error("The next active monitoring hour could not be determined.");
}

export function getZonedHour(date: Date, timeZone: string): number {
  const hourPart = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(date)
    .find((part) => part.type === "hour")?.value;
  const hour = Number(hourPart);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error("The configured time zone could not be evaluated.");
  }
  return hour;
}

export function isHourInsideWindow(hour: number, startHour: number, endHour: number): boolean {
  if (startHour <= endHour) return hour >= startHour && hour <= endHour;
  return hour >= startHour || hour <= endHour;
}

function validateSchedule(settings: {
  checkIntervalHours: SupportedIntervalHours;
  activeStartHour: number;
  activeEndHour: number;
  timeZone?: string;
  monitoringEnabled: boolean;
}): void {
  if (!SUPPORTED_INTERVAL_HOURS.includes(settings.checkIntervalHours)) {
    throw new Error("The monitoring interval is unsupported.");
  }
  if (
    !Number.isInteger(settings.activeStartHour) ||
    !Number.isInteger(settings.activeEndHour) ||
    settings.activeStartHour < 0 ||
    settings.activeStartHour > 23 ||
    settings.activeEndHour < 0 ||
    settings.activeEndHour > 23
  ) {
    throw new Error("Active monitoring hours must be whole hours from 0 through 23.");
  }
  if (settings.timeZone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: settings.timeZone }).format(new Date(0));
    } catch {
      throw new Error("The monitoring time zone is invalid.");
    }
  }
}

function parseOptionalDate(
  value: Date | string | null | undefined,
  field: string,
): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${field} is invalid.`);
  return date;
}

function decision(
  due: boolean,
  reason: ScheduleDecisionReason,
  message: string,
  localHour: number,
): ScheduleDecision {
  return { due, reason, message, localHour };
}
