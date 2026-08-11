import { z } from "zod";

import { recordRateLimitedAction } from "@/lib/action-limits";
import { requireOwnerSession } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/csrf";
import { buildDashboardData } from "@/lib/dashboard";
import { handleApiError, jsonSuccess, readJsonBody } from "@/lib/http";
import { runMonitor } from "@/lib/monitor/run";
import { getSettingsRepository } from "@/lib/repositories/settings";
import { getStateRepository } from "@/lib/repositories/state";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const requestSchema = z.object({ force: z.literal(false).optional() }).strict();

export async function POST(request: Request): Promise<Response> {
  try {
    requireOwnerSession(request);
    assertSameOrigin(request);
    requestSchema.parse(await readJsonBody(request, 1_024));
    await recordRateLimitedAction(
      "manual_check_requested",
      3,
      60 * 60 * 1_000,
      "Manual Official Gazette check requested.",
    );
    const result = await runMonitor(
      {
        settingsRepository: getSettingsRepository(),
        stateRepository: getStateRepository(),
      },
      { mode: "manual" },
    );
    return jsonSuccess({
      dashboard: await buildDashboardData(),
      detail: result.skipped
        ? `Check skipped: ${result.reason || "not due"}.`
        : `Check completed: ${result.publicationsProcessed} issue(s), ${result.emailsSent} email(s).`,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
