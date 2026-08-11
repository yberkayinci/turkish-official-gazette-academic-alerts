export type ApiEnvelope<T> = {
  ok: boolean;
  data?: T;
  message?: string;
  error?: {
    code?: string;
    message?: string;
    fieldErrors?: Record<string, string>;
  };
};

export class DashboardApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly fieldErrors?: Record<string, string>;

  constructor(
    message: string,
    status: number,
    code?: string,
    fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "DashboardApiError";
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export async function requestJson<T>(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    signal,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  let envelope: ApiEnvelope<T> | null = null;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new DashboardApiError(
      response.ok
        ? "The server returned an unreadable response."
        : "The request could not be completed.",
      response.status,
    );
  }

  if (!response.ok || !envelope.ok || envelope.data === undefined) {
    throw new DashboardApiError(
      envelope.error?.message || envelope.message || "The request could not be completed.",
      response.status,
      envelope.error?.code,
      envelope.error?.fieldErrors,
    );
  }

  return envelope.data;
}

export type SessionData = {
  authenticated: boolean;
  owner: {
    email?: string;
    name?: string;
  } | null;
};

export type DeploymentPlan = {
  id: "hobby" | "pro" | "enterprise";
  label: string;
  commercialUse: boolean;
  allowedIntervals: number[];
  schedulePrecision: string;
};

export type AnalysisMode = "full" | "summary" | "off";
export type DeliveryPolicy = "matches_only" | "all_issues";

export type DashboardSettings = {
  version: 1;
  monitoringEnabled: boolean;
  primaryRecipient: string;
  additionalRecipients: string[];
  senderName: string;
  senderEmail: string;
  deliveryPolicy: DeliveryPolicy;
  notifyErrors: boolean;
  notifyNoPublication: boolean;
  checkIntervalHours: number;
  activeStartHour: number;
  activeEndHour: number;
  includeYesterday: boolean;
  includeSupplements: boolean;
  aiMode: AnalysisMode;
  summarizeHeadlines: boolean;
  customModel: string;
  includeHeadlines: boolean;
  requiredKeywords: string[];
  excludedKeywords: string[];
  preferredInstitutions: string[];
  includeCorrections: boolean;
  includeCancellations: boolean;
  includeUncertain: boolean;
};

export type MonitorStatus = {
  state: "healthy" | "attention" | "paused" | "setup";
  label: string;
  message: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastRunOutcome: "success" | "warning" | "error" | "never";
  processedPublicationCount: number;
  lastMatchCount: number;
  scheduler: string;
};

export type ActivityItem = {
  id: string;
  type: string;
  status: "success" | "warning" | "error" | "info";
  message: string;
  occurredAt: string;
};

export type DashboardData = {
  app: {
    name: string;
    version: string;
    edition: "vercel";
    timeZone: string;
    officialSource: string;
  };
  owner: {
    email?: string;
    name?: string;
  };
  plan: DeploymentPlan;
  revision: number;
  settings: DashboardSettings;
  secrets: {
    geminiApiKey: {
      configured: boolean;
      source: "database" | "environment" | "none";
    };
    resendApiKey: {
      configured: boolean;
      source: "database" | "environment" | "none";
    };
  };
  status: MonitorStatus;
  activity: ActivityItem[];
};

export type DashboardMutationResult = {
  dashboard: DashboardData;
  detail?: string;
};

export type SaveSettingsRequest = {
  expectedRevision: number;
  settings: DashboardSettings;
  geminiApiKey: SecretMutation;
  resendApiKey: SecretMutation;
};

export type SecretMutation =
  | { action: "preserve" }
  | { action: "replace"; value: string }
  | { action: "remove" };

export type SessionMutationResult = {
  authenticated: boolean;
  owner?: SessionData["owner"];
};
