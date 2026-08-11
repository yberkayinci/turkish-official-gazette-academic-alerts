import { createHash, randomUUID } from "node:crypto";

import {
  GeminiClient,
  analyzeAcademicCandidateWithFallback,
  deterministicHeadlineSummary,
  summarizeHeadlinesWithFallback,
  type CandidateAnalysisResult,
} from "../analysis/gemini";
import type { JsonValue, RuntimeSettings } from "../domain/types";
import {
  assembleGazetteReport,
  renderGazetteEmail,
  shouldDeliverReport,
  type RenderedGazetteEmail,
} from "../email/report";
import {
  ResendEmailSender,
  buildEmailIdempotencyKey,
  type EmailDeliveryResult,
  type SendGazetteEmailInput,
} from "../email/resend";
import {
  OfficialGazetteCollector,
  type CandidateCollectionOptions,
  type CandidateContent,
  type CollectOptions,
} from "../official-gazette/collector";
import {
  isAcademicCandidateTitle,
  normalizeTurkish,
  toGazetteDateParts,
  type AcademicCandidate,
  type GazettePublication,
} from "../official-gazette/parser";
import type { SettingsRepository } from "../repositories/settings";
import type { StateRepository } from "../repositories/state";
import { evaluateSchedule, nextRunAtAfterCompletion } from "./scheduler";

const LEASE_NAME = "official-gazette-monitor";
const LEASE_DURATION_SECONDS = 15 * 60;
const DELIVERY_LEASE_SECONDS = 2 * 60;
const MAX_ANALYZED_DOCUMENTS = 30;
const REPORT_VERSION = "vercel-report-v1";
const NO_PUBLICATION_REPORT_VERSION = "no-publication-v1";
const MONITORING_ERROR_REPORT_VERSION = "monitoring-error-v1";
export const SAFE_RUN_DEADLINE_MS = 240_000;
export const NETWORK_START_BUFFER_MS = 80_000;
const PUBLICATION_FINALIZE_BUFFER_MS = 45_000;

export interface MonitorCollector {
  collectPublications(date: Date, options?: CollectOptions): Promise<GazettePublication[]>;
  collectAcademicCandidates(
    publication: GazettePublication,
    options?: CandidateCollectionOptions,
  ): Promise<AcademicCandidate[]>;
  fetchCandidateContent(candidate: AcademicCandidate): Promise<CandidateContent>;
}

export interface MonitorEmailSender {
  send(input: SendGazetteEmailInput): Promise<EmailDeliveryResult>;
}

export interface MonitorRunDependencies {
  settingsRepository: SettingsRepository;
  stateRepository: StateRepository;
  collector?: MonitorCollector;
  createGeminiClient?: (apiKey: string, model: string) => GeminiClient;
  createEmailSender?: (apiKey: string, from: string) => MonitorEmailSender;
  now?: () => Date;
  ownerToken?: () => string;
}

export interface MonitorRunResult {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  publicationsFound: number;
  todayPublicationsFound: number;
  yesterdayPublicationsFound: number;
  publicationsProcessed: number;
  publicationsSkipped: number;
  emailsSent: number;
  operationalEmailsSent: number;
  confirmedPositionCount: number;
  manualReviewCount: number;
  deadlineReached: boolean;
  todayCheckCompleted: boolean;
  yesterdayCheckCompleted: boolean;
}

export interface RunMonitorOptions {
  mode: "scheduled" | "manual";
  schedulerProfile?: "pro_hourly" | "hobby_daily";
}

/** Single orchestration entry point used by both the cron and authenticated manual APIs. */
export async function runMonitor(
  dependencies: MonitorRunDependencies,
  options: RunMonitorOptions,
): Promise<MonitorRunResult> {
  const startedAt = dependencies.now?.() ?? new Date();
  const runtime = await dependencies.settingsRepository.getRuntimeSettings();
  let sendNoPublicationNotice = false;
  if (options.mode === "scheduled") {
    const decision = evaluateSchedule(
      {
        monitoringEnabled: runtime.settings.monitoringEnabled,
        checkIntervalHours: runtime.settings.checkIntervalHours,
        activeStartHour: runtime.settings.activeStartHour,
        activeEndHour: runtime.settings.activeEndHour,
        notifyNoPublication: runtime.settings.notifyNoPublication,
        lastScheduledAt: runtime.lastScheduledAt,
        nextRunAt: runtime.nextRunAt,
      },
      startedAt,
    );
    if (!decision.due) return emptyResult(decision.reason);
    sendNoPublicationNotice =
      runtime.settings.notifyNoPublication &&
      (decision.reason === "final_daily_check" ||
        options.schedulerProfile === "hobby_daily");
  }

  const result = await executeMonitorRun(runtime, dependencies, startedAt, {
    sendNoPublicationNotice,
  });
  if (options.mode === "scheduled") {
    const completedAt = dependencies.now?.() ?? new Date();
    await dependencies.settingsRepository.markScheduledRun(
      completedAt,
      nextRunAtAfterCompletion(
        {
          checkIntervalHours: runtime.settings.checkIntervalHours,
          activeStartHour: runtime.settings.activeStartHour,
          activeEndHour: runtime.settings.activeEndHour,
        },
        completedAt,
      ),
    );
  }
  return result;
}

export async function runScheduledMonitor(
  dependencies: MonitorRunDependencies,
  schedulerProfile: "pro_hourly" | "hobby_daily" = "pro_hourly",
): Promise<MonitorRunResult> {
  return runMonitor(dependencies, { mode: "scheduled", schedulerProfile });
}

export async function runMonitorNow(
  dependencies: MonitorRunDependencies,
): Promise<MonitorRunResult> {
  return runMonitor(dependencies, { mode: "manual" });
}

async function executeMonitorRun(
  runtime: RuntimeSettings,
  dependencies: MonitorRunDependencies,
  startedAt: Date,
  options: { sendNoPublicationNotice: boolean },
): Promise<MonitorRunResult> {
  const state = dependencies.stateRepository;
  const ownerToken = dependencies.ownerToken?.() ?? randomUUID();
  const acquired = await state.acquireLease(
    LEASE_NAME,
    ownerToken,
    startedAt,
    LEASE_DURATION_SECONDS,
  );
  if (!acquired) return emptyResult("another_run_active");

  const aggregate: MonitorRunResult = {
    ok: true,
    skipped: false,
    publicationsFound: 0,
    todayPublicationsFound: 0,
    yesterdayPublicationsFound: 0,
    publicationsProcessed: 0,
    publicationsSkipped: 0,
    emailsSent: 0,
    operationalEmailsSent: 0,
    confirmedPositionCount: 0,
    manualReviewCount: 0,
    deadlineReached: false,
    todayCheckCompleted: false,
    yesterdayCheckCompleted: !runtime.settings.includeYesterday,
  };

  try {
    const collector = dependencies.collector ?? new OfficialGazetteCollector();
    const networkDeadline = new Date(startedAt.getTime() + SAFE_RUN_DEADLINE_MS);
    const monitoringDates = [{ date: startedAt, today: true }];
    if (runtime.settings.includeYesterday) {
      monitoringDates.push({ date: new Date(startedAt.getTime() - 86_400_000), today: false });
    }

    for (const monitoringDate of monitoringDates) {
      if (!hasSafeNetworkBudget(networkDeadline, currentTime(dependencies))) {
        aggregate.deadlineReached = true;
        break;
      }
      const publications = await collector.collectPublications(monitoringDate.date, {
        includeSupplements: runtime.settings.includeSupplements,
        canStartNetwork: () =>
          hasSafeNetworkBudget(networkDeadline, currentTime(dependencies)),
      });
      aggregate.deadlineReached ||= !hasSafeNetworkBudget(
        networkDeadline,
        currentTime(dependencies),
      );
      aggregate.publicationsFound += publications.length;
      if (monitoringDate.today) {
        aggregate.todayPublicationsFound += publications.length;
        aggregate.todayCheckCompleted = true;
      } else {
        aggregate.yesterdayPublicationsFound += publications.length;
        aggregate.yesterdayCheckCompleted = true;
      }
      for (const publication of publications) {
        if (
          currentTime(dependencies).getTime() >
          networkDeadline.getTime() - PUBLICATION_FINALIZE_BUFFER_MS
        ) {
          aggregate.deadlineReached = true;
          break;
        }
        const outcome = await processPublication(
          publication,
          runtime,
          collector,
          dependencies,
          networkDeadline,
        );
        aggregate.publicationsProcessed += outcome.processed ? 1 : 0;
        aggregate.publicationsSkipped += outcome.skipped ? 1 : 0;
        aggregate.emailsSent += outcome.emailsSent;
        aggregate.confirmedPositionCount += outcome.confirmedPositionCount;
        aggregate.manualReviewCount += outcome.manualReviewCount;
        aggregate.deadlineReached ||= outcome.deadlineReached;
      }
    }

    if (
      options.sendNoPublicationNotice &&
      aggregate.todayCheckCompleted &&
      !aggregate.deadlineReached &&
      aggregate.todayPublicationsFound === 0
    ) {
      const sent = await sendNoPublicationOperationalNotice(
        runtime,
        dependencies,
        startedAt,
        aggregate.yesterdayPublicationsFound,
        aggregate.yesterdayCheckCompleted,
      );
      aggregate.emailsSent += sent;
      aggregate.operationalEmailsSent += sent;
    }

    await state.logActivity({
      eventType: "monitoring_check",
      status: aggregate.deadlineReached ? "warning" : "success",
      message: aggregate.deadlineReached
        ? `The safe run deadline was reached: ${aggregate.publicationsFound} issue(s), ${aggregate.manualReviewCount} manual-review item(s).`
        : `Check completed: ${aggregate.publicationsFound} issue(s), ${aggregate.emailsSent} email(s).`,
      details: toJsonValue(aggregate),
    });
    await state.saveLastRun(
      toJsonValue({
        ...aggregate,
        status: aggregate.deadlineReached ? "warning" : "success",
        startedAt: startedAt.toISOString(),
        completedAt: (dependencies.now?.() ?? new Date()).toISOString(),
      }),
    );
    return aggregate;
  } catch (error) {
    aggregate.ok = false;
    if (
      runtime.settings.notifyErrors &&
      currentTime(dependencies).getTime() <
        startedAt.getTime() + SAFE_RUN_DEADLINE_MS
    ) {
      try {
        const sent = await sendMonitoringErrorOperationalNotice(
          runtime,
          dependencies,
          startedAt,
        );
        aggregate.emailsSent += sent;
        aggregate.operationalEmailsSent += sent;
      } catch {
        // The original failure remains authoritative. Error-email delivery is
        // intentionally best effort and must never mask or recursively report it.
      }
    }
    try {
      await state.logActivity({
        eventType: "monitoring_check",
        status: "error",
        message: safeErrorMessage(error),
        details: toJsonValue({ startedAt: startedAt.toISOString() }),
      });
    } catch {
      // Preserve the original monitoring error when observability storage is unavailable.
    }
    try {
      await state.saveLastRun(
        toJsonValue({
          ...aggregate,
          status: "error",
          startedAt: startedAt.toISOString(),
          completedAt: currentTime(dependencies).toISOString(),
          error: safeErrorMessage(error),
        }),
      );
    } catch {
      // Preserve the original monitoring error when status storage is unavailable.
    }
    throw error;
  } finally {
    await state.releaseLease(LEASE_NAME, ownerToken);
  }
}

async function processPublication(
  publication: GazettePublication,
  runtime: RuntimeSettings,
  collector: MonitorCollector,
  dependencies: MonitorRunDependencies,
  networkDeadline: Date,
): Promise<{
  processed: boolean;
  skipped: boolean;
  emailsSent: number;
  confirmedPositionCount: number;
  manualReviewCount: number;
  deadlineReached: boolean;
}> {
  const state = dependencies.stateRepository;
  const publicationKey = fingerprint(publication.pdfUrl);
  const existing = await state.getProcessedPublication(publicationKey);
  if (existing && (existing.status === "sent" || existing.status === "skipped")) {
    return {
      processed: false,
      skipped: true,
      emailsSent: 0,
      confirmedPositionCount: 0,
      manualReviewCount: 0,
      deadlineReached: false,
    };
  }

  await state.saveProcessedPublication({
    publicationKey,
    issueDate: publication.date,
    sourceUrl: publication.pdfUrl,
    status: "processing",
  });

  try {
    const analyses = await analyzePublication(
      publication,
      runtime,
      collector,
      dependencies,
      networkDeadline,
    );
    const interim = assembleGazetteReport(
      publication,
      analyses,
      deterministicHeadlineSummary(
        publication.items.length,
        countPositions(analyses),
        countManualReview(analyses),
        runtime.settings.aiMode === "full",
      ),
      reportOptions(runtime),
    );
    const geminiClient = createOptionalGeminiClient(runtime, dependencies);
    const summary = await summarizeHeadlinesWithFallback(
      geminiClient,
      publication,
      interim.positions.length,
      interim.manualReview.length,
      runtime.settings.aiMode !== "off" &&
        runtime.settings.summarizeHeadlines &&
        hasSafeNetworkBudget(networkDeadline, currentTime(dependencies)),
    );
    const report = assembleGazetteReport(
      publication,
      analyses,
      summary,
      reportOptions(runtime),
    );
    const deadlineReached = analyses.some(
      (analysis) => analysis.status === "manual_review" && analysis.reason === "run_deadline",
    );

    if (!shouldDeliverReport(report, runtime.settings.deliveryPolicy)) {
      await state.saveProcessedPublication({
        publicationKey,
        issueDate: publication.date,
        sourceUrl: publication.pdfUrl,
        status: "skipped",
        report: toJsonValue(report),
      });
      return {
        processed: true,
        skipped: false,
        emailsSent: 0,
        confirmedPositionCount: report.positions.length,
        manualReviewCount: report.manualReview.length,
        deadlineReached,
      };
    }

    const rendered = renderGazetteEmail(report);
    const emailsSent = await sendRenderedEmailToRecipients({
      runtime,
      dependencies,
      publicationKey,
      reportVersion: REPORT_VERSION,
      email: rendered,
    });

    await state.saveProcessedPublication({
      publicationKey,
      issueDate: publication.date,
      sourceUrl: publication.pdfUrl,
      status: "sent",
      report: toJsonValue(report),
    });
    return {
      processed: true,
      skipped: false,
      emailsSent,
      confirmedPositionCount: report.positions.length,
      manualReviewCount: report.manualReview.length,
      deadlineReached,
    };
  } catch (error) {
    await state.saveProcessedPublication({
      publicationKey,
      issueDate: publication.date,
      sourceUrl: publication.pdfUrl,
      status: "failed",
      lastError: safeErrorMessage(error),
    });
    throw error;
  }
}

async function sendNoPublicationOperationalNotice(
  runtime: RuntimeSettings,
  dependencies: MonitorRunDependencies,
  monitoringDate: Date,
  yesterdayPublicationCount: number,
  yesterdayCheckCompleted: boolean,
): Promise<number> {
  const date = toGazetteDateParts(monitoringDate);
  const dailyUrl = `https://www.resmigazete.gov.tr/${date.displayNumeric}`;
  const publicationKey = fingerprint(`no-publication|${date.iso}`);
  const backfillNote = !runtime.settings.includeYesterday
    ? "Yesterday's backfill was disabled."
    : yesterdayCheckCompleted
      ? `Yesterday's backfill found ${yesterdayPublicationCount} issue(s); that result is tracked separately and does not change today's status.`
      : "Yesterday's backfill was deferred at the safe run deadline and is not being reported as empty.";
  const email: RenderedGazetteEmail = {
    subject: `[Official Gazette] No issue found — ${date.human}`,
    text: [
      `No regular or supplemental Official Gazette issue for ${date.human} was found during the final eligible scheduled check.`,
      "This is a monitoring status, not an official conclusion; publication may be delayed or the source may be temporarily incomplete.",
      backfillNote,
      `Check the official daily page: ${dailyUrl}`,
    ].join("\n\n"),
    html: `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#202124;line-height:1.6">
      <div style="max-width:640px;margin:0 auto;padding:24px">
        <div style="display:inline-block;background:#fff4e5;color:#7a4c00;padding:5px 10px;border-radius:999px;font-weight:700">Monitoring notice</div>
        <h1 style="font-size:23px">No issue found for ${escapeHtml(date.human)}</h1>
        <p>No regular or supplemental Official Gazette issue for today was found during the final eligible scheduled check.</p>
        <p><strong>This is not an official conclusion.</strong> Publication may be delayed or the source may be temporarily incomplete.</p>
        <p>${escapeHtml(backfillNote)}</p>
        <p><a href="${escapeHtml(dailyUrl)}" style="color:#0b57d0;font-weight:700">Check the official daily page</a></p>
      </div>
    </body></html>`,
  };

  const sent = await sendRenderedEmailToRecipients({
    runtime,
    dependencies,
    publicationKey,
    reportVersion: NO_PUBLICATION_REPORT_VERSION,
    email,
  });
  await dependencies.stateRepository.logActivity({
    eventType: "no_publication_notice",
    status: "warning",
    message: `No issue was found for ${date.iso}; ${sent} operational notice(s) were sent.`,
    details: toJsonValue({
      issueDate: date.iso,
      todayPublicationsFound: 0,
      yesterdayPublicationsFound: yesterdayPublicationCount,
      yesterdayCheckCompleted,
      emailsSent: sent,
    }),
  });
  return sent;
}

async function sendMonitoringErrorOperationalNotice(
  runtime: RuntimeSettings,
  dependencies: MonitorRunDependencies,
  monitoringDate: Date,
): Promise<number> {
  const date = toGazetteDateParts(monitoringDate);
  const dailyUrl = `https://www.resmigazete.gov.tr/${date.displayNumeric}`;
  const publicationKey = fingerprint(`monitoring-error|${date.iso}`);
  const email: RenderedGazetteEmail = {
    subject: `[Official Gazette] Monitoring needs attention — ${date.human}`,
    text: [
      `The Official Gazette monitoring check for ${date.human} could not be completed.`,
      "No conclusion about today's publications or vacancies should be drawn from this failed run.",
      "Open the private application dashboard and review Recent activity. Check the official daily page manually while monitoring is being restored.",
      `Official daily page: ${dailyUrl}`,
    ].join("\n\n"),
    html: `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#202124;line-height:1.6">
      <div style="max-width:640px;margin:0 auto;padding:24px">
        <div style="display:inline-block;background:#fdecec;color:#9b1c31;padding:5px 10px;border-radius:999px;font-weight:700">Action required</div>
        <h1 style="font-size:23px">Monitoring needs attention</h1>
        <p>The Official Gazette monitoring check for ${escapeHtml(date.human)} could not be completed.</p>
        <p><strong>No conclusion about today's publications or vacancies should be drawn from this failed run.</strong></p>
        <p>Open the private application dashboard and review <strong>Recent activity</strong>. Check the official source manually while monitoring is being restored.</p>
        <p><a href="${escapeHtml(dailyUrl)}" style="color:#0b57d0;font-weight:700">Open the official daily page</a></p>
      </div>
    </body></html>`,
  };
  return sendRenderedEmailToRecipients({
    runtime,
    dependencies,
    publicationKey,
    reportVersion: MONITORING_ERROR_REPORT_VERSION,
    email,
  });
}

async function sendRenderedEmailToRecipients(input: {
  runtime: RuntimeSettings;
  dependencies: MonitorRunDependencies;
  publicationKey: string;
  reportVersion: string;
  email: RenderedGazetteEmail;
}): Promise<number> {
  const { runtime, dependencies, publicationKey, reportVersion, email } = input;
  const resendApiKey = runtime.runtimeSecrets.resendApiKey;
  if (!resendApiKey) throw new Error("Email delivery is not configured.");
  const from = `${runtime.settings.senderName} <${runtime.settings.senderEmail}>`;
  const sender =
    dependencies.createEmailSender?.(resendApiKey, from) ??
    new ResendEmailSender({ apiKey: resendApiKey, from });
  const recipients = dedupeRecipients([
    runtime.settings.primaryRecipient,
    ...runtime.settings.additionalRecipients,
  ]);
  let emailsSent = 0;

  for (const recipientEmail of recipients) {
    const recipientFingerprint = fingerprint(recipientEmail.toLowerCase());
    const deliveryKey = buildEmailIdempotencyKey({
      profileId: runtime.id,
      publicationId: publicationKey,
      recipientId: recipientFingerprint,
      reportVersion,
    });
    const existingDelivery = await dependencies.stateRepository.createDelivery(
      deliveryKey,
      publicationKey,
      recipientFingerprint,
    );
    if (existingDelivery.status === "sent") continue;
    const claimed = await dependencies.stateRepository.claimDelivery(
      deliveryKey,
      currentTime(dependencies),
      DELIVERY_LEASE_SECONDS,
    );
    if (!claimed) {
      throw new Error("An email delivery for this publication is already in progress.");
    }
    try {
      const delivery = await sender.send({
        recipientEmail,
        recipientId: recipientFingerprint,
        profileId: runtime.id,
        publicationId: publicationKey,
        reportVersion,
        email,
      });
      await dependencies.stateRepository.markDeliverySent(
        deliveryKey,
        delivery.providerMessageId,
        currentTime(dependencies),
      );
      emailsSent += 1;
    } catch (error) {
      await dependencies.stateRepository.markDeliveryFailed(
        deliveryKey,
        safeErrorMessage(error),
      );
      throw error;
    }
  }
  return emailsSent;
}

async function analyzePublication(
  publication: GazettePublication,
  runtime: RuntimeSettings,
  collector: MonitorCollector,
  dependencies: MonitorRunDependencies,
  networkDeadline: Date,
): Promise<CandidateAnalysisResult[]> {
  const canStartNetwork = () =>
    hasSafeNetworkBudget(networkDeadline, currentTime(dependencies));
  if (!canStartNetwork()) {
    return [deadlineFallback({ title: publication.title, url: publication.pdfUrl })];
  }

  const discovered = await collector.collectAcademicCandidates(publication, {
    canStartNetwork,
  });
  const prioritized = runtime.settings.aiMode === "full"
    ? prioritizeAcademicCandidates(discovered)
    : discovered;
  const candidates = runtime.settings.aiMode === "full"
    ? prioritized.slice(0, MAX_ANALYZED_DOCUMENTS)
    : discovered.filter((candidate) => candidateMatchesKeywordMode(candidate, runtime));
  const overflow = runtime.settings.aiMode === "full"
    ? prioritized.slice(MAX_ANALYZED_DOCUMENTS).map((candidate) => ({
        status: "manual_review" as const,
        title: candidate.title,
        url: candidate.url,
        reason: "ai_unavailable" as const,
        message:
          "This document was not analyzed because the safe per-run document limit was reached; review it manually.",
      }))
    : [];

  if (runtime.settings.aiMode !== "full") {
    return candidates.map((candidate) => ({
      status: "manual_review" as const,
      title: candidate.title,
      url: candidate.url,
      reason: candidate.discoveryError ? ("discovery_error" as const) : ("ai_unavailable" as const),
      message: candidate.discoveryError
        ? candidate.discoveryMessage ?? "Review this official source manually."
        : runtime.settings.aiMode === "summary"
          ? "Headline AI is enabled, but notice PDFs require manual review in Summary mode."
          : "Keyword mode does not read notice PDFs. Review this potential academic notice manually.",
    }));
  }

  const client = createOptionalGeminiClient(runtime, dependencies);
  if (!client) {
    return [
      ...candidates.map((candidate) => manualFallback(candidate, "AI is not configured.")),
      ...overflow,
    ];
  }

  const results = await analyzeCandidatesWithinDeadline(
    candidates,
    networkDeadline,
    () => currentTime(dependencies),
    async (candidate) => {
      if (candidate.discoveryError) {
        return manualFallback(candidate, candidate.discoveryMessage);
      }
      try {
        const content = await collector.fetchCandidateContent(candidate);
        if (!canStartNetwork()) return deadlineFallback(candidate);
        return await analyzeAcademicCandidateWithFallback(client, candidate, content);
      } catch {
        if (!canStartNetwork()) return deadlineFallback(candidate);
        return manualFallback(
          candidate,
          "The official document could not be read automatically.",
        );
      }
    },
  );
  return [...results, ...overflow];
}

export async function analyzeCandidatesWithinDeadline(
  candidates: AcademicCandidate[],
  networkDeadline: Date,
  now: () => Date,
  analyze: (candidate: AcademicCandidate) => Promise<CandidateAnalysisResult>,
): Promise<CandidateAnalysisResult[]> {
  const results: CandidateAnalysisResult[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    if (!hasSafeNetworkBudget(networkDeadline, now())) {
      results.push(...candidates.slice(index).map(deadlineFallback));
      break;
    }
    results.push(await analyze(candidates[index]));
  }
  return results;
}

export function hasSafeNetworkBudget(deadline: Date, now: Date): boolean {
  return now.getTime() <= deadline.getTime() - NETWORK_START_BUFFER_MS;
}

export function prioritizeAcademicCandidates(
  candidates: AcademicCandidate[],
): AcademicCandidate[] {
  return candidates
    .map((candidate, sourceIndex) => ({
      candidate,
      sourceIndex,
      priority: candidate.discoveryError
        ? 0
        : isAcademicCandidateTitle(candidate.title)
          ? 1
          : 2,
    }))
    .sort((left, right) =>
      left.priority === right.priority
        ? left.sourceIndex - right.sourceIndex
        : left.priority - right.priority,
    )
    .map((entry) => entry.candidate);
}

function createOptionalGeminiClient(
  runtime: RuntimeSettings,
  dependencies: MonitorRunDependencies,
): GeminiClient | null {
  const apiKey = runtime.runtimeSecrets.geminiApiKey;
  if (!apiKey || runtime.settings.aiMode === "off") return null;
  const model = runtime.settings.customModel || "gemini-3.6-flash";
  return dependencies.createGeminiClient?.(apiKey, model) ?? new GeminiClient({ apiKey, model });
}

function candidateMatchesKeywordMode(
  candidate: AcademicCandidate,
  runtime: RuntimeSettings,
): boolean {
  if (candidate.discoveryError) return true;
  if (!isAcademicCandidateTitle(candidate.title)) return false;
  const title = normalizeTurkish(candidate.title);
  if (containsAny(title, runtime.settings.excludedKeywords)) return false;
  if (
    runtime.settings.requiredKeywords.length > 0 &&
    !containsAny(title, runtime.settings.requiredKeywords)
  ) {
    return false;
  }
  if (
    runtime.settings.preferredInstitutions.length > 0 &&
    !containsAny(title, runtime.settings.preferredInstitutions)
  ) {
    return false;
  }
  return true;
}

function reportOptions(runtime: RuntimeSettings) {
  return {
    analysisMode: runtime.settings.aiMode,
    includeHeadlines: runtime.settings.includeHeadlines,
    requiredKeywords: runtime.settings.requiredKeywords,
    excludedKeywords: runtime.settings.excludedKeywords,
    preferredInstitutions: runtime.settings.preferredInstitutions,
    includeCorrections: runtime.settings.includeCorrections,
    includeCancellations: runtime.settings.includeCancellations,
    includeUncertain: runtime.settings.includeUncertain,
  };
}

function manualFallback(candidate: AcademicCandidate, message?: string): CandidateAnalysisResult {
  return {
    status: "manual_review",
    title: candidate.title,
    url: candidate.url,
    reason: candidate.discoveryError ? "discovery_error" : "invalid_document",
    message: message ?? "Review the official source manually.",
  };
}

function deadlineFallback(candidate: Pick<AcademicCandidate, "title" | "url">): CandidateAnalysisResult {
  return {
    status: "manual_review",
    title: candidate.title,
    url: candidate.url,
    reason: "run_deadline",
    message:
      "This document was not analyzed because the safe run deadline was reached; review it manually.",
  };
}

function countPositions(results: CandidateAnalysisResult[]): number {
  return results.reduce(
    (total, result) => total + (result.status === "ok" ? result.analysis.positions.length : 0),
    0,
  );
}

function countManualReview(results: CandidateAnalysisResult[]): number {
  return results.filter(
    (result) =>
      result.status === "manual_review" ||
      result.analysis.needsManualReview ||
      (result.analysis.hasResearchAssistant && result.analysis.positions.length === 0),
  ).length;
}

function containsAny(normalizedText: string, values: string[]): boolean {
  return values.some((value) => normalizedText.includes(normalizeTurkish(value)));
}

function dedupeRecipients(values: string[]): string[] {
  const seen = new Set<string>();
  return values
    .map((value) => value.trim().toLowerCase())
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function currentTime(dependencies: MonitorRunDependencies): Date {
  return dependencies.now?.() ?? new Date();
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/re_[A-Za-z0-9_-]{12,}/g, "[API KEY REDACTED]")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[API KEY REDACTED]")
    .slice(0, 1_000);
}

function emptyResult(reason: string): MonitorRunResult {
  return {
    ok: true,
    skipped: true,
    reason,
    publicationsFound: 0,
    todayPublicationsFound: 0,
    yesterdayPublicationsFound: 0,
    publicationsProcessed: 0,
    publicationsSkipped: 0,
    emailsSent: 0,
    operationalEmailsSent: 0,
    confirmedPositionCount: 0,
    manualReviewCount: 0,
    deadlineReached: false,
    todayCheckCompleted: false,
    yesterdayCheckCompleted: false,
  };
}
