import { describe, expect, it } from "vitest";
import {
  RequestSecurityError,
  assertSameOrigin,
  isCronAuthorized,
  requireCronAuthorization,
} from "@/lib/csrf";
import {
  getSessionCookieName,
  readCookie,
  serializeExpiredSessionCookie,
  serializeSessionCookie,
} from "@/lib/auth";
import { getServerEnv } from "@/lib/env";
import { testResendApiKey } from "@/lib/provider-tests";

const validEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://user:password@example.neon.tech/app?sslmode=require",
  ADMIN_PASSWORD_HASH:
    "scrypt$v1$16384$8$1$abcdefghijklmnopqrstuv$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-abcdefghijklmnopqrstuv",
  SESSION_SECRET: "session-secret-with-at-least-thirty-two-characters",
  APP_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString("base64url"),
  CRON_SECRET: "cron-secret-at-least-sixteen-characters",
};

describe("same-origin protection", () => {
  it("allows a same-origin mutation", () => {
    const request = new Request("https://monitor.example/api/settings", {
      method: "POST",
      headers: { origin: "https://monitor.example", "sec-fetch-site": "same-origin" },
    });
    expect(() => assertSameOrigin(request)).not.toThrow();
  });

  it("rejects missing, cross-origin, and cross-site mutation requests", () => {
    const missing = new Request("https://monitor.example/api/settings", { method: "POST" });
    expect(() => assertSameOrigin(missing)).toThrow(RequestSecurityError);

    const foreign = new Request("https://monitor.example/api/settings", {
      method: "POST",
      headers: { origin: "https://attacker.example" },
    });
    expect(() => assertSameOrigin(foreign)).toThrow(RequestSecurityError);

    const crossSite = new Request("https://monitor.example/api/settings", {
      method: "POST",
      headers: { origin: "https://monitor.example", "sec-fetch-site": "cross-site" },
    });
    expect(() => assertSameOrigin(crossSite)).toThrow(RequestSecurityError);
  });

  it("does not require an Origin header for safe reads", () => {
    const request = new Request("https://monitor.example/api/dashboard");
    expect(() => assertSameOrigin(request)).not.toThrow();
  });
});

describe("cron authorization", () => {
  const cronSecret = "cron-secret-at-least-sixteen-characters";

  it("accepts only the exact bearer secret", () => {
    const valid = new Request("https://monitor.example/api/cron/monitor", {
      headers: { authorization: `Bearer ${cronSecret}` },
    });
    expect(isCronAuthorized(valid, cronSecret)).toBe(true);
    expect(() => requireCronAuthorization(valid, cronSecret)).not.toThrow();

    const invalid = new Request("https://monitor.example/api/cron/monitor", {
      headers: { authorization: "Bearer wrong-secret" },
    });
    expect(isCronAuthorized(invalid, cronSecret)).toBe(false);
    expect(() => requireCronAuthorization(invalid, cronSecret)).toThrow(RequestSecurityError);
  });
});

describe("session cookies", () => {
  it("uses the __Host prefix and secure cookie attributes in production", () => {
    const expires = new Date("2026-08-12T10:00:00.000Z");
    const cookie = serializeSessionCookie("token.value", expires, "production");
    expect(getSessionCookieName("production")).toBe("__Host-rg_admin_session");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Path=/");
    expect(readCookie(cookie, "__Host-rg_admin_session")).toBe("token.value");
  });

  it("expires the exact session cookie", () => {
    expect(serializeExpiredSessionCookie("production")).toContain(
      "__Host-rg_admin_session=;",
    );
    expect(serializeExpiredSessionCookie("production")).toContain("Max-Age=0");
  });
});

describe("server environment validation", () => {
  it("derives a Hobby-safe scheduler minimum by default", () => {
    const env = getServerEnv(validEnvironment);
    expect(env.cronProfile).toBe("hobby");
    expect(env.schedulerMinIntervalHours).toBe(24);
  });

  it("enables hourly settings only for the explicit Pro profile", () => {
    const env = getServerEnv({ ...validEnvironment, VERCEL_CRON_PROFILE: "pro" });
    expect(env.schedulerMinIntervalHours).toBe(1);
  });

  it("rejects weak secrets and non-Postgres database URLs", () => {
    expect(() => getServerEnv({ ...validEnvironment, SESSION_SECRET: "short" })).toThrow();
    expect(() =>
      getServerEnv({ ...validEnvironment, DATABASE_URL: "https://example.com/database" }),
    ).toThrow(/Postgres URL/i);
  });
});

describe("Resend least-privilege key verification", () => {
  it("accepts full-access and recognized sending-only credentials", async () => {
    const fullAccessFetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("user-agent")).toBe(
        "OfficialGazetteMonitor/1.0",
      );
      return Response.json({ data: [] });
    };
    const sendingOnlyFetch = async () =>
      Response.json(
        { name: "restricted_api_key", message: "This key can only send email." },
        { status: 401 },
      );

    await expect(
      testResendApiKey("re_" + "full_access_test_key", fullAccessFetch),
    ).resolves.toBeUndefined();
    await expect(
      testResendApiKey("re_" + "sending_access_test_key", sendingOnlyFetch),
    ).resolves.toBeUndefined();
  });

  it("rejects invalid credentials", async () => {
    const invalidFetch = async () =>
      Response.json({ name: "invalid_api_key" }, { status: 403 });

    await expect(
      testResendApiKey("re_" + "invalid_test_key", invalidFetch),
    ).rejects.toThrow(/rejected/i);
  });
});
