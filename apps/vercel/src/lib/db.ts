import { neon } from "@neondatabase/serverless";
import { getServerEnv } from "./env";

export type QueryParameter = unknown;
export type DatabaseRow = Record<string, unknown>;

export interface Database {
  query<T extends DatabaseRow = DatabaseRow>(
    statement: string,
    parameters?: readonly QueryParameter[],
  ): Promise<T[]>;
}

class NeonDatabase implements Database {
  private readonly client;

  constructor(databaseUrl: string) {
    this.client = neon(databaseUrl);
  }

  async query<T extends DatabaseRow = DatabaseRow>(
    statement: string,
    parameters: readonly QueryParameter[] = [],
  ): Promise<T[]> {
    if (!statement.trim()) throw new Error("A database statement is required.");
    const rows = await this.client.query(statement, [...parameters]);
    return rows as T[];
  }
}

let database: Database | null = null;

export function getDatabase(): Database {
  if (!database) database = new NeonDatabase(getServerEnv().databaseUrl);
  return database;
}

export function setDatabaseForTests(value: Database | null): void {
  database = value;
}

export async function checkDatabaseHealth(db: Database = getDatabase()): Promise<boolean> {
  const rows = await db.query<{ ok: number }>("SELECT 1 AS ok");
  return rows[0]?.ok === 1;
}
