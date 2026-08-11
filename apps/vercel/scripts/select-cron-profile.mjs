import { copyFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const profile = process.argv[2];
if (profile !== "hobby" && profile !== "pro") {
  throw new Error("Choose exactly one Cron profile: hobby or pro.");
}

const sourceUrl = new URL(`../config/vercel.${profile}.json`, import.meta.url);
const destinationUrl = new URL("../vercel.json", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const config = JSON.parse(source);
const cron = config?.crons?.[0];
if (
  !cron ||
  cron.path !== "/api/cron/monitor" ||
  typeof cron.schedule !== "string" ||
  !cron.schedule.trim()
) {
  throw new Error(`The ${profile} Cron template is invalid.`);
}

await copyFile(sourceUrl, destinationUrl);
console.log(
  `Selected the ${profile} Cron profile (${cron.schedule}). Set VERCEL_CRON_PROFILE=${profile}, review vercel.json, and redeploy.`,
);
console.log(`Updated ${fileURLToPath(destinationUrl)}`);
