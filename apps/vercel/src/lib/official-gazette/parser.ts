export const OFFICIAL_GAZETTE_ORIGIN = "https://www.resmigazete.gov.tr";
export const MAX_HEADLINES = 180;
export const MAX_SUPPLEMENT_NUMBER = 999;

export interface GazetteDateParts {
  year: string;
  month: string;
  day: string;
  iso: string;
  compact: string;
  displayNumeric: string;
  human: string;
}

export interface GazetteAnchor {
  text: string;
  url: string;
}

export interface GazetteHeadline {
  title: string;
  url: string;
}

export interface GazettePublication {
  id: string;
  date: string;
  dateHuman: string;
  title: string;
  type: "normal" | "supplement";
  supplementNumber: number;
  pageUrl: string;
  pdfUrl: string;
  items: GazetteHeadline[];
}

export interface AcademicCandidate {
  title: string;
  url: string;
  discoveryError?: boolean;
  discoveryMessage?: string;
}

const TURKISH_MONTHS = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
] as const;

export function toGazetteDateParts(
  date: Date,
  timeZone = "Europe/Istanbul",
): GazetteDateParts {
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("A valid monitoring date is required.");
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = values.year;
  const month = values.month;
  const day = values.day;
  if (!year || !month || !day) {
    throw new Error("The monitoring date could not be formatted.");
  }

  return {
    year,
    month,
    day,
    iso: `${year}-${month}-${day}`,
    compact: `${year}${month}${day}`,
    displayNumeric: `${day}.${month}.${year}`,
    human: `${Number(day)} ${TURKISH_MONTHS[Number(month) - 1]} ${year}`,
  };
}

export function isOfficialGazetteUrl(value: string | URL): boolean {
  try {
    const url = value instanceof URL ? value : new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname.toLowerCase() === "www.resmigazete.gov.tr" &&
      (url.port === "" || url.port === "443") &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

export function assertOfficialGazetteUrl(value: string | URL): URL {
  const url = value instanceof URL ? new URL(value.toString()) : new URL(value);
  if (!isOfficialGazetteUrl(url)) {
    throw new Error("Only HTTPS resources on www.resmigazete.gov.tr are allowed.");
  }
  return url;
}

export function resolveOfficialGazetteUrl(rawHref: string, baseUrl: string): string | null {
  const href = decodeHtmlEntities(rawHref).trim();
  if (!href || /^(?:javascript:|data:|mailto:|tel:|#)/i.test(href)) {
    return null;
  }

  try {
    const base = assertOfficialGazetteUrl(baseUrl);
    const resolved = new URL(href, base);
    return isOfficialGazetteUrl(resolved) ? resolved.toString() : null;
  } catch {
    return null;
  }
}

export function extractAnchors(html: string, baseUrl: string): GazetteAnchor[] {
  assertOfficialGazetteUrl(baseUrl);
  const results: GazetteAnchor[] = [];
  const pattern = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(String(html))) !== null) {
    const url = resolveOfficialGazetteUrl(match[2], baseUrl);
    if (!url) continue;
    results.push({ text: cleanHeadline(htmlToText(match[3])), url });
  }

  return results;
}

export function discoverSupplementNumbers(
  html: string,
  pageUrl: string,
  date: GazetteDateParts,
  maximum = MAX_SUPPLEMENT_NUMBER,
): number[] {
  const observed = new Set<number>();

  for (const anchor of extractAnchors(html, pageUrl)) {
    const url = new URL(anchor.url);
    if (!/\/fihrist$/i.test(url.pathname)) continue;
    const linkedDate = url.searchParams.get("tarih")?.trim();
    const rawNumber = url.searchParams.get("mukerrer");
    const number = Number(rawNumber);
    if (linkedDate !== date.iso || !Number.isInteger(number) || number < 1 || number > maximum) {
      continue;
    }
    observed.add(number);
  }

  if (observed.size === 0) return [];
  const highest = Math.max(...observed);
  return Array.from({ length: highest }, (_, index) => index + 1);
}

/**
 * Parses only the requested publication date. The Official Gazette website can
 * return another day's page with HTTP 200; requiring the exact expected PDF
 * filename is the deliberate fallback-defense boundary.
 */
export function parseIssuePage(
  html: string,
  pageUrl: string,
  date: GazetteDateParts,
  supplementNumber = 0,
): GazettePublication | null {
  const anchors = extractAnchors(html, pageUrl);
  const baseToken = `${date.compact}${supplementNumber ? `M${supplementNumber}` : ""}`;
  const expectedPdfPath = new RegExp(
    `^/eskiler/${escapeRegExp(date.year)}/${escapeRegExp(date.month)}/${escapeRegExp(baseToken)}\\.pdf$`,
    "i",
  );
  const pdfAnchor = anchors.find((anchor) => expectedPdfPath.test(new URL(anchor.url).pathname));
  if (!pdfAnchor) return null;

  const issueItemPath = new RegExp(
    `^/eskiler/${escapeRegExp(date.year)}/${escapeRegExp(date.month)}/${escapeRegExp(baseToken)}-\\d+\\.(?:htm|html|pdf)$`,
    "i",
  );
  const announcementPath = new RegExp(
    `^/ilanlar/eskiilanlar/${escapeRegExp(date.year)}/${escapeRegExp(date.month)}/${escapeRegExp(baseToken)}-\\d+\\.htm$`,
    "i",
  );

  const allItems = dedupeBy(
    anchors
      .filter((anchor) => {
        const pathname = new URL(anchor.url).pathname;
        return (
          anchor.text.length > 2 &&
          anchor.url !== pdfAnchor.url &&
          (issueItemPath.test(pathname) || announcementPath.test(pathname))
        );
      })
      .map((anchor) => ({ title: cleanHeadline(anchor.text), url: anchor.url })),
    (item) => `${item.url}|${item.title}`,
  );
  const announcementItems = allItems.filter((item) => {
    const path = new URL(item.url).pathname;
    const normalized = normalizeTurkish(item.title);
    return (
      path.toLowerCase().includes("/ilanlar/eskiilanlar/") &&
      (normalized.includes("cesitli ilan") || /-4\.htm$/i.test(path))
    );
  });
  const items = dedupeBy(
    [...announcementItems, ...allItems],
    (item) => `${item.url}|${item.title}`,
  ).slice(0, MAX_HEADLINES);

  const title =
    extractIssueTitle(html) ||
    `${date.human} Tarihli Resmî Gazete${supplementNumber ? ` — ${supplementNumber}. Mükerrer` : ""}`;

  return {
    id: stablePublicationId(pdfAnchor.url),
    date: date.iso,
    dateHuman: date.human,
    title,
    type: supplementNumber ? "supplement" : "normal",
    supplementNumber,
    pageUrl: assertOfficialGazetteUrl(pageUrl).toString(),
    pdfUrl: pdfAnchor.url,
    items,
  };
}

export function isAcademicCandidateTitle(title: string): boolean {
  return /universite|rektor|yuksekogretim|yuksek ogretim|enstitu|akademi|fakulte|ogretim elemani|ogretim uyesi|arastirma gorevlisi/.test(
    normalizeTurkish(title),
  );
}

export function normalizeTurkish(value: string): string {
  return String(value)
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function htmlToText(html: string): string {
  return decodeHtmlEntities(
    String(html)
      .replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ")
      .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanHeadline(value: string): string {
  return String(value).replace(/\s+/g, " ").trim().slice(0, 500);
}

function extractIssueTitle(html: string): string {
  const text = htmlToText(html);
  const match = text.match(
    /(\d{1,2}\s+[A-Za-zÇĞİÖŞÜçğıöşü]+\s+\d{4}\s+Tarihli\s+ve\s+\d+\s+Sayılı\s+Resm(?:î|i)\s+Gazete(?:\s+\d+\.\s*Mükerrer)?)/i,
  );
  return match?.[1]?.trim() ?? "";
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return String(value).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] === "#") {
      const isHex = code[1]?.toLowerCase() === "x";
      const point = Number.parseInt(code.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(point) && point >= 0 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : entity;
    }
    return named[code.toLowerCase()] ?? entity;
  });
}

function stablePublicationId(url: string): string {
  // The canonical source URL is also persisted with this key; this compact ID
  // is for display and deterministic in-process identity, not cryptography.
  let hash = 2166136261;
  for (let index = 0; index < url.length; index += 1) {
    hash ^= url.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `gazette_${(hash >>> 0).toString(16).padStart(8, "0")}`;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
