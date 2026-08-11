import { createHash } from "node:crypto";

import type { FetchImplementation } from "../official-gazette/collector";
import type { RenderedGazetteEmail } from "./report";

export interface ResendEmailSenderOptions {
  apiKey: string;
  from: string;
  replyTo?: string;
  fetchImpl?: FetchImplementation;
  timeoutMs?: number;
}

export interface SendGazetteEmailInput {
  recipientEmail: string;
  recipientId: string;
  profileId: string;
  publicationId: string;
  reportVersion: string;
  email: RenderedGazetteEmail;
}

export interface EmailDeliveryResult {
  provider: "resend";
  providerMessageId: string;
  idempotencyKey: string;
}

export class ResendEmailSender {
  private readonly apiKey: string;
  private readonly from: string;
  private readonly replyTo?: string;
  private readonly fetchImpl: FetchImplementation;
  private readonly timeoutMs: number;

  constructor(options: ResendEmailSenderOptions) {
    this.apiKey = options.apiKey.trim();
    if (!/^re_[A-Za-z0-9_-]{12,}$/.test(this.apiKey)) {
      throw new Error("A valid Resend API key is required.");
    }
    this.from = validateSender(options.from);
    this.replyTo = options.replyTo ? validateEmail(options.replyTo) : undefined;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = Math.min(60_000, Math.max(1_000, options.timeoutMs ?? 15_000));
  }

  async send(input: SendGazetteEmailInput): Promise<EmailDeliveryResult> {
    const recipient = validateEmail(input.recipientEmail);
    const idempotencyKey = buildEmailIdempotencyKey({
      profileId: input.profileId,
      publicationId: input.publicationId,
      recipientId: input.recipientId,
      reportVersion: input.reportVersion,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
          "User-Agent": "OfficialGazetteMonitor/1.0",
        },
        body: JSON.stringify({
          from: this.from,
          to: [recipient],
          ...(this.replyTo ? { reply_to: this.replyTo } : {}),
          subject: input.email.subject.slice(0, 240),
          html: input.email.html,
          text: input.email.text,
          tags: [
            { name: "category", value: "gazette_alert" },
            { name: "publication", value: safeTagValue(input.publicationId) },
          ],
        }),
      });
      const body = await response.text();
      if (!response.ok) {
        throw new Error(`Resend returned HTTP ${response.status}: ${summarizeProviderError(body)}`);
      }
      const parsed = parseProviderResponse(body);
      return { provider: "resend", providerMessageId: parsed.id, idempotencyKey };
    } catch (error) {
      if (controller.signal.aborted) throw new Error("The email provider request timed out.");
      throw new Error(`Email delivery failed: ${safeErrorMessage(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

export function buildEmailIdempotencyKey(input: {
  profileId: string;
  publicationId: string;
  recipientId: string;
  reportVersion: string;
}): string {
  const canonical = [
    boundedIdentifier(input.profileId),
    boundedIdentifier(input.publicationId),
    boundedIdentifier(input.recipientId),
    boundedIdentifier(input.reportVersion),
  ].join("\u001f");
  return `gazette/${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

function parseProviderResponse(body: string): { id: string } {
  try {
    const parsed = JSON.parse(body) as { id?: unknown };
    if (typeof parsed.id !== "string" || !parsed.id.trim()) throw new Error();
    return { id: parsed.id.trim().slice(0, 200) };
  } catch {
    throw new Error("The email provider returned an invalid response.");
  }
}

function summarizeProviderError(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown; error?: { message?: unknown } };
    const message =
      typeof parsed.message === "string"
        ? parsed.message
        : typeof parsed.error?.message === "string"
          ? parsed.error.message
          : "Provider request failed.";
    return safeErrorMessage(message);
  } catch {
    return "Provider request failed.";
  }
}

function validateSender(value: string): string {
  const sender = value.replace(/\s+/g, " ").trim();
  const bracketed = sender.match(/^.{1,100}\s<([^<>]+)>$/);
  if (bracketed) {
    validateEmail(bracketed[1]);
    return sender.slice(0, 200);
  }
  return validateEmail(sender);
}

function validateEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (
    email.length > 254 ||
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/i.test(email) ||
    /[\r\n]/.test(email)
  ) {
    throw new Error("A valid email address is required.");
  }
  return email;
}

function boundedIdentifier(value: string): string {
  const normalized = String(value).trim();
  if (!normalized || normalized.length > 500) throw new Error("Invalid idempotency identifier.");
  return normalized;
}

function safeTagValue(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256) || "unknown";
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/re_[A-Za-z0-9_-]{12,}/g, "[API KEY REDACTED]")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[API KEY REDACTED]")
    .slice(0, 500);
}
