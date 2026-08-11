import { normalizeTurkish } from "../official-gazette/parser";

export type AcademicDocumentType =
  | "academic_recruitment"
  | "correction"
  | "cancellation"
  | "other";
export type AcademicPositionStatus = "new" | "corrected" | "cancelled";

export interface AcademicPosition {
  university: string;
  unit: string;
  department: string;
  field: string;
  title: string;
  status: AcademicPositionStatus;
  count: number;
  degree: string;
  ales: string;
  foreignLanguage: string;
  specialConditions: string[];
  applicationDeadline: string;
  applicationMethod: string;
  evidence: string;
  sourcePage: string;
}

export interface AcademicAnalysis {
  documentType: AcademicDocumentType;
  hasResearchAssistant: boolean;
  uncertain: boolean;
  needsManualReview: boolean;
  documentSummary: string;
  positions: AcademicPosition[];
}

export interface HeadlineSummary {
  bullets: string[];
  notable: string[];
}

export const ACADEMIC_ANALYSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    document_type: {
      type: "string",
      enum: ["academic_recruitment", "correction", "cancellation", "other"],
    },
    has_research_assistant: { type: "boolean" },
    uncertain: { type: "boolean" },
    needs_manual_review: { type: "boolean" },
    document_summary: { type: "string" },
    positions: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          university: { type: "string" },
          unit: { type: "string" },
          department: { type: "string" },
          field: { type: "string" },
          title: { type: "string" },
          status: { type: "string", enum: ["new", "corrected", "cancelled"] },
          count: { type: "integer", minimum: 0, maximum: 10_000 },
          degree: { type: "string" },
          ales: { type: "string" },
          foreign_language: { type: "string" },
          special_conditions: {
            type: "array",
            maxItems: 12,
            items: { type: "string" },
          },
          application_deadline: { type: "string" },
          application_method: { type: "string" },
          evidence: { type: "string" },
          source_page: { type: "string" },
        },
        required: [
          "university",
          "unit",
          "department",
          "field",
          "title",
          "status",
          "count",
          "degree",
          "ales",
          "foreign_language",
          "special_conditions",
          "application_deadline",
          "application_method",
          "evidence",
          "source_page",
        ],
      },
    },
  },
  required: [
    "document_type",
    "has_research_assistant",
    "uncertain",
    "needs_manual_review",
    "document_summary",
    "positions",
  ],
} as const;

export const HEADLINE_SUMMARY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    bullets: { type: "array", minItems: 1, maxItems: 6, items: { type: "string" } },
    notable: { type: "array", maxItems: 5, items: { type: "string" } },
  },
  required: ["bullets", "notable"],
} as const;

export function parseAcademicAnalysis(value: unknown): AcademicAnalysis {
  if (!isRecord(value)) throw new Error("Gemini returned an invalid analysis object.");
  requireBoolean(value.has_research_assistant, "has_research_assistant");
  requireBoolean(value.uncertain, "uncertain");
  requireBoolean(value.needs_manual_review, "needs_manual_review");
  if (!Array.isArray(value.positions)) {
    throw new Error("Gemini returned an invalid positions collection.");
  }

  const documentType = isDocumentType(value.document_type) ? value.document_type : "other";
  const positions = value.positions
    .slice(0, 100)
    .map(normalizePosition)
    .filter((position): position is AcademicPosition => position !== null);
  const modelClaimsResearchAssistant = value.has_research_assistant;
  const inconsistentPositive = modelClaimsResearchAssistant && positions.length === 0;

  return {
    documentType,
    hasResearchAssistant: positions.length > 0 || modelClaimsResearchAssistant,
    uncertain: value.uncertain,
    needsManualReview: value.needs_manual_review || inconsistentPositive,
    documentSummary: safeText(value.document_summary, 1_200),
    positions,
  };
}

export function parseHeadlineSummary(value: unknown): HeadlineSummary {
  if (!isRecord(value) || !Array.isArray(value.bullets) || !Array.isArray(value.notable)) {
    throw new Error("Gemini returned an invalid headline summary.");
  }
  const bullets = value.bullets.map((item) => safeText(item, 500)).filter(Boolean).slice(0, 6);
  if (bullets.length === 0) {
    throw new Error("Gemini returned an empty headline summary.");
  }
  return {
    bullets,
    notable: value.notable.map((item) => safeText(item, 500)).filter(Boolean).slice(0, 5),
  };
}

function normalizePosition(value: unknown): AcademicPosition | null {
  if (!isRecord(value)) return null;
  const title = safeText(value.title, 120) || "Research Assistant";
  const normalizedTitle = normalizeTurkish(title);
  if (
    !normalizedTitle.includes("arastirma gorevlisi") &&
    !normalizedTitle.includes("research assistant")
  ) {
    return null;
  }
  const status: AcademicPositionStatus =
    value.status === "corrected" || value.status === "cancelled" ? value.status : "new";
  const count = Number(value.count);

  return {
    university: safeText(value.university, 300),
    unit: safeText(value.unit, 300),
    department: safeText(value.department, 300),
    field: safeText(value.field, 300),
    title,
    status,
    count: Number.isFinite(count) ? Math.min(10_000, Math.max(0, Math.trunc(count))) : 0,
    degree: safeText(value.degree, 80),
    ales: safeText(value.ales, 300),
    foreignLanguage: safeText(value.foreign_language, 300),
    specialConditions: Array.isArray(value.special_conditions)
      ? value.special_conditions
          .map((item) => safeText(item, 400))
          .filter(Boolean)
          .slice(0, 12)
      : [],
    applicationDeadline: safeText(value.application_deadline, 100),
    applicationMethod: safeText(value.application_method, 500),
    evidence: safeText(value.evidence, 700),
    sourcePage: safeText(value.source_page, 50),
  };
}

function isDocumentType(value: unknown): value is AcademicDocumentType {
  return (
    value === "academic_recruitment" ||
    value === "correction" ||
    value === "cancellation" ||
    value === "other"
  );
}

function requireBoolean(value: unknown, field: string): asserts value is boolean {
  if (typeof value !== "boolean") throw new Error(`Gemini omitted ${field}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeText(value: unknown, maximum: number): string {
  return (typeof value === "string" ? value : "").replace(/\s+/g, " ").trim().slice(0, maximum);
}
