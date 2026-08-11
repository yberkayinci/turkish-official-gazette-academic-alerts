import { createHash, randomUUID } from "node:crypto";

import { recordRateLimitedAction } from "@/lib/action-limits";
import { requireOwnerSession } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/csrf";
import { buildDashboardData } from "@/lib/dashboard";
import { ResendEmailSender } from "@/lib/email/resend";
import { ApiInputError, handleApiError, jsonSuccess, readJsonBody } from "@/lib/http";
import { getSettingsRepository } from "@/lib/repositories/settings";
import { getStateRepository } from "@/lib/repositories/state";

export const dynamic = "force-dynamic";

function fingerprint(value: string): string {
  return createHash("sha256").update(value.toLowerCase(), "utf8").digest("hex");
}

export async function POST(request: Request): Promise<Response> {
  try {
    requireOwnerSession(request);
    assertSameOrigin(request);
    await readJsonBody(request, 1_024);
    await recordRateLimitedAction(
      "test_email_requested",
      5,
      24 * 60 * 60 * 1_000,
      "Test email requested.",
    );

    const runtime = await getSettingsRepository().getRuntimeSettings();
    const apiKey = runtime.runtimeSecrets.resendApiKey;
    if (!apiKey) throw new ApiInputError("Add a Resend API key before testing email.", "RESEND_KEY_REQUIRED");
    if (!runtime.settings.senderEmail || !runtime.settings.primaryRecipient) {
      throw new ApiInputError("Save a verified sender and primary recipient first.", "EMAIL_SETUP_REQUIRED");
    }
    const sender = new ResendEmailSender({
      apiKey,
      from: `${runtime.settings.senderName} <${runtime.settings.senderEmail}>`,
    });
    const recipients = Array.from(
      new Set(
        [runtime.settings.primaryRecipient, ...runtime.settings.additionalRecipients]
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean),
      ),
    );
    const testId = `test-${Date.now()}-${randomUUID()}`;
    for (const recipient of recipients) {
      await sender.send({
        recipientEmail: recipient,
        recipientId: fingerprint(recipient),
        profileId: "default",
        publicationId: testId,
        reportVersion: "delivery-test-v1",
        email: {
          subject: "Official Gazette Monitor · Delivery test",
          html: [
            '<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#182230">',
            '<h1 style="font-size:24px">Email delivery is ready</h1>',
            '<p>This private Vercel deployment can send Official Gazette alerts to this saved recipient.</p>',
            '<p>No publication or AI analysis was included in this test.</p>',
            '<p style="color:#667085;font-size:13px">Independent monitoring tool · Always verify the official source.</p>',
            "</div>",
          ].join(""),
          text: [
            "Official Gazette Monitor — delivery test",
            "",
            "This private Vercel deployment can send alerts to this saved recipient.",
            "No publication or AI analysis was included in this test.",
          ].join("\n"),
        },
      });
    }
    await getStateRepository().logActivity({
      eventType: "test_email",
      status: "success",
      message: `Test email sent to ${recipients.length} saved recipient(s).`,
    });
    return jsonSuccess({
      dashboard: await buildDashboardData(),
      detail: `Test email sent to ${recipients.length} saved recipient(s).`,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
