import { type Database, getDatabase } from "../db";
import type {
  ActivityRecord,
  AnalysisCacheRecord,
  DeliveryRecord,
  JsonValue,
  JobLease,
  NewActivityRecord,
  ProcessedPublicationRecord,
  SaveAnalysisCache,
  SaveProcessedPublication,
} from "../domain/types";

interface ActivityRow extends Record<string, unknown> {
  id: number | string;
  event_type: string;
  status: ActivityRecord["status"];
  message: string;
  details: unknown;
  created_at: Date | string;
}

interface ProcessedPublicationRow extends Record<string, unknown> {
  publication_key: string;
  issue_date: Date | string;
  source_url: string;
  status: ProcessedPublicationRecord["status"];
  report: unknown;
  last_error: string | null;
  processed_at: Date | string;
  updated_at: Date | string;
}

interface AnalysisCacheRow extends Record<string, unknown> {
  cache_key: string;
  source_url: string;
  model: string;
  prompt_version: string;
  payload: unknown;
  created_at: Date | string;
  expires_at: Date | string;
}

interface DeliveryRow extends Record<string, unknown> {
  delivery_key: string;
  publication_key: string;
  recipient_fingerprint: string;
  status: DeliveryRecord["status"];
  provider_message_id: string | null;
  attempt_count: number | string;
  last_error: string | null;
  sending_expires_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  sent_at: Date | string | null;
}

interface LeaseRow extends Record<string, unknown> {
  lease_name: string;
  owner_token: string;
  expires_at: Date | string;
  acquired_at: Date | string;
}

function toDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("The database returned an invalid timestamp.");
  return date;
}

function toOptionalDate(value: Date | string | null): Date | null {
  return value === null ? null : toDate(value);
}

function parseJsonValue(value: unknown): JsonValue | null {
  if (value === null || value === undefined) return null;
  return (typeof value === "string" ? JSON.parse(value) : value) as JsonValue;
}

function activityFromRow(row: ActivityRow): ActivityRecord {
  return {
    id: Number(row.id),
    eventType: row.event_type,
    status: row.status,
    message: row.message,
    details: parseJsonValue(row.details),
    createdAt: toDate(row.created_at),
  };
}

function publicationFromRow(row: ProcessedPublicationRow): ProcessedPublicationRecord {
  const issueDate = row.issue_date instanceof Date
    ? row.issue_date.toISOString().slice(0, 10)
    : String(row.issue_date).slice(0, 10);
  return {
    publicationKey: row.publication_key,
    issueDate,
    sourceUrl: row.source_url,
    status: row.status,
    report: parseJsonValue(row.report),
    lastError: row.last_error,
    processedAt: toDate(row.processed_at),
    updatedAt: toDate(row.updated_at),
  };
}

function cacheFromRow(row: AnalysisCacheRow): AnalysisCacheRecord {
  const payload = parseJsonValue(row.payload);
  if (payload === null) throw new Error("The analysis cache payload is missing.");
  return {
    cacheKey: row.cache_key,
    sourceUrl: row.source_url,
    model: row.model,
    promptVersion: row.prompt_version,
    payload,
    createdAt: toDate(row.created_at),
    expiresAt: toDate(row.expires_at),
  };
}

function deliveryFromRow(row: DeliveryRow): DeliveryRecord {
  return {
    deliveryKey: row.delivery_key,
    publicationKey: row.publication_key,
    recipientFingerprint: row.recipient_fingerprint,
    status: row.status,
    providerMessageId: row.provider_message_id,
    attemptCount: Number(row.attempt_count),
    lastError: row.last_error,
    sendingExpiresAt: toOptionalDate(row.sending_expires_at),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    sentAt: toOptionalDate(row.sent_at),
  };
}

const DELIVERY_COLUMNS = `delivery_key, publication_key, recipient_fingerprint, status,
  provider_message_id, attempt_count, last_error, sending_expires_at, created_at, updated_at, sent_at`;

export interface LoginRateLimitDecision {
  allowed: boolean;
  attempts: number;
  retryAt: Date | null;
}

export interface StateRepository {
  logActivity(event: NewActivityRecord): Promise<ActivityRecord>;
  listActivity(limit?: number): Promise<ActivityRecord[]>;
  getProcessedPublication(publicationKey: string): Promise<ProcessedPublicationRecord | null>;
  saveProcessedPublication(value: SaveProcessedPublication): Promise<ProcessedPublicationRecord>;
  clearProcessedPublications(): Promise<number>;
  pruneProcessedPublications(olderThan: Date): Promise<number>;
  getAnalysisCache(cacheKey: string, now?: Date): Promise<AnalysisCacheRecord | null>;
  saveAnalysisCache(value: SaveAnalysisCache): Promise<AnalysisCacheRecord>;
  clearAnalysisCache(): Promise<number>;
  pruneAnalysisCache(now?: Date): Promise<number>;
  acquireLease(leaseName: string, ownerToken: string, now: Date, ttlSeconds: number): Promise<JobLease | null>;
  releaseLease(leaseName: string, ownerToken: string): Promise<boolean>;
  createDelivery(deliveryKey: string, publicationKey: string, recipientFingerprint: string): Promise<DeliveryRecord>;
  claimDelivery(deliveryKey: string, now: Date, ttlSeconds: number): Promise<DeliveryRecord | null>;
  markDeliverySent(deliveryKey: string, providerMessageId: string, sentAt?: Date): Promise<void>;
  markDeliveryFailed(deliveryKey: string, errorMessage: string): Promise<void>;
  saveLastRun(summary: JsonValue): Promise<void>;
  getLastRun(): Promise<JsonValue | null>;
  getLoginRateLimit(identifierHash: string, now?: Date): Promise<LoginRateLimitDecision>;
  registerLoginFailure(
    identifierHash: string,
    now?: Date,
    policy?: { windowSeconds: number; maxAttempts: number; blockSeconds: number },
  ): Promise<LoginRateLimitDecision>;
  clearLoginFailures(identifierHash: string): Promise<void>;
}

export class PostgresStateRepository implements StateRepository {
  constructor(private readonly db: Database = getDatabase()) {}

  async logActivity(event: NewActivityRecord): Promise<ActivityRecord> {
    const rows = await this.db.query<ActivityRow>(
      `INSERT INTO activity_log (event_type, status, message, details)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING id, event_type, status, message, details, created_at`,
      [
        event.eventType.slice(0, 100),
        event.status,
        event.message.slice(0, 1_000),
        event.details === undefined || event.details === null
          ? null
          : JSON.stringify(event.details),
      ],
    );
    if (!rows[0]) throw new Error("The activity event could not be recorded.");
    return activityFromRow(rows[0]);
  }

  async listActivity(limit = 30): Promise<ActivityRecord[]> {
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const rows = await this.db.query<ActivityRow>(
      `SELECT id, event_type, status, message, details, created_at
         FROM activity_log
        ORDER BY created_at DESC, id DESC
        LIMIT $1`,
      [boundedLimit],
    );
    return rows.map(activityFromRow);
  }

  async getProcessedPublication(
    publicationKey: string,
  ): Promise<ProcessedPublicationRecord | null> {
    const rows = await this.db.query<ProcessedPublicationRow>(
      `SELECT publication_key, issue_date, source_url, status, report, last_error,
              processed_at, updated_at
         FROM processed_publications
        WHERE publication_key = $1`,
      [publicationKey],
    );
    return rows[0] ? publicationFromRow(rows[0]) : null;
  }

  async saveProcessedPublication(
    value: SaveProcessedPublication,
  ): Promise<ProcessedPublicationRecord> {
    const rows = await this.db.query<ProcessedPublicationRow>(
      `INSERT INTO processed_publications
        (publication_key, issue_date, source_url, status, report, last_error)
       VALUES ($1, $2::date, $3, $4, $5::jsonb, $6)
       ON CONFLICT (publication_key) DO UPDATE SET
         issue_date = EXCLUDED.issue_date,
         source_url = EXCLUDED.source_url,
         status = EXCLUDED.status,
         report = EXCLUDED.report,
         last_error = EXCLUDED.last_error,
         updated_at = now()
       RETURNING publication_key, issue_date, source_url, status, report, last_error,
                 processed_at, updated_at`,
      [
        value.publicationKey,
        value.issueDate,
        value.sourceUrl,
        value.status,
        value.report === undefined || value.report === null ? null : JSON.stringify(value.report),
        value.lastError?.slice(0, 2_000) ?? null,
      ],
    );
    if (!rows[0]) throw new Error("The publication state could not be saved.");
    return publicationFromRow(rows[0]);
  }

  async clearProcessedPublications(): Promise<number> {
    const rows = await this.db.query<{ deleted_count: number | string }>(
      `WITH deleted AS (DELETE FROM processed_publications RETURNING 1)
       SELECT count(*) AS deleted_count FROM deleted`,
    );
    return Number(rows[0]?.deleted_count ?? 0);
  }

  async pruneProcessedPublications(olderThan: Date): Promise<number> {
    const rows = await this.db.query<{ deleted_count: number | string }>(
      `WITH deleted AS (
         DELETE FROM processed_publications WHERE updated_at < $1::timestamptz RETURNING 1
       ) SELECT count(*) AS deleted_count FROM deleted`,
      [olderThan.toISOString()],
    );
    return Number(rows[0]?.deleted_count ?? 0);
  }

  async getAnalysisCache(cacheKey: string, now = new Date()): Promise<AnalysisCacheRecord | null> {
    const rows = await this.db.query<AnalysisCacheRow>(
      `SELECT cache_key, source_url, model, prompt_version, payload, created_at, expires_at
         FROM analysis_cache
        WHERE cache_key = $1 AND expires_at > $2::timestamptz`,
      [cacheKey, now.toISOString()],
    );
    return rows[0] ? cacheFromRow(rows[0]) : null;
  }

  async saveAnalysisCache(value: SaveAnalysisCache): Promise<AnalysisCacheRecord> {
    const rows = await this.db.query<AnalysisCacheRow>(
      `INSERT INTO analysis_cache
        (cache_key, source_url, model, prompt_version, payload, expires_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)
       ON CONFLICT (cache_key) DO UPDATE SET
         source_url = EXCLUDED.source_url,
         model = EXCLUDED.model,
         prompt_version = EXCLUDED.prompt_version,
         payload = EXCLUDED.payload,
         created_at = now(),
         expires_at = EXCLUDED.expires_at
       RETURNING cache_key, source_url, model, prompt_version, payload, created_at, expires_at`,
      [
        value.cacheKey,
        value.sourceUrl,
        value.model,
        value.promptVersion,
        JSON.stringify(value.payload),
        value.expiresAt.toISOString(),
      ],
    );
    if (!rows[0]) throw new Error("The analysis cache could not be saved.");
    return cacheFromRow(rows[0]);
  }

  async clearAnalysisCache(): Promise<number> {
    const rows = await this.db.query<{ deleted_count: number | string }>(
      `WITH deleted AS (DELETE FROM analysis_cache RETURNING 1)
       SELECT count(*) AS deleted_count FROM deleted`,
    );
    return Number(rows[0]?.deleted_count ?? 0);
  }

  async pruneAnalysisCache(now = new Date()): Promise<number> {
    const rows = await this.db.query<{ deleted_count: number | string }>(
      `WITH deleted AS (
         DELETE FROM analysis_cache WHERE expires_at <= $1::timestamptz RETURNING 1
       ) SELECT count(*) AS deleted_count FROM deleted`,
      [now.toISOString()],
    );
    return Number(rows[0]?.deleted_count ?? 0);
  }

  async acquireLease(
    leaseName: string,
    ownerToken: string,
    now: Date,
    ttlSeconds: number,
  ): Promise<JobLease | null> {
    const boundedTtl = Math.max(30, Math.min(3_600, Math.trunc(ttlSeconds)));
    const expiresAt = new Date(now.getTime() + boundedTtl * 1_000);
    const rows = await this.db.query<LeaseRow>(
      `INSERT INTO job_leases (lease_name, owner_token, acquired_at, expires_at)
       VALUES ($1, $2, $3::timestamptz, $4::timestamptz)
       ON CONFLICT (lease_name) DO UPDATE SET
         owner_token = EXCLUDED.owner_token,
         acquired_at = EXCLUDED.acquired_at,
         expires_at = EXCLUDED.expires_at,
         updated_at = now()
       WHERE job_leases.expires_at <= $3::timestamptz
          OR job_leases.owner_token = EXCLUDED.owner_token
       RETURNING lease_name, owner_token, expires_at, acquired_at`,
      [leaseName, ownerToken, now.toISOString(), expiresAt.toISOString()],
    );
    if (!rows[0]) return null;
    return {
      leaseName: rows[0].lease_name,
      ownerToken: rows[0].owner_token,
      expiresAt: toDate(rows[0].expires_at),
      acquiredAt: toDate(rows[0].acquired_at),
    };
  }

  async releaseLease(leaseName: string, ownerToken: string): Promise<boolean> {
    const rows = await this.db.query<{ released: string }>(
      `DELETE FROM job_leases
        WHERE lease_name = $1 AND owner_token = $2
      RETURNING lease_name AS released`,
      [leaseName, ownerToken],
    );
    return Boolean(rows[0]);
  }

  async createDelivery(
    deliveryKey: string,
    publicationKey: string,
    recipientFingerprint: string,
  ): Promise<DeliveryRecord> {
    await this.db.query(
      `INSERT INTO deliveries (delivery_key, publication_key, recipient_fingerprint)
       VALUES ($1, $2, $3)
       ON CONFLICT (delivery_key) DO NOTHING`,
      [deliveryKey, publicationKey, recipientFingerprint],
    );
    const rows = await this.db.query<DeliveryRow>(
      `SELECT ${DELIVERY_COLUMNS} FROM deliveries WHERE delivery_key = $1`,
      [deliveryKey],
    );
    if (!rows[0]) throw new Error("The delivery record could not be created.");
    return deliveryFromRow(rows[0]);
  }

  async claimDelivery(
    deliveryKey: string,
    now: Date,
    ttlSeconds: number,
  ): Promise<DeliveryRecord | null> {
    const boundedTtl = Math.max(30, Math.min(900, Math.trunc(ttlSeconds)));
    const sendingExpiresAt = new Date(now.getTime() + boundedTtl * 1_000);
    const rows = await this.db.query<DeliveryRow>(
      `UPDATE deliveries
          SET status = 'sending',
              attempt_count = attempt_count + 1,
              sending_expires_at = $2::timestamptz,
              last_error = NULL,
              updated_at = now()
        WHERE delivery_key = $1
          AND status <> 'sent'
          AND (status <> 'sending' OR sending_expires_at <= $3::timestamptz)
      RETURNING ${DELIVERY_COLUMNS}`,
      [deliveryKey, sendingExpiresAt.toISOString(), now.toISOString()],
    );
    return rows[0] ? deliveryFromRow(rows[0]) : null;
  }

  async markDeliverySent(
    deliveryKey: string,
    providerMessageId: string,
    sentAt = new Date(),
  ): Promise<void> {
    await this.db.query(
      `UPDATE deliveries
          SET status = 'sent', provider_message_id = $2, sent_at = $3::timestamptz,
              sending_expires_at = NULL, last_error = NULL, updated_at = now()
        WHERE delivery_key = $1`,
      [deliveryKey, providerMessageId.slice(0, 500), sentAt.toISOString()],
    );
  }

  async markDeliveryFailed(deliveryKey: string, errorMessage: string): Promise<void> {
    await this.db.query(
      `UPDATE deliveries
          SET status = 'failed', last_error = $2, sending_expires_at = NULL, updated_at = now()
        WHERE delivery_key = $1 AND status <> 'sent'`,
      [deliveryKey, errorMessage.slice(0, 2_000)],
    );
  }

  async saveLastRun(summary: JsonValue): Promise<void> {
    await this.db.query(
      `UPDATE app_settings SET last_run = $1::jsonb, updated_at = now() WHERE id = 'default'`,
      [JSON.stringify(summary)],
    );
  }

  async getLastRun(): Promise<JsonValue | null> {
    const rows = await this.db.query<{ last_run: unknown }>(
      `SELECT last_run FROM app_settings WHERE id = 'default'`,
    );
    return rows[0] ? parseJsonValue(rows[0].last_run) : null;
  }

  async getLoginRateLimit(
    identifierHash: string,
    now = new Date(),
  ): Promise<LoginRateLimitDecision> {
    const rows = await this.db.query<
      Record<string, unknown> & {
        attempts: number | string;
        blocked_until: Date | string | null;
      }
    >(
      `SELECT attempts, blocked_until
         FROM login_attempts
        WHERE identifier_hash = $1`,
      [identifierHash],
    );
    if (!rows[0]) return { allowed: true, attempts: 0, retryAt: null };
    const retryAt = rows[0].blocked_until ? toDate(rows[0].blocked_until) : null;
    return {
      allowed: !retryAt || retryAt <= now,
      attempts: Number(rows[0].attempts),
      retryAt: retryAt && retryAt > now ? retryAt : null,
    };
  }

  async registerLoginFailure(
    identifierHash: string,
    now = new Date(),
    policy = { windowSeconds: 900, maxAttempts: 5, blockSeconds: 900 },
  ): Promise<LoginRateLimitDecision> {
    const windowSeconds = Math.max(60, Math.min(86_400, Math.trunc(policy.windowSeconds)));
    const maxAttempts = Math.max(2, Math.min(100, Math.trunc(policy.maxAttempts)));
    const blockSeconds = Math.max(60, Math.min(86_400, Math.trunc(policy.blockSeconds)));
    const rows = await this.db.query<
      Record<string, unknown> & {
        attempts: number | string;
        blocked_until: Date | string | null;
      }
    >(
      `INSERT INTO login_attempts
        (identifier_hash, attempts, window_started_at, blocked_until)
       VALUES ($1, 1, $2::timestamptz, NULL)
       ON CONFLICT (identifier_hash) DO UPDATE SET
         attempts = CASE
           WHEN login_attempts.window_started_at <= $2::timestamptz - ($3 * interval '1 second')
             THEN 1
           ELSE login_attempts.attempts + 1
         END,
         window_started_at = CASE
           WHEN login_attempts.window_started_at <= $2::timestamptz - ($3 * interval '1 second')
             THEN $2::timestamptz
           ELSE login_attempts.window_started_at
         END,
         blocked_until = CASE
           WHEN login_attempts.blocked_until > $2::timestamptz
             THEN login_attempts.blocked_until
           WHEN (CASE
             WHEN login_attempts.window_started_at <= $2::timestamptz - ($3 * interval '1 second')
               THEN 1
             ELSE login_attempts.attempts + 1
           END) >= $4
             THEN $2::timestamptz + ($5 * interval '1 second')
           ELSE NULL
         END,
         updated_at = now()
       RETURNING attempts, blocked_until`,
      [identifierHash, now.toISOString(), windowSeconds, maxAttempts, blockSeconds],
    );
    const attempts = Number(rows[0]?.attempts ?? 1);
    const retryAt = rows[0]?.blocked_until ? toDate(rows[0].blocked_until) : null;
    return { allowed: !retryAt || retryAt <= now, attempts, retryAt };
  }

  async clearLoginFailures(identifierHash: string): Promise<void> {
    await this.db.query(`DELETE FROM login_attempts WHERE identifier_hash = $1`, [identifierHash]);
  }
}

let stateRepository: StateRepository | null = null;

export function getStateRepository(): StateRepository {
  if (!stateRepository) stateRepository = new PostgresStateRepository();
  return stateRepository;
}

export function setStateRepositoryForTests(value: StateRepository | null): void {
  stateRepository = value;
}
