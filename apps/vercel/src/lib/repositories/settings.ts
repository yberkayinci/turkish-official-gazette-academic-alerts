import { decryptSecret, encryptSecret } from "../crypto";
import { type Database, getDatabase } from "../db";
import { DEFAULT_APP_SETTINGS, parseStoredSettings, validateConfiguredSettings } from "../domain/settings";
import type {
  AppSettings,
  RuntimeSettings,
  SecretMutation,
  SecretSource,
  SettingsSnapshot,
  SettingsUpdate,
} from "../domain/types";
import { type ServerEnv, getServerEnv } from "../env";

const SETTINGS_ID = "default";
const GEMINI_CONTEXT = "settings:gemini-api-key";
const RESEND_CONTEXT = "settings:resend-api-key";

interface SettingsRow extends Record<string, unknown> {
  id: string;
  revision: number | string;
  config: unknown;
  gemini_api_key_encrypted: string | null;
  resend_api_key_encrypted: string | null;
  next_run_at: Date | string | null;
  last_scheduled_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export class SettingsConflictError extends Error {
  constructor() {
    super("Settings changed in another session. Reload the dashboard and try again.");
    this.name = "SettingsConflictError";
  }
}

export class SettingsConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsConfigurationError";
  }
}

function asDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("The database returned an invalid timestamp.");
  return date;
}

function sourceFor(encrypted: string | null, environmentValue?: string): SecretSource {
  if (encrypted) return "database";
  return environmentValue ? "environment" : "none";
}

function applySecretMutation(
  current: string | null,
  mutation: SecretMutation,
  encryptionKey: string,
  context: string,
): string | null {
  if (mutation.action === "preserve") return current;
  if (mutation.action === "remove") return null;
  return encryptSecret(mutation.value, encryptionKey, context);
}

function decryptOptional(value: string | null, key: string, context: string): string | null {
  return value ? decryptSecret(value, key, context) : null;
}

function rowSettings(row: SettingsRow): AppSettings {
  const config = typeof row.config === "string" ? JSON.parse(row.config) : row.config;
  return parseStoredSettings(config);
}

function snapshotFromRow(row: SettingsRow, env: ServerEnv): SettingsSnapshot {
  return {
    id: "default",
    revision: Number(row.revision),
    settings: rowSettings(row),
    secrets: {
      geminiApiKey: {
        configured: Boolean(row.gemini_api_key_encrypted || env.geminiApiKey),
        source: sourceFor(row.gemini_api_key_encrypted, env.geminiApiKey),
      },
      resendApiKey: {
        configured: Boolean(row.resend_api_key_encrypted || env.resendApiKey),
        source: sourceFor(row.resend_api_key_encrypted, env.resendApiKey),
      },
    },
    nextRunAt: asDate(row.next_run_at),
    lastScheduledAt: asDate(row.last_scheduled_at),
    createdAt: asDate(row.created_at) as Date,
    updatedAt: asDate(row.updated_at) as Date,
  };
}

export interface SettingsRepository {
  getSnapshot(): Promise<SettingsSnapshot>;
  getRuntimeSettings(): Promise<RuntimeSettings>;
  update(command: SettingsUpdate): Promise<SettingsSnapshot>;
  markScheduledRun(lastScheduledAt: Date, nextRunAt: Date | null): Promise<void>;
}

export class PostgresSettingsRepository implements SettingsRepository {
  constructor(
    private readonly db: Database = getDatabase(),
    private readonly env: ServerEnv = getServerEnv(),
  ) {}

  private async ensureRow(): Promise<void> {
    await this.db.query(
      `INSERT INTO app_settings (id, config)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [SETTINGS_ID, JSON.stringify(DEFAULT_APP_SETTINGS)],
    );
  }

  private async getRow(): Promise<SettingsRow> {
    await this.ensureRow();
    const rows = await this.db.query<SettingsRow>(
      `SELECT id, revision, config, gemini_api_key_encrypted, resend_api_key_encrypted,
              next_run_at, last_scheduled_at, created_at, updated_at
         FROM app_settings
        WHERE id = $1`,
      [SETTINGS_ID],
    );
    if (!rows[0]) throw new Error("The application settings row is missing.");
    return rows[0];
  }

  async getSnapshot(): Promise<SettingsSnapshot> {
    return snapshotFromRow(await this.getRow(), this.env);
  }

  async getRuntimeSettings(): Promise<RuntimeSettings> {
    const row = await this.getRow();
    const snapshot = snapshotFromRow(row, this.env);
    return {
      ...snapshot,
      runtimeSecrets: {
        geminiApiKey:
          decryptOptional(
            row.gemini_api_key_encrypted,
            this.env.appEncryptionKey,
            GEMINI_CONTEXT,
          ) ?? this.env.geminiApiKey ?? null,
        resendApiKey:
          decryptOptional(
            row.resend_api_key_encrypted,
            this.env.appEncryptionKey,
            RESEND_CONTEXT,
          ) ?? this.env.resendApiKey ?? null,
      },
    };
  }

  async update(command: SettingsUpdate): Promise<SettingsSnapshot> {
    const settings = validateConfiguredSettings(command.settings);
    if (settings.checkIntervalHours < this.env.schedulerMinIntervalHours) {
      throw new SettingsConfigurationError(
        `This deployment supports intervals of ${this.env.schedulerMinIntervalHours} hours or longer.`,
      );
    }

    const current = await this.getRow();
    const geminiEncrypted = applySecretMutation(
      current.gemini_api_key_encrypted,
      command.geminiApiKey,
      this.env.appEncryptionKey,
      GEMINI_CONTEXT,
    );
    const resendEncrypted = applySecretMutation(
      current.resend_api_key_encrypted,
      command.resendApiKey,
      this.env.appEncryptionKey,
      RESEND_CONTEXT,
    );
    const effectiveGemini = geminiEncrypted
      ? decryptSecret(geminiEncrypted, this.env.appEncryptionKey, GEMINI_CONTEXT)
      : this.env.geminiApiKey;
    const effectiveResend = resendEncrypted
      ? decryptSecret(resendEncrypted, this.env.appEncryptionKey, RESEND_CONTEXT)
      : this.env.resendApiKey;

    if (settings.aiMode !== "off" && !effectiveGemini) {
      throw new SettingsConfigurationError("A Gemini API key is required for the selected AI mode.");
    }
    if (settings.monitoringEnabled && !effectiveResend) {
      throw new SettingsConfigurationError("A Resend API key is required before monitoring can start.");
    }

    const rows = await this.db.query<SettingsRow>(
      `UPDATE app_settings
          SET config = $1::jsonb,
              gemini_api_key_encrypted = $2,
              resend_api_key_encrypted = $3,
              revision = revision + 1,
              updated_at = now()
        WHERE id = $4 AND revision = $5
      RETURNING id, revision, config, gemini_api_key_encrypted, resend_api_key_encrypted,
                next_run_at, last_scheduled_at, created_at, updated_at`,
      [
        JSON.stringify(settings),
        geminiEncrypted,
        resendEncrypted,
        SETTINGS_ID,
        command.expectedRevision,
      ],
    );
    if (!rows[0]) throw new SettingsConflictError();
    return snapshotFromRow(rows[0], this.env);
  }

  async markScheduledRun(lastScheduledAt: Date, nextRunAt: Date | null): Promise<void> {
    await this.ensureRow();
    await this.db.query(
      `UPDATE app_settings
          SET last_scheduled_at = $1::timestamptz,
              next_run_at = $2::timestamptz,
              updated_at = now()
        WHERE id = $3`,
      [lastScheduledAt.toISOString(), nextRunAt?.toISOString() ?? null, SETTINGS_ID],
    );
  }
}

let settingsRepository: SettingsRepository | null = null;

export function getSettingsRepository(): SettingsRepository {
  if (!settingsRepository) settingsRepository = new PostgresSettingsRepository();
  return settingsRepository;
}

export function setSettingsRepositoryForTests(value: SettingsRepository | null): void {
  settingsRepository = value;
}
