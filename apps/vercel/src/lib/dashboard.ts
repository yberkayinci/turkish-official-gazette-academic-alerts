import type { JsonValue } from "./domain/types";
import { getServerEnv } from "./env";
import { getSettingsRepository } from "./repositories/settings";
import { getStateRepository } from "./repositories/state";

const APP_VERSION = "0.1.0";

function asObject(value: JsonValue | null): Record<string, JsonValue> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : null;
}

function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value ? value : null;
}

function numberValue(value: JsonValue | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function buildDashboardData() {
  const env = getServerEnv();
  const settingsRepository = getSettingsRepository();
  const stateRepository = getStateRepository();
  const [snapshot, activity, lastRunValue] = await Promise.all([
    settingsRepository.getSnapshot(),
    stateRepository.listActivity(20),
    stateRepository.getLastRun(),
  ]);
  const lastRun = asObject(lastRunValue);
  const lastOutcome = stringValue(lastRun?.status);
  const setupReady =
    Boolean(snapshot.settings.primaryRecipient) &&
    Boolean(snapshot.settings.senderEmail) &&
    snapshot.secrets.resendApiKey.configured &&
    (snapshot.settings.aiMode === "off" || snapshot.secrets.geminiApiKey.configured);

  const statusState = !setupReady
    ? "setup"
    : !snapshot.settings.monitoringEnabled
      ? "paused"
      : lastOutcome === "error" || lastOutcome === "warning"
        ? "attention"
        : "healthy";
  const labels = {
    setup: "Setup required",
    paused: "Monitoring paused",
    attention: "Needs attention",
    healthy: "Monitoring active",
  } as const;
  const messages = {
    setup: "Complete email and analysis settings before enabling scheduled monitoring.",
    paused: "Settings are saved, but scheduled monitoring is currently paused.",
    attention: "The latest run failed or ended early. Review Activity and the official source links.",
    healthy: "The private scheduler and saved delivery configuration are ready.",
  } as const;
  const pro = env.cronProfile === "pro";

  return {
    app: {
      name: "Official Gazette Monitor",
      version: APP_VERSION,
      edition: "vercel" as const,
      timeZone: "Europe/Istanbul",
      officialSource: "https://www.resmigazete.gov.tr/",
    },
    owner: {
      ...(env.ownerEmail ? { email: env.ownerEmail } : {}),
      ...(env.ownerName ? { name: env.ownerName } : {}),
    },
    plan: {
      id: pro ? ("pro" as const) : ("hobby" as const),
      label: pro ? "Vercel Pro" : "Vercel Hobby",
      commercialUse: pro,
      allowedIntervals: pro ? [1, 2, 3, 4, 6, 8, 12, 24] : [24],
      schedulePrecision: pro
        ? "The hourly Cron starts within the configured minute; the app applies interval gating."
        : "Daily Cron may run at any point within its configured hour.",
    },
    revision: snapshot.revision,
    settings: snapshot.settings,
    secrets: snapshot.secrets,
    status: {
      state: statusState,
      label: labels[statusState],
      message: messages[statusState],
      lastRunAt: stringValue(lastRun?.completedAt),
      nextRunAt: snapshot.nextRunAt?.toISOString() ?? null,
      lastRunOutcome:
        lastOutcome === "success" || lastOutcome === "warning" || lastOutcome === "error"
          ? lastOutcome
          : ("never" as const),
      processedPublicationCount: numberValue(lastRun?.publicationsProcessed),
      lastMatchCount: numberValue(lastRun?.confirmedPositionCount),
      scheduler: pro ? "Hourly Vercel Cron with runtime gating" : "Daily Vercel Hobby Cron",
    },
    activity: activity.map((item) => ({
      id: String(item.id),
      type: item.eventType,
      status: item.status,
      message: item.message,
      occurredAt: item.createdAt.toISOString(),
    })),
  };
}
