import type { CandidateAnalysisResult } from "../analysis/gemini";
import type { AcademicPosition, HeadlineSummary } from "../analysis/schema";
import {
  OFFICIAL_GAZETTE_ORIGIN,
  isOfficialGazetteUrl,
  normalizeTurkish,
  type GazettePublication,
} from "../official-gazette/parser";

export type AnalysisMode = "off" | "summary" | "full";
export type DeliveryPolicy = "all_issues" | "matches_only";

export interface PositionFilterOptions {
  requiredKeywords?: string[];
  excludedKeywords?: string[];
  preferredInstitutions?: string[];
  includeCorrections?: boolean;
  includeCancellations?: boolean;
  includeUncertain?: boolean;
}

export interface ReportPosition {
  sourceTitle: string;
  sourceUrl: string;
  uncertain: boolean;
  documentSummary: string;
  position: AcademicPosition;
}

export interface ManualReviewNotice {
  title: string;
  url: string;
  message: string;
}

export interface GazetteReport {
  publication: GazettePublication;
  summary: HeadlineSummary;
  positions: ReportPosition[];
  manualReview: ManualReviewNotice[];
  otherAcademic: Array<{ title: string; url: string }>;
  academicCandidateCount: number;
  analysisMode: AnalysisMode;
  includeHeadlines: boolean;
}

export interface AssembleReportOptions extends PositionFilterOptions {
  analysisMode: AnalysisMode;
  includeHeadlines?: boolean;
}

export interface RenderedGazetteEmail {
  subject: string;
  html: string;
  text: string;
}

export function assembleGazetteReport(
  publication: GazettePublication,
  analyses: CandidateAnalysisResult[],
  summary: HeadlineSummary,
  options: AssembleReportOptions,
): GazetteReport {
  const positions: ReportPosition[] = [];
  const manualReview: ManualReviewNotice[] = [];
  const otherAcademic: Array<{ title: string; url: string }> = [];

  for (const entry of analyses) {
    if (entry.status === "manual_review") {
      manualReview.push({ title: entry.title, url: entry.url, message: entry.message });
      continue;
    }
    const included = entry.analysis.positions.filter((position) =>
      shouldIncludePosition(position, entry.analysis.uncertain || entry.analysis.needsManualReview, options),
    );
    for (const position of included) {
      positions.push({
        sourceTitle: entry.title,
        sourceUrl: entry.url,
        uncertain: entry.analysis.uncertain || entry.analysis.needsManualReview,
        documentSummary: entry.analysis.documentSummary,
        position,
      });
    }
    if (
      included.length === 0 &&
      (entry.analysis.needsManualReview || entry.analysis.hasResearchAssistant)
    ) {
      manualReview.push({
        title: entry.title,
        url: entry.url,
        message:
          entry.analysis.documentSummary ||
          "The automated analysis recommends checking this official notice manually.",
      });
    } else if (included.length === 0) {
      otherAcademic.push({ title: entry.title, url: entry.url });
    }
  }

  return {
    publication,
    summary,
    positions,
    manualReview,
    otherAcademic,
    academicCandidateCount: analyses.length,
    analysisMode: options.analysisMode,
    includeHeadlines: options.includeHeadlines !== false,
  };
}

export function shouldDeliverReport(
  report: GazetteReport,
  policy: DeliveryPolicy,
): boolean {
  return (
    policy === "all_issues" ||
    report.positions.length > 0 ||
    report.manualReview.length > 0
  );
}

export function renderGazetteEmail(report: GazetteReport): RenderedGazetteEmail {
  return {
    subject: buildSubject(report),
    html: buildHtml(report),
    text: buildText(report),
  };
}

function shouldIncludePosition(
  position: AcademicPosition,
  uncertain: boolean,
  options: PositionFilterOptions,
): boolean {
  if (position.status === "corrected" && options.includeCorrections === false) return false;
  if (position.status === "cancelled" && options.includeCancellations === false) return false;
  if (uncertain && options.includeUncertain === false) return false;

  const text = normalizeTurkish(
    [
      position.university,
      position.unit,
      position.department,
      position.field,
      position.title,
      ...position.specialConditions,
    ].join(" "),
  );
  if (containsAny(text, options.excludedKeywords)) return false;
  if (hasValues(options.requiredKeywords) && !containsAny(text, options.requiredKeywords)) {
    return false;
  }
  if (
    hasValues(options.preferredInstitutions) &&
    !containsAny(normalizeTurkish(position.university), options.preferredInstitutions)
  ) {
    return false;
  }
  return true;
}

function buildSubject(report: GazetteReport): string {
  const prefix = report.positions.length
    ? `[Research Assistant: ${report.positions.length}] `
    : report.manualReview.length
      ? `[Academic notices: ${report.manualReview.length}] `
      : "[Official Gazette] ";
  const supplement = report.publication.supplementNumber
    ? ` — Supplement No. ${report.publication.supplementNumber}`
    : "";
  return `${prefix}${report.publication.dateHuman}${supplement}`.slice(0, 240);
}

function buildHtml(report: GazetteReport): string {
  const publication = report.publication;
  const summary = report.summary.bullets
    .map((item) => `<li style="margin:0 0 8px">${escapeHtml(item)}</li>`)
    .join("");
  const positionCards = report.positions.length
    ? report.positions.map(renderPosition).join("")
    : `<div style="padding:16px;border-radius:10px;background:#eef8f0;color:#245c2d">${
        report.analysisMode === "full" && report.manualReview.length === 0
          ? "No research-assistant vacancy was detected in the completed analysis."
          : "No vacancy has been confirmed. Review the potential academic notices below."
      }</div>`;
  const review = report.manualReview.length
    ? `<h2 style="font-size:18px;margin:28px 0 12px;color:#7a4c00">Documents requiring manual review</h2>
       <p style="color:#6b5a3a">Automated analysis was unavailable, incomplete, or uncertain. Open these official sources to avoid missing a relevant notice.</p>
       <ul style="padding-left:20px">${report.manualReview
         .map(
           (entry) =>
             `<li style="margin:0 0 8px"><a href="${escapeHtml(safeOfficialUrl(entry.url))}" style="color:#0b57d0">${escapeHtml(entry.title)}</a><br><span style="font-size:12px;color:#75674e">${escapeHtml(entry.message)}</span></li>`,
         )
         .join("")}</ul>`
    : "";
  const headlines = report.includeHeadlines
    ? `<h2 style="font-size:18px;margin:30px 0 12px">All published headlines (${publication.items.length})</h2>
       <ol style="padding-left:22px">${publication.items
         .map(
           (item) =>
             `<li style="margin:0 0 10px"><a href="${escapeHtml(safeOfficialUrl(item.url))}" style="color:#0b57d0;text-decoration:none">${escapeHtml(item.title)}</a></li>`,
         )
         .join("")}</ol>`
    : "";

  return `<!doctype html><html><body style="margin:0;background:#f3f5f7;font-family:Arial,Helvetica,sans-serif;color:#202124">
  <div style="display:none;max-height:0;overflow:hidden">Official Gazette monitoring report for ${escapeHtml(publication.dateHuman)}</div>
  <div style="max-width:760px;margin:0 auto;padding:20px">
    <div style="background:#9b1c31;color:#fff;padding:22px 24px;border-radius:14px 14px 0 0">
      <div style="font-size:13px;opacity:.9;letter-spacing:.3px">TÜRKİYE OFFICIAL GAZETTE ALERTS</div>
      <h1 style="font-size:23px;line-height:1.3;margin:7px 0 0">${escapeHtml(publication.title)}</h1>
    </div>
    <div style="background:#fff;padding:24px;border-radius:0 0 14px 14px">
      <p><a href="${escapeHtml(safeOfficialUrl(publication.pdfUrl))}" style="display:inline-block;background:#9b1c31;color:#fff;text-decoration:none;padding:11px 16px;border-radius:8px;font-weight:700">Open official PDF</a></p>
      <h2 style="font-size:18px;margin:24px 0 12px">Issue summary</h2><ul style="padding-left:20px">${summary}</ul>
      <h2 style="font-size:18px;margin:28px 0 12px;color:#9b1c31">Research-assistant vacancies (${report.positions.length})</h2>
      ${positionCards}${review}${headlines}
      <div style="margin-top:28px;padding-top:16px;border-top:1px solid #e0e0e0;color:#6b7280;font-size:12px;line-height:1.5">
        Independent monitoring aid. Always verify deadlines and requirements in the official notice before applying.<br>
        Analysis mode: ${escapeHtml(report.analysisMode.replaceAll("_", " "))} · Source: <a href="${escapeHtml(safeOfficialUrl(publication.pageUrl))}" style="color:#0b57d0">resmigazete.gov.tr</a>
      </div>
    </div>
  </div></body></html>`;
}

function renderPosition(entry: ReportPosition): string {
  const position = entry.position;
  const status =
    position.status === "cancelled"
      ? "CANCELLED"
      : position.status === "corrected"
        ? "Correction notice"
        : "New notice";
  const subtitle = [position.unit, position.department, position.field].filter(Boolean).join(" / ");
  const details: Array<[string, string]> = [
    ["Position", `${position.title}${position.count ? ` (${position.count})` : ""}`],
    ["Grade", position.degree],
    ["ALES", position.ales],
    ["Foreign language", position.foreignLanguage],
    ["Deadline", position.applicationDeadline],
    ["Application", position.applicationMethod],
  ];
  const rows = details
    .filter(([, value]) => value)
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;vertical-align:top">${escapeHtml(label)}</td><td style="padding:4px 0">${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  const conditions = position.specialConditions.length
    ? `<div style="margin-top:10px"><strong>Special conditions</strong><ul style="padding-left:19px">${position.specialConditions.map((condition) => `<li>${escapeHtml(condition)}</li>`).join("")}</ul></div>`
    : "";
  return `<div style="border:1px solid #e2c4ca;border-left:5px solid #9b1c31;border-radius:10px;padding:16px;margin:0 0 14px;background:#fffafb">
    <div style="font-size:12px;font-weight:700">${escapeHtml(status)}</div>
    <h3 style="font-size:17px;margin:8px 0 5px">${escapeHtml(position.university || entry.sourceTitle)}</h3>
    ${subtitle ? `<div style="color:#5f6368;margin-bottom:10px">${escapeHtml(subtitle)}</div>` : ""}
    <table style="border-collapse:collapse;font-size:14px">${rows}</table>${conditions}
    ${entry.uncertain ? '<div style="margin:9px 0;color:#8a4b00;font-weight:700">Some fields are uncertain; check the official document.</div>' : ""}
    ${position.evidence ? `<div style="font-size:12px;color:#6b7280;margin-top:10px">Evidence${position.sourcePage ? ` (page ${escapeHtml(position.sourcePage)})` : ""}: ${escapeHtml(position.evidence)}</div>` : ""}
    <p><a href="${escapeHtml(safeOfficialUrl(entry.sourceUrl))}" style="color:#0b57d0;font-weight:700">Open official notice</a></p>
  </div>`;
}

function buildText(report: GazetteReport): string {
  const lines = [
    report.publication.title,
    safeOfficialUrl(report.publication.pdfUrl),
    "",
    "ISSUE SUMMARY",
    ...report.summary.bullets.map((bullet) => `- ${bullet}`),
    "",
    `RESEARCH-ASSISTANT VACANCIES: ${report.positions.length}`,
  ];
  report.positions.forEach((entry, index) => {
    lines.push(
      "",
      `${index + 1}. ${entry.position.university || entry.sourceTitle}`,
      [entry.position.unit, entry.position.department, entry.position.field]
        .filter(Boolean)
        .join(" / "),
      `Deadline: ${entry.position.applicationDeadline || "Not specified"}`,
      `Source: ${safeOfficialUrl(entry.sourceUrl)}`,
    );
  });
  if (report.manualReview.length) {
    lines.push("", "DOCUMENTS REQUIRING MANUAL REVIEW");
    report.manualReview.forEach((entry) =>
      lines.push(`- ${entry.title}: ${safeOfficialUrl(entry.url)}`),
    );
  }
  if (report.includeHeadlines) {
    lines.push("", "ALL HEADLINES");
    report.publication.items.forEach((item) =>
      lines.push(`- ${item.title}: ${safeOfficialUrl(item.url)}`),
    );
  }
  lines.push("", "Always verify the official notice before applying.");
  return lines.join("\n");
}

function containsAny(normalizedText: string, values: string[] | undefined): boolean {
  return (values ?? []).some((value) => normalizedText.includes(normalizeTurkish(value)));
}

function hasValues(values: string[] | undefined): values is string[] {
  return Boolean(values?.length);
}

function safeOfficialUrl(value: string): string {
  return isOfficialGazetteUrl(value) ? value : `${OFFICIAL_GAZETTE_ORIGIN}/`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
