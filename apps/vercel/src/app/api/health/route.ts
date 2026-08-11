import { checkDatabaseHealth } from "@/lib/db";
import { getServerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    getServerEnv();
    const databaseReady = await checkDatabaseHealth();
    if (!databaseReady) throw new Error("Database health check failed.");
    return Response.json(
      { ok: true, data: { status: "ready", edition: "vercel-private" } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { ok: false, error: { code: "NOT_READY", message: "Service setup is incomplete." } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
