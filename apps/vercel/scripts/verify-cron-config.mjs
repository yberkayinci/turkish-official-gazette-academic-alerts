import { readFile } from "node:fs/promises";

const configuredProfile = process.env.VERCEL_CRON_PROFILE?.trim() || "hobby";
if (configuredProfile !== "hobby" && configuredProfile !== "pro") {
  throw new Error("VERCEL_CRON_PROFILE must be either hobby or pro.");
}

const expectedSchedule = configuredProfile === "pro" ? "17 * * * *" : "17 7 * * *";
const configUrl = new URL("../vercel.json", import.meta.url);
const config = JSON.parse(await readFile(configUrl, "utf8"));
const cron = config?.crons?.[0];

if (!cron || cron.path !== "/api/cron/monitor") {
  throw new Error("vercel.json must contain the protected /api/cron/monitor job.");
}
if (typeof cron.schedule !== "string" || !cron.schedule.trim()) {
  throw new Error("vercel.json crons[0].schedule must be a static, non-empty string.");
}
if (cron.schedule !== expectedSchedule) {
  throw new Error(
    `Cron profile mismatch: VERCEL_CRON_PROFILE=${configuredProfile} expects '${expectedSchedule}', but vercel.json contains '${cron.schedule}'. Run 'npm run cron:${configuredProfile}' and redeploy.`,
  );
}

console.log(`Cron configuration verified: ${configuredProfile} (${expectedSchedule}).`);
