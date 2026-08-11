import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface VercelConfig {
  crons?: Array<{ path?: unknown; schedule?: unknown }>;
}

const appRoot = fileURLToPath(new URL("..", import.meta.url));

function readConfig(relativePath: string): VercelConfig {
  return JSON.parse(readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8"));
}

function expectCron(config: VercelConfig, schedule: string): void {
  expect(config.crons).toHaveLength(1);
  expect(config.crons?.[0]).toEqual({
    path: "/api/cron/monitor",
    schedule,
  });
}

describe("Vercel Cron configuration", () => {
  it("ships a static, Hobby-safe vercel.json by default", () => {
    const deployed = readConfig("vercel.json");
    const hobbyTemplate = readConfig("config/vercel.hobby.json");
    expect(deployed).toEqual(hobbyTemplate);
    expectCron(deployed, "17 7 * * *");
  });

  it("keeps a complete static hourly template for Pro deployments", () => {
    expectCron(readConfig("config/vercel.pro.json"), "17 * * * *");
  });

  it("does not leave a competing programmatic configuration file", () => {
    expect(existsSync(`${appRoot}/vercel.ts`)).toBe(false);
  });

  it("exposes explicit profile selection and verification commands", () => {
    const packageJson = readConfig("package.json") as Record<string, unknown>;
    const scripts = packageJson.scripts as Record<string, string>;
    expect(scripts["cron:hobby"]).toContain("select-cron-profile.mjs hobby");
    expect(scripts["cron:pro"]).toContain("select-cron-profile.mjs pro");
    expect(scripts["cron:verify"]).toContain("verify-cron-config.mjs");
  });
});
