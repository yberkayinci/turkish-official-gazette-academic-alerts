import { randomUUID, timingSafeEqual } from "node:crypto";
import { getServerEnv } from "./env";
import { hmacSha256, verifyPassword } from "./crypto";

const SESSION_VERSION = 1;
const PRODUCTION_COOKIE_NAME = "__Host-rg_admin_session";
const DEVELOPMENT_COOKIE_NAME = "rg_admin_session";

export interface OwnerSession {
  version: 1;
  subject: "owner";
  issuedAt: number;
  expiresAt: number;
  sessionId: string;
}

export class AuthenticationError extends Error {
  constructor(message = "Authentication is required.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeJson(value: string): unknown {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function isOwnerSession(value: unknown): value is OwnerSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === SESSION_VERSION &&
    candidate.subject === "owner" &&
    typeof candidate.issuedAt === "number" &&
    Number.isInteger(candidate.issuedAt) &&
    typeof candidate.expiresAt === "number" &&
    Number.isInteger(candidate.expiresAt) &&
    typeof candidate.sessionId === "string" &&
    /^[0-9a-f-]{36}$/i.test(candidate.sessionId)
  );
}

export function createSessionToken(
  signingSecret: string,
  options: { now?: Date; ttlSeconds?: number } = {},
): { token: string; session: OwnerSession } {
  const now = Math.floor((options.now ?? new Date()).getTime() / 1_000);
  const ttlSeconds = options.ttlSeconds ?? 86_400;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 604_800) {
    throw new Error("Session lifetime must be between one minute and seven days.");
  }
  const session: OwnerSession = {
    version: SESSION_VERSION,
    subject: "owner",
    issuedAt: now,
    expiresAt: now + ttlSeconds,
    sessionId: randomUUID(),
  };
  const payload = encodeJson(session);
  const signature = hmacSha256(payload, signingSecret).toString("base64url");
  return { token: `${payload}.${signature}`, session };
}

export function verifySessionToken(
  token: string,
  signingSecret: string,
  now = new Date(),
): OwnerSession | null {
  try {
    if (!token || token.length > 2_048) return null;
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const supplied = Buffer.from(parts[1], "base64url");
    const expected = hmacSha256(parts[0], signingSecret);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    const session = decodeJson(parts[0]);
    if (!isOwnerSession(session)) return null;
    const nowSeconds = Math.floor(now.getTime() / 1_000);
    if (session.issuedAt > nowSeconds + 60 || session.expiresAt <= nowSeconds) return null;
    if (session.expiresAt - session.issuedAt > 604_800) return null;
    return session;
  } catch {
    return null;
  }
}

export function getSessionCookieName(nodeEnv = getServerEnv().nodeEnv): string {
  return nodeEnv === "production" ? PRODUCTION_COOKIE_NAME : DEVELOPMENT_COOKIE_NAME;
}

export function serializeSessionCookie(
  token: string,
  expiresAt: Date,
  nodeEnv = getServerEnv().nodeEnv,
): string {
  const name = getSessionCookieName(nodeEnv);
  const secure = nodeEnv === "production" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict${secure}; Expires=${expiresAt.toUTCString()}`;
}

export function serializeExpiredSessionCookie(nodeEnv = getServerEnv().nodeEnv): string {
  const name = getSessionCookieName(nodeEnv);
  const secure = nodeEnv === "production" ? "; Secure" : "";
  return `${name}=; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=0`;
}

export function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export async function authenticateOwnerPassword(password: string): Promise<boolean> {
  return verifyPassword(password, getServerEnv().adminPasswordHash);
}

export function getLoginIdentifierHash(request: Request, secret = getServerEnv().sessionSecret): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const identifier = (
    request.headers.get("x-real-ip")?.trim() || forwarded || "unknown-client"
  ).slice(0, 256);
  return hmacSha256(`login-rate-limit:${identifier}`, secret).toString("hex");
}

export function issueOwnerSession(now = new Date()): {
  token: string;
  session: OwnerSession;
  cookie: string;
} {
  const env = getServerEnv();
  const ttlSeconds = env.sessionTtlHours * 3_600;
  const issued = createSessionToken(env.sessionSecret, { now, ttlSeconds });
  return {
    ...issued,
    cookie: serializeSessionCookie(
      issued.token,
      new Date(issued.session.expiresAt * 1_000),
      env.nodeEnv,
    ),
  };
}

export function getOwnerSession(request: Request, now = new Date()): OwnerSession | null {
  const env = getServerEnv();
  const token = readCookie(request.headers.get("cookie"), getSessionCookieName(env.nodeEnv));
  return token ? verifySessionToken(token, env.sessionSecret, now) : null;
}

export function requireOwnerSession(request: Request, now = new Date()): OwnerSession {
  const session = getOwnerSession(request, now);
  if (!session) throw new AuthenticationError();
  return session;
}
