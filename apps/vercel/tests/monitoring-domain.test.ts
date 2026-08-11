import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  GeminiClient,
  analyzeAcademicCandidateWithFallback,
  type CandidateAnalysisResult,
} from "@/lib/analysis/gemini";
import { DEFAULT_APP_SETTINGS } from "@/lib/domain/settings";
import type {
  DeliveryRecord,
  ProcessedPublicationRecord,
  RuntimeSettings,
  SaveProcessedPublication,
} from "@/lib/domain/types";
import { buildEmailIdempotencyKey } from "@/lib/email/resend";
import {
  OfficialGazetteCollector,
  fetchOfficialResource,
  type FetchImplementation,
} from "@/lib/official-gazette/collector";
import {
  discoverSupplementNumbers,
  isOfficialGazetteUrl,
  parseIssuePage,
  toGazetteDateParts,
  type AcademicCandidate,
  type GazettePublication,
} from "@/lib/official-gazette/parser";
import {
  analyzeCandidatesWithinDeadline,
  prioritizeAcademicCandidates,
  runMonitor,
  type MonitorRunDependencies,
} from "@/lib/monitor/run";
import { evaluateSchedule } from "@/lib/monitor/scheduler";
import type { SettingsRepository } from "@/lib/repositories/settings";
import type { StateRepository } from "@/lib/repositories/state";

const requestedDate = toGazetteDateParts(new Date("2026-08-11T09:00:00.000Z"));
const pageUrl = "https://www.resmigazete.gov.tr/11.08.2026";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

describe("collector network deadline", () => {
  it("does not start supplemental-page requests after the network budget closes", async () => {
    let requests = 0;
    const collector = new OfficialGazetteCollector({
      fetchImpl: async () => {
        requests += 1;
        return new Response(fixture("issue-2026-08-11.html"), {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    });

    const publications = await collector.collectPublications(
      new Date("2026-08-11T09:00:00.000Z"),
      { includeSupplements: true, canStartNetwork: () => false },
    );

    expect(requests).toBe(1);
    expect(publications).toHaveLength(1);
    expect(publications[0]?.type).toBe("normal");
  });
});

function createMonitorHarness(options: {
  now: Date;
  intervalHours?: 3 | 24;
  recipientCount?: 1 | 2;
  yesterdayPublication?: boolean;
  collectorError?: Error;
}) {
  const today = toGazetteDateParts(options.now);
  const yesterdayDate = new Date(options.now.getTime() - 86_400_000);
  const yesterday = toGazetteDateParts(yesterdayDate);
  const yesterdayPublication: GazettePublication = {
    id: "yesterday-publication",
    date: yesterday.iso,
    dateHuman: yesterday.human,
    title: `${yesterday.human} Tarihli Resmî Gazete`,
    type: "normal",
    supplementNumber: 0,
    pageUrl: `https://www.resmigazete.gov.tr/${yesterday.displayNumeric}`,
    pdfUrl: `https://www.resmigazete.gov.tr/eskiler/${yesterday.year}/${yesterday.month}/${yesterday.compact}.pdf`,
    items: [],
  };
  const runtime: RuntimeSettings = {
    id: "default",
    revision: 0,
    settings: {
      ...DEFAULT_APP_SETTINGS,
      monitoringEnabled: true,
      checkIntervalHours: options.intervalHours ?? 3,
      activeStartHour: 6,
      activeEndHour: 23,
      includeYesterday: true,
      aiMode: "off",
      deliveryPolicy: "matches_only",
      notifyErrors: true,
      notifyNoPublication: true,
      senderName: "Official Gazette Monitor",
      senderEmail: "alerts@example.com",
      primaryRecipient: "owner@example.com",
      additionalRecipients:
        options.recipientCount === 2 ? ["second@example.com"] : [],
    },
    secrets: {
      geminiApiKey: { configured: false, source: "none" },
      resendApiKey: { configured: true, source: "environment" },
    },
    nextRunAt: null,
    lastScheduledAt: null,
    createdAt: options.now,
    updatedAt: options.now,
    runtimeSecrets: { geminiApiKey: null, resendApiKey: "test-resend-key-not-a-secret" },
  };
  const processed = new Map<string, ProcessedPublicationRecord>();
  const deliveries = new Map<string, DeliveryRecord>();
  const sent: Array<{ recipientEmail: string; subject: string; text: string }> = [];
  const collectionDates: string[] = [];
  let activityId = 0;

  const settingsRepository = {
    getRuntimeSettings: async () => runtime,
    markScheduledRun: async (lastScheduledAt: Date, nextRunAt: Date | null) => {
      runtime.lastScheduledAt = lastScheduledAt;
      runtime.nextRunAt = nextRunAt;
    },
  } as unknown as SettingsRepository;

  const stateRepository = {
    acquireLease: async (leaseName: string, ownerToken: string, now: Date, ttl: number) => ({
      leaseName,
      ownerToken,
      acquiredAt: now,
      expiresAt: new Date(now.getTime() + ttl * 1_000),
    }),
    releaseLease: async () => true,
    getProcessedPublication: async (key: string) => processed.get(key) ?? null,
    saveProcessedPublication: async (value: SaveProcessedPublication) => {
      const previous = processed.get(value.publicationKey);
      const record: ProcessedPublicationRecord = {
        publicationKey: value.publicationKey,
        issueDate: value.issueDate,
        sourceUrl: value.sourceUrl,
        status: value.status,
        report: value.report ?? null,
        lastError: value.lastError ?? null,
        processedAt: previous?.processedAt ?? options.now,
        updatedAt: options.now,
      };
      processed.set(value.publicationKey, record);
      return record;
    },
    createDelivery: async (
      deliveryKey: string,
      publicationKey: string,
      recipientFingerprint: string,
    ) => {
      const existing = deliveries.get(deliveryKey);
      if (existing) return existing;
      const record: DeliveryRecord = {
        deliveryKey,
        publicationKey,
        recipientFingerprint,
        status: "pending",
        providerMessageId: null,
        attemptCount: 0,
        lastError: null,
        sendingExpiresAt: null,
        createdAt: options.now,
        updatedAt: options.now,
        sentAt: null,
      };
      deliveries.set(deliveryKey, record);
      return record;
    },
    claimDelivery: async (deliveryKey: string) => {
      const record = deliveries.get(deliveryKey);
      if (!record || record.status === "sent") return null;
      record.status = "sending";
      record.attemptCount += 1;
      return record;
    },
    markDeliverySent: async (deliveryKey: string, providerMessageId: string) => {
      const record = deliveries.get(deliveryKey);
      if (!record) throw new Error("missing delivery");
      record.status = "sent";
      record.providerMessageId = providerMessageId;
      record.sentAt = options.now;
    },
    markDeliveryFailed: async (deliveryKey: string, message: string) => {
      const record = deliveries.get(deliveryKey);
      if (!record) return;
      record.status = "failed";
      record.lastError = message;
    },
    logActivity: async (event: {
      eventType: string;
      status: "success" | "warning" | "error" | "info";
      message: string;
      details?: unknown;
    }) => ({
      id: ++activityId,
      eventType: event.eventType,
      status: event.status,
      message: event.message,
      details: (event.details ?? null) as never,
      createdAt: options.now,
    }),
    saveLastRun: async () => undefined,
  } as unknown as StateRepository;

  const dependencies: MonitorRunDependencies = {
    settingsRepository,
    stateRepository,
    collector: {
      collectPublications: async (date) => {
        if (options.collectorError) throw options.collectorError;
        const iso = toGazetteDateParts(date).iso;
        collectionDates.push(iso);
        if (iso === today.iso) return [];
        return options.yesterdayPublication && iso === yesterday.iso
          ? [yesterdayPublication]
          : [];
      },
      collectAcademicCandidates: async () => [],
      fetchCandidateContent: async () => {
        throw new Error("not expected");
      },
    },
    createEmailSender: () => ({
      send: async (input) => {
        sent.push({
          recipientEmail: input.recipientEmail,
          subject: input.email.subject,
          text: input.email.text,
        });
        return {
          provider: "resend" as const,
          providerMessageId: `email-${sent.length}`,
          idempotencyKey: "provider-key",
        };
      },
    }),
    now: () => options.now,
    ownerToken: () => "test-owner",
  };

  return { dependencies, sent, deliveries, collectionDates };
}

describe("Official Gazette parsing", () => {
  it("requires the exact requested-date PDF and rejects the site's silent fallback", () => {
    const valid = parseIssuePage(
      fixture("issue-2026-08-11.html"),
      pageUrl,
      requestedDate,
    );
    const fallback = parseIssuePage(
      fixture("silent-fallback-2026-08-10.html"),
      pageUrl,
      requestedDate,
    );

    expect(valid?.pdfUrl).toBe(
      "https://www.resmigazete.gov.tr/eskiler/2026/08/20260811.pdf",
    );
    expect(valid?.items[0]?.title).toContain("Çeşitli");
    expect(fallback).toBeNull();
  });

  it("discovers the contiguous supplement sequence for the requested date only", () => {
    expect(
      discoverSupplementNumbers(
        fixture("issue-2026-08-11.html"),
        pageUrl,
        requestedDate,
      ),
    ).toEqual([1, 2]);
  });
});

describe("Official Gazette fetch boundary", () => {
  it("rejects hostname lookalikes and redirects away from the official HTTPS host", async () => {
    expect(isOfficialGazetteUrl("https://www.resmigazete.gov.tr.evil.example/file.pdf")).toBe(
      false,
    );
    const redirectingFetch: FetchImplementation = async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://attacker.example/notice.pdf" },
      });

    await expect(
      fetchOfficialResource(
        "https://www.resmigazete.gov.tr/eskiler/2026/08/20260811.pdf",
        { kind: "pdf", fetchImpl: redirectingFetch },
      ),
    ).rejects.toThrow(/Only HTTPS resources/);
  });
});

describe("scheduler gating", () => {
  it("runs only after the interval and inside the Istanbul active window", () => {
    const base = {
      monitoringEnabled: true,
      checkIntervalHours: 3 as const,
      activeStartHour: 6,
      activeEndHour: 23,
      timeZone: "Europe/Istanbul",
      notifyNoPublication: false,
    };

    expect(
      evaluateSchedule(
        { ...base, lastScheduledAt: "2026-08-11T05:30:00.000Z" },
        new Date("2026-08-11T07:00:00.000Z"),
      ).reason,
    ).toBe("interval_not_elapsed");
    expect(
      evaluateSchedule(
        { ...base, lastScheduledAt: "2026-08-11T03:00:00.000Z" },
        new Date("2026-08-11T07:00:00.000Z"),
      ).due,
    ).toBe(true);
    expect(
      evaluateSchedule(base, new Date("2026-08-11T01:00:00.000Z")).reason,
    ).toBe("outside_active_hours");
  });
});

describe("email delivery idempotency", () => {
  it("creates a stable, non-PII provider key for one logical delivery", () => {
    const input = {
      profileId: "default",
      publicationId: "publication-20260811",
      recipientId: "recipient-fingerprint",
      reportVersion: "v1",
    };
    const first = buildEmailIdempotencyKey(input);
    const second = buildEmailIdempotencyKey(input);

    expect(first).toBe(second);
    expect(first).toMatch(/^gazette\/[a-f0-9]{64}$/);
    expect(first).not.toContain(input.recipientId);
    expect(buildEmailIdempotencyKey({ ...input, reportVersion: "v2" })).not.toBe(first);
  });
});

describe("AI failure behavior", () => {
  it("falls back to manual review and never turns an AI failure into a no-match claim", async () => {
    const failingFetch: FetchImplementation = async () =>
      new Response(JSON.stringify({ error: { message: "temporary failure" } }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    const client = new GeminiClient({
      apiKey: "test-gemini-key-not-a-secret-123456",
      fetchImpl: failingFetch,
      maxAttempts: 1,
      sleep: async () => undefined,
    });
    const result = await analyzeAcademicCandidateWithFallback(
      client,
      {
        title: "Örnek Üniversitesi araştırma görevlisi ilanı",
        url: "https://www.resmigazete.gov.tr/ilanlar/eskiilanlar/2026/08/20260811-1.pdf",
      },
      { kind: "text", text: "untrusted official notice text", mimeType: "text/plain" },
    );

    expect(result.status).toBe("manual_review");
    if (result.status === "manual_review") {
      expect(result.message).toMatch(/review/i);
      expect(result.message).not.toMatch(/no (?:vacancy|match)/i);
    }
  });
});

describe("safe run deadline", () => {
  it("stops starting analyses and turns every remaining candidate into manual review", async () => {
    const startedAt = new Date("2026-08-11T07:00:00.000Z");
    const candidates: AcademicCandidate[] = [1, 2, 3].map((number) => ({
      title: `University notice ${number}`,
      url: `https://www.resmigazete.gov.tr/ilanlar/eskiilanlar/2026/08/20260811-${number}.pdf`,
    }));
    let clockChecks = 0;
    let analysesStarted = 0;
    const results = await analyzeCandidatesWithinDeadline(
      candidates,
      new Date(startedAt.getTime() + 240_000),
      () =>
        new Date(
          startedAt.getTime() + (clockChecks++ === 0 ? 0 : 200_000),
        ),
      async (candidate): Promise<CandidateAnalysisResult> => {
        analysesStarted += 1;
        return {
          status: "manual_review",
          title: candidate.title,
          url: candidate.url,
          reason: "invalid_document",
          message: "first candidate completed with a manual result",
        };
      },
    );

    expect(analysesStarted).toBe(1);
    expect(
      results.map((result) =>
        result.status === "manual_review" ? result.reason : "ok",
      ),
    ).toEqual(["invalid_document", "run_deadline", "run_deadline"]);
    expect(
      results.slice(1).every(
        (result) =>
          result.status === "manual_review" && /review it manually/i.test(result.message),
      ),
    ).toBe(true);
  });

  it("does not start yesterday's collection after the global cutoff", async () => {
    const startedAt = new Date("2026-08-11T07:00:00.000Z");
    const harness = createMonitorHarness({
      now: startedAt,
      yesterdayPublication: true,
    });
    let clockCall = 0;
    harness.dependencies.now = () =>
      new Date(
        startedAt.getTime() +
          (clockCall++ < 2 ? 0 : 200_000),
      );

    const result = await runMonitor(harness.dependencies, { mode: "manual" });

    expect(harness.collectionDates).toEqual(["2026-08-11"]);
    expect(result.todayCheckCompleted).toBe(true);
    expect(result.yesterdayCheckCompleted).toBe(false);
    expect(result.deadlineReached).toBe(true);
  });
});

describe("full-analysis candidate prioritization", () => {
  it("selects a university notice after 30 generic notices for the 30-document AI budget", () => {
    const generic = Array.from({ length: 30 }, (_, index) => ({
      title: `Generic commercial notice ${index + 1}`,
      url: `https://www.resmigazete.gov.tr/ilanlar/eskiilanlar/2026/08/generic-${index + 1}.pdf`,
    }));
    const university = {
      title: "Örnek Üniversitesi Rektörlüğünden araştırma görevlisi ilanı",
      url: "https://www.resmigazete.gov.tr/ilanlar/eskiilanlar/2026/08/university.pdf",
    };

    const selectedForAi = prioritizeAcademicCandidates([
      ...generic,
      university,
    ]).slice(0, 30);

    expect(selectedForAi).toContainEqual(university);
    expect(selectedForAi).not.toContainEqual(generic[29]);
  });
});

describe("no-publication operational notices", () => {
  it("tracks today separately from yesterday and sends once per recipient at the Pro final check", async () => {
    const harness = createMonitorHarness({
      now: new Date("2026-08-11T20:00:00.000Z"), // 23:00 Europe/Istanbul
      intervalHours: 3,
      recipientCount: 2,
      yesterdayPublication: true,
    });

    const first = await runMonitor(harness.dependencies, {
      mode: "scheduled",
      schedulerProfile: "pro_hourly",
    });
    const second = await runMonitor(harness.dependencies, {
      mode: "scheduled",
      schedulerProfile: "pro_hourly",
    });

    expect(first.todayPublicationsFound).toBe(0);
    expect(first.yesterdayPublicationsFound).toBe(1);
    expect(first.operationalEmailsSent).toBe(2);
    expect(first.emailsSent).toBe(2);
    expect(harness.sent).toHaveLength(2);
    expect(new Set(harness.sent.map((message) => message.recipientEmail)).size).toBe(2);
    expect(harness.sent[0]?.subject).toMatch(/No issue found/);
    expect(harness.sent[0]?.text).toMatch(/Yesterday's backfill found 1 issue/);
    expect(second.operationalEmailsSent).toBe(0);
    expect(harness.sent).toHaveLength(2);
  });

  it("does not treat a Pro 24-hour profile as final early, but allows Hobby's sole daily run", async () => {
    const harness = createMonitorHarness({
      now: new Date("2026-08-11T09:00:00.000Z"), // 12:00 Europe/Istanbul
      intervalHours: 24,
      recipientCount: 1,
    });

    const pro = await runMonitor(harness.dependencies, {
      mode: "scheduled",
      schedulerProfile: "pro_hourly",
    });
    expect(pro.operationalEmailsSent).toBe(0);
    expect(harness.sent).toHaveLength(0);

    const hobbyHarness = createMonitorHarness({
      now: new Date("2026-08-11T09:00:00.000Z"),
      intervalHours: 24,
      recipientCount: 1,
    });
    const hobby = await runMonitor(hobbyHarness.dependencies, {
      mode: "scheduled",
      schedulerProfile: "hobby_daily",
    });
    expect(hobby.operationalEmailsSent).toBe(1);
    expect(hobbyHarness.sent[0]?.subject).toMatch(/No issue found/);
  });
});

describe("monitoring error notices", () => {
  it("sends a safe daily-deduplicated notice without exposing the raw exception", async () => {
    const harness = createMonitorHarness({
      now: new Date("2026-08-11T10:00:00.000Z"),
      intervalHours: 3,
      recipientCount: 2,
      collectorError: new Error("super-secret upstream diagnostic"),
    });

    await expect(
      runMonitor(harness.dependencies, {
        mode: "scheduled",
        schedulerProfile: "pro_hourly",
      }),
    ).rejects.toThrow(/super-secret/);
    await expect(
      runMonitor(harness.dependencies, {
        mode: "scheduled",
        schedulerProfile: "pro_hourly",
      }),
    ).rejects.toThrow(/super-secret/);

    expect(harness.sent).toHaveLength(2);
    expect(harness.sent[0]?.subject).toMatch(/Monitoring needs attention/);
    expect(harness.sent[0]?.text).toMatch(/private application dashboard/i);
    expect(harness.sent[0]?.text).not.toContain("super-secret");
  });
});
