import { requireCronAuthorization } from "@/lib/csrf";
import { getServerEnv } from "@/lib/env";
import { handleApiError, jsonSuccess } from "@/lib/http";
import { runScheduledMonitor } from "@/lib/monitor/run";
import { getSettingsRepository } from "@/lib/repositories/settings";
import { getStateRepository } from "@/lib/repositories/state";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  try {
    requireCronAuthorization(request);
    const env = getServerEnv();
    const result = await runScheduledMonitor(
      {
        settingsRepository: getSettingsRepository(),
        stateRepository: getStateRepository(),
      },
      env.cronProfile === "hobby" ? "hobby_daily" : "pro_hourly",
    );
    return jsonSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}
