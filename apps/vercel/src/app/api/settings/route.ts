import { requireOwnerSession } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/csrf";
import { buildDashboardData } from "@/lib/dashboard";
import { ApiInputError, handleApiError, jsonSuccess, readJsonBody } from "@/lib/http";
import { testGeminiApiKey, testResendApiKey } from "@/lib/provider-tests";
import { getSettingsRepository } from "@/lib/repositories/settings";
import { getStateRepository } from "@/lib/repositories/state";
import { settingsUpdateSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function PUT(request: Request): Promise<Response> {
  try {
    requireOwnerSession(request);
    assertSameOrigin(request);
    const command = settingsUpdateSchema.parse(await readJsonBody(request));

    if (command.geminiApiKey.action === "replace") {
      try {
        await testGeminiApiKey(
          command.geminiApiKey.value,
          command.settings.customModel || "gemini-3.6-flash",
        );
      } catch {
        throw new ApiInputError(
          "Gemini could not verify the replacement API key and model.",
          "GEMINI_TEST_FAILED",
        );
      }
    }
    if (command.resendApiKey.action === "replace") {
      try {
        await testResendApiKey(command.resendApiKey.value);
      } catch {
        throw new ApiInputError(
          "Resend could not verify the replacement API key.",
          "RESEND_TEST_FAILED",
        );
      }
    }

    await getSettingsRepository().update(command);
    await getStateRepository().logActivity({
      eventType: "settings_saved",
      status: "success",
      message: "Dashboard settings were updated.",
      details: {
        monitoringEnabled: command.settings.monitoringEnabled,
        intervalHours: command.settings.checkIntervalHours,
        analysisMode: command.settings.aiMode,
      },
    });
    return jsonSuccess(
      { dashboard: await buildDashboardData(), detail: "Settings saved and verified." },
      "Settings saved and verified.",
    );
  } catch (error) {
    return handleApiError(error);
  }
}
