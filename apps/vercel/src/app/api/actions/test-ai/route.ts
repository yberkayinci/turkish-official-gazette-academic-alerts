import { z } from "zod";

import { recordRateLimitedAction } from "@/lib/action-limits";
import { requireOwnerSession } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/csrf";
import { buildDashboardData } from "@/lib/dashboard";
import { ApiInputError, handleApiError, jsonSuccess, readJsonBody } from "@/lib/http";
import { testGeminiApiKey } from "@/lib/provider-tests";
import { getSettingsRepository } from "@/lib/repositories/settings";
import { getStateRepository } from "@/lib/repositories/state";

export const dynamic = "force-dynamic";

const requestSchema = z
  .object({
    replacementKey: z
      .string()
      .trim()
      .min(20)
      .max(256)
      .refine((value) => !/[\s\u0000-\u001f\u007f]/.test(value), "The key format is invalid.")
      .optional(),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  try {
    requireOwnerSession(request);
    assertSameOrigin(request);
    const body = requestSchema.parse(await readJsonBody(request, 4_096));
    await recordRateLimitedAction("ai_test_requested", 5, 60 * 60 * 1_000, "AI connection test requested.");

    const runtime = await getSettingsRepository().getRuntimeSettings();
    const key = body.replacementKey || runtime.runtimeSecrets.geminiApiKey;
    if (!key) throw new ApiInputError("Add a Gemini API key before testing.", "GEMINI_KEY_REQUIRED");
    try {
      await testGeminiApiKey(key, runtime.settings.customModel || "gemini-3.6-flash");
    } catch {
      throw new ApiInputError("Gemini could not verify this API key and model.", "GEMINI_TEST_FAILED");
    }
    await getStateRepository().logActivity({
      eventType: "ai_test",
      status: "success",
      message: "Gemini connection verified successfully.",
    });
    return jsonSuccess({
      dashboard: await buildDashboardData(),
      detail: "Gemini connection verified.",
    });
  } catch (error) {
    return handleApiError(error);
  }
}
