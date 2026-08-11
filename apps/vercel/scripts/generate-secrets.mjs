import { randomBytes } from "node:crypto";

const sessionSecret = randomBytes(48).toString("base64url");
const encryptionKey = randomBytes(32).toString("base64url");
const cronSecret = randomBytes(32).toString("base64url");

console.log(`SESSION_SECRET=${sessionSecret}`);
console.log(`APP_ENCRYPTION_KEY=${encryptionKey}`);
console.log(`CRON_SECRET=${cronSecret}`);
