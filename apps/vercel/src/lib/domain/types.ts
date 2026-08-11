export const ALLOWED_INTERVAL_HOURS = [1, 2, 3, 4, 6, 8, 12, 24] as const;
export const ANALYSIS_MODES = ["full", "summary", "off"] as const;
export const DELIVERY_POLICIES = ["all_issues", "matches_only"] as const;

export type CheckIntervalHours = (typeof ALLOWED_INTERVAL_HOURS)[number];
export type AnalysisMode = (typeof ANALYSIS_MODES)[number];
export type DeliveryPolicy = (typeof DELIVERY_POLICIES)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface AppSettings {
  version: 1;
  monitoringEnabled: boolean;
  checkIntervalHours: CheckIntervalHours;
  activeStartHour: number;
  activeEndHour: number;
  includeYesterday: boolean;
  includeSupplements: boolean;
  aiMode: AnalysisMode;
  summarizeHeadlines: boolean;
  customModel: string;
  deliveryPolicy: DeliveryPolicy;
  senderName: string;
  senderEmail: string;
  primaryRecipient: string;
  additionalRecipients: string[];
  notifyErrors: boolean;
  notifyNoPublication: boolean;
  includeHeadlines: boolean;
  requiredKeywords: string[];
  excludedKeywords: string[];
  preferredInstitutions: string[];
  includeCorrections: boolean;
  includeCancellations: boolean;
  includeUncertain: boolean;
}

export type SecretSource = "database" | "environment" | "none";

export interface SecretStatus {
  configured: boolean;
  source: SecretSource;
}

export interface SettingsSecretStatus {
  geminiApiKey: SecretStatus;
  resendApiKey: SecretStatus;
}

export interface SettingsSnapshot {
  id: "default";
  revision: number;
  settings: AppSettings;
  secrets: SettingsSecretStatus;
  nextRunAt: Date | null;
  lastScheduledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RuntimeSettings extends SettingsSnapshot {
  runtimeSecrets: {
    geminiApiKey: string | null;
    resendApiKey: string | null;
  };
}

export type SecretMutation =
  | { action: "preserve" }
  | { action: "replace"; value: string }
  | { action: "remove" };

export interface SettingsUpdate {
  expectedRevision: number;
  settings: AppSettings;
  geminiApiKey: SecretMutation;
  resendApiKey: SecretMutation;
}

export type ActivityStatus = "success" | "warning" | "error" | "info";

export interface ActivityRecord {
  id: number;
  eventType: string;
  status: ActivityStatus;
  message: string;
  details: JsonValue | null;
  createdAt: Date;
}

export interface NewActivityRecord {
  eventType: string;
  status: ActivityStatus;
  message: string;
  details?: JsonValue | null;
}

export type PublicationProcessingStatus =
  | "processing"
  | "processed"
  | "sent"
  | "skipped"
  | "failed";

export interface ProcessedPublicationRecord {
  publicationKey: string;
  issueDate: string;
  sourceUrl: string;
  status: PublicationProcessingStatus;
  report: JsonValue | null;
  lastError: string | null;
  processedAt: Date;
  updatedAt: Date;
}

export interface SaveProcessedPublication {
  publicationKey: string;
  issueDate: string;
  sourceUrl: string;
  status: PublicationProcessingStatus;
  report?: JsonValue | null;
  lastError?: string | null;
}

export interface AnalysisCacheRecord {
  cacheKey: string;
  sourceUrl: string;
  model: string;
  promptVersion: string;
  payload: JsonValue;
  createdAt: Date;
  expiresAt: Date;
}

export interface SaveAnalysisCache {
  cacheKey: string;
  sourceUrl: string;
  model: string;
  promptVersion: string;
  payload: JsonValue;
  expiresAt: Date;
}

export type DeliveryStatus = "pending" | "sending" | "sent" | "failed";

export interface DeliveryRecord {
  deliveryKey: string;
  publicationKey: string;
  recipientFingerprint: string;
  status: DeliveryStatus;
  providerMessageId: string | null;
  attemptCount: number;
  lastError: string | null;
  sendingExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  sentAt: Date | null;
}

export interface JobLease {
  leaseName: string;
  ownerToken: string;
  expiresAt: Date;
  acquiredAt: Date;
}
