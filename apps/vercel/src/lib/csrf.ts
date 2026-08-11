import { constantTimeEqual } from "./crypto";
import { getServerEnv } from "./env";

export class RequestSecurityError extends Error {
  constructor(message = "The request failed security validation.") {
    super(message);
    this.name = "RequestSecurityError";
  }
}

function normalizedOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function assertSameOrigin(request: Request, expectedOrigin?: string): void {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;

  const requestOrigin = normalizedOrigin(request.headers.get("origin") ?? "");
  const expected = normalizedOrigin(expectedOrigin ?? request.url);
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!requestOrigin || !expected || requestOrigin !== expected || fetchSite === "cross-site") {
    throw new RequestSecurityError();
  }
}

export function isCronAuthorized(request: Request, cronSecret = getServerEnv().cronSecret): boolean {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return false;
  const supplied = authorization.slice("Bearer ".length);
  return supplied.length > 0 && constantTimeEqual(supplied, cronSecret);
}

export function requireCronAuthorization(
  request: Request,
  cronSecret = getServerEnv().cronSecret,
): void {
  if (!isCronAuthorized(request, cronSecret)) {
    throw new RequestSecurityError("Cron authorization failed.");
  }
}
