import {
  MAX_SUPPLEMENT_NUMBER,
  OFFICIAL_GAZETTE_ORIGIN,
  assertOfficialGazetteUrl,
  cleanHeadline,
  discoverSupplementNumbers,
  extractAnchors,
  htmlToText,
  isAcademicCandidateTitle,
  parseIssuePage,
  toGazetteDateParts,
  type AcademicCandidate,
  type GazettePublication,
} from "./parser";
import { officialGazetteFetch } from "./transport";

export type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type CandidateContent =
  | { kind: "pdf"; bytes: Uint8Array; mimeType: "application/pdf" }
  | { kind: "text"; text: string; mimeType: "text/plain" };

export interface CollectorOptions {
  fetchImpl?: FetchImplementation;
  timeoutMs?: number;
  maxHtmlBytes?: number;
  maxPdfBytes?: number;
  maxRedirects?: number;
  maxSupplementsPerIssue?: number;
  userAgent?: string;
}

export interface CollectOptions {
  includeSupplements?: boolean;
  canStartNetwork?: () => boolean;
}

export interface CandidateCollectionOptions {
  canStartNetwork?: () => boolean;
}

export interface OfficialResource {
  ok: boolean;
  status: number;
  finalUrl: string;
  contentType: string;
  bytes: Uint8Array;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_HTML_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_PDF_BYTES = 30 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_MAX_SUPPLEMENTS = 20;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class OfficialGazetteCollector {
  private readonly fetchImpl: FetchImplementation;
  private readonly timeoutMs: number;
  private readonly maxHtmlBytes: number;
  private readonly maxPdfBytes: number;
  private readonly maxRedirects: number;
  private readonly maxSupplementsPerIssue: number;
  private readonly userAgent: string;

  constructor(options: CollectorOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? officialGazetteFetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxHtmlBytes = options.maxHtmlBytes ?? DEFAULT_MAX_HTML_BYTES;
    this.maxPdfBytes = options.maxPdfBytes ?? DEFAULT_MAX_PDF_BYTES;
    this.maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    this.maxSupplementsPerIssue =
      options.maxSupplementsPerIssue ?? DEFAULT_MAX_SUPPLEMENTS;
    this.userAgent =
      options.userAgent ?? "TurkishOfficialGazetteAcademicAlerts-Vercel/1.0";
  }

  async collectPublications(
    monitoringDate: Date,
    options: CollectOptions = {},
  ): Promise<GazettePublication[]> {
    const date = toGazetteDateParts(monitoringDate);
    const dailyUrl = `${OFFICIAL_GAZETTE_ORIGIN}/${date.displayNumeric}`;
    const daily = await this.fetchText(dailyUrl, true);
    if (!daily.ok) return [];

    const publications: GazettePublication[] = [];
    const regular = parseIssuePage(daily.text, daily.finalUrl, date, 0);
    if (regular) publications.push(regular);

    if (options.includeSupplements !== false) {
      const discovered = discoverSupplementNumbers(
        daily.text,
        daily.finalUrl,
        date,
        MAX_SUPPLEMENT_NUMBER,
      ).slice(0, this.maxSupplementsPerIssue);

      for (const supplementNumber of discovered) {
        if (options.canStartNetwork && !options.canStartNetwork()) break;
        const supplementUrl = `${OFFICIAL_GAZETTE_ORIGIN}/fihrist?tarih=${encodeURIComponent(date.iso)}&mukerrer=${supplementNumber}`;
        try {
          const supplementPage = await this.fetchText(supplementUrl, true);
          if (!supplementPage.ok) continue;
          const supplement = parseIssuePage(
            supplementPage.text,
            supplementPage.finalUrl,
            date,
            supplementNumber,
          );
          if (supplement) publications.push(supplement);
        } catch {
          // A supplemental issue must not make the regular issue disappear.
        }
      }
    }

    return dedupeBy(publications, (publication) => publication.pdfUrl);
  }

  async collectAcademicCandidates(
    publication: GazettePublication,
    options: CandidateCollectionOptions = {},
  ): Promise<AcademicCandidate[]> {
    const candidates: AcademicCandidate[] = [];
    if (publication.items.length === 0) {
      candidates.push({
        title: "Daily index headlines could not be parsed",
        url: publication.pageUrl,
        discoveryError: true,
        discoveryMessage: "Open the official issue manually; the index could not be parsed.",
      });
    }

    const announcementIndexes = publication.items.filter((item) => {
      const path = new URL(item.url).pathname;
      const normalized = normalizeForMatching(item.title);
      return (
        path.toLowerCase().includes("/ilanlar/eskiilanlar/") &&
        (normalized.includes("cesitli ilan") || /-4\.htm$/i.test(path))
      );
    });

    if (publication.type === "normal" && announcementIndexes.length === 0) {
      candidates.push({
        title: "Miscellaneous Notices link was not found",
        url: publication.pdfUrl,
        discoveryError: true,
        discoveryMessage: "Review the main Official Gazette PDF manually.",
      });
    }

    for (const indexItem of announcementIndexes) {
      if (options.canStartNetwork && !options.canStartNetwork()) {
        candidates.push({
          title: `${indexItem.title} (deferred at the safe run deadline)`,
          url: indexItem.url,
          discoveryError: true,
          discoveryMessage:
            "The safe run deadline was reached before this notice index could be scanned; review it manually.",
        });
        continue;
      }
      try {
        const indexPage = await this.fetchText(indexItem.url, false);
        const links = extractAnchors(indexPage.text, indexPage.finalUrl)
          .filter((anchor) => /\.pdf$/i.test(new URL(anchor.url).pathname))
          .map((anchor) => ({ title: cleanHeadline(anchor.text), url: anchor.url }))
          .filter((candidate) => candidate.title.length > 2);
        if (links.length > 0) {
          candidates.push(...links);
        } else {
          candidates.push({
            title: `${indexItem.title} (PDF links could not be parsed)`,
            url: indexItem.url,
            discoveryError: true,
            discoveryMessage: "Review this official index manually.",
          });
        }
      } catch {
        candidates.push({
          title: `${indexItem.title} (automated scan failed)`,
          url: indexItem.url,
          discoveryError: true,
          discoveryMessage: "Review this official index manually.",
        });
      }
    }

    candidates.push(
      ...publication.items
        .filter((item) => isAcademicCandidateTitle(item.title))
        .map((item) => ({ title: item.title, url: item.url })),
    );

    return dedupeBy(candidates, (candidate) => candidate.url);
  }

  async fetchCandidateContent(candidate: AcademicCandidate): Promise<CandidateContent> {
    const pathname = assertOfficialGazetteUrl(candidate.url).pathname;
    if (/\.pdf$/i.test(pathname)) {
      const resource = await this.fetchResource(candidate.url, "pdf", false);
      return { kind: "pdf", bytes: resource.bytes, mimeType: "application/pdf" };
    }

    const resource = await this.fetchText(candidate.url, false);
    return {
      kind: "text",
      text: htmlToText(resource.text).slice(0, 100_000),
      mimeType: "text/plain",
    };
  }

  private async fetchText(
    url: string,
    allowNotFound: boolean,
  ): Promise<{ ok: boolean; status: number; finalUrl: string; text: string }> {
    const resource = await this.fetchResource(url, "html", allowNotFound);
    return {
      ok: resource.ok,
      status: resource.status,
      finalUrl: resource.finalUrl,
      text: new TextDecoder("utf-8", { fatal: false }).decode(resource.bytes),
    };
  }

  private fetchResource(
    url: string,
    kind: "html" | "pdf",
    allowNotFound: boolean,
  ): Promise<OfficialResource> {
    return fetchOfficialResource(url, {
      fetchImpl: this.fetchImpl,
      kind,
      allowNotFound,
      timeoutMs: this.timeoutMs,
      maxBytes: kind === "pdf" ? this.maxPdfBytes : this.maxHtmlBytes,
      maxRedirects: this.maxRedirects,
      userAgent: this.userAgent,
    });
  }
}

export interface FetchOfficialResourceOptions {
  fetchImpl?: FetchImplementation;
  kind: "html" | "pdf";
  allowNotFound?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
}

export async function fetchOfficialResource(
  input: string,
  options: FetchOfficialResourceOptions,
): Promise<OfficialResource> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes =
    options.maxBytes ??
    (options.kind === "pdf" ? DEFAULT_MAX_PDF_BYTES : DEFAULT_MAX_HTML_BYTES);
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  let currentUrl = assertOfficialGazetteUrl(input);

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(currentUrl, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Accept:
            options.kind === "pdf"
              ? "application/pdf,application/octet-stream;q=0.8"
              : "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.7",
          "Accept-Language": "tr-TR,tr;q=0.9",
          "User-Agent":
            options.userAgent ?? "TurkishOfficialGazetteAcademicAlerts-Vercel/1.0",
        },
      });

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new Error("The Official Gazette returned an invalid redirect.");
        if (redirectCount >= maxRedirects) {
          throw new Error("The Official Gazette returned too many redirects.");
        }
        currentUrl = assertOfficialGazetteUrl(new URL(location, currentUrl));
        continue;
      }

      if (response.status === 404 && options.allowNotFound) {
        return {
          ok: false,
          status: 404,
          finalUrl: currentUrl.toString(),
          contentType: response.headers.get("content-type") ?? "",
          bytes: new Uint8Array(),
        };
      }
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`The Official Gazette returned HTTP ${response.status}.`);
      }

      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      validateContentType(options.kind, contentType);
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        throw new Error("The Official Gazette response exceeds the configured size limit.");
      }
      const bytes = await readResponseWithLimit(response, maxBytes);
      if (options.kind === "pdf" && !hasPdfSignature(bytes)) {
        throw new Error("The downloaded Official Gazette document is not a valid PDF.");
      }

      return {
        ok: true,
        status: response.status,
        finalUrl: currentUrl.toString(),
        contentType,
        bytes,
      };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("The Official Gazette request timed out.");
      }
      throw error instanceof Error
        ? error
        : new Error(`The Official Gazette request failed: ${safeErrorMessage(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error("The Official Gazette redirect could not be resolved.");
}

async function readResponseWithLimit(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("The Official Gazette response exceeds the configured size limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function validateContentType(kind: "html" | "pdf", contentType: string): void {
  if (!contentType) return;
  if (kind === "html" && !/^(?:text\/html|application\/xhtml\+xml|text\/plain)\b/i.test(contentType)) {
    throw new Error("The Official Gazette returned an unexpected page content type.");
  }
  if (kind === "pdf" && !/^(?:application\/pdf|application\/octet-stream)\b/i.test(contentType)) {
    throw new Error("The Official Gazette returned an unexpected document content type.");
  }
}

function hasPdfSignature(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

function normalizeForMatching(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/AIza[0-9A-Za-z_-]{20,}/g, "[API KEY REDACTED]").slice(0, 500);
}

function dedupeBy<T>(values: T[], keyFor: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = keyFor(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
