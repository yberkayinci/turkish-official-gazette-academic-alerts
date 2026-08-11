import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

const migrationsDirectory = fileURLToPath(new URL("../db/migrations", import.meta.url));
const sql = neon(databaseUrl);

await sql.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    migration_name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`);

const files = (await readdir(migrationsDirectory))
  .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name))
  .sort((left, right) => left.localeCompare(right, "en"));

for (const name of files) {
  const applied = await sql.query(
    "SELECT migration_name FROM schema_migrations WHERE migration_name = $1",
    [name],
  );
  if (applied.length) {
    console.log(`Already applied: ${name}`);
    continue;
  }

  const source = await readFile(path.join(migrationsDirectory, name), "utf8");
  const statements = source
    .split(/^\s*-- statement-breakpoint\s*$/m)
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await sql.query(statement);
  }
  await sql.query("INSERT INTO schema_migrations (migration_name) VALUES ($1)", [name]);
  console.log(`Applied: ${name}`);
}

console.log("Database migrations are up to date.");
