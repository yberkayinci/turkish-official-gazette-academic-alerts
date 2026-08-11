import { z } from "zod";
import { configuredAppSettingsSchema } from "./domain/settings";

export const loginRequestSchema = z
  .object({
    password: z.string().min(12).max(1_024),
  })
  .strict();

export const secretMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preserve") }).strict(),
  z.object({ action: z.literal("remove") }).strict(),
  z
    .object({
      action: z.literal("replace"),
      value: z.string().trim().min(16).max(1_024),
    })
    .strict(),
]);

export const settingsUpdateSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    settings: configuredAppSettingsSchema,
    geminiApiKey: secretMutationSchema.default({ action: "preserve" }),
    resendApiKey: secretMutationSchema.default({ action: "preserve" }),
  })
  .strict()
  .superRefine((request, context) => {
    if (
      request.geminiApiKey.action === "replace" &&
      (request.geminiApiKey.value.length < 20 ||
        request.geminiApiKey.value.length > 256 ||
        /[\s\u0000-\u001f\u007f]/.test(request.geminiApiKey.value))
    ) {
      context.addIssue({
        code: "custom",
        path: ["geminiApiKey", "value"],
        message: "The Gemini API key format is invalid.",
      });
    }
    if (
      request.resendApiKey.action === "replace" &&
      !/^re_[A-Za-z0-9_-]{12,}$/.test(request.resendApiKey.value)
    ) {
      context.addIssue({
        code: "custom",
        path: ["resendApiKey", "value"],
        message: "The Resend API key format is invalid.",
      });
    }
  });

export const confirmationRequestSchema = z
  .object({
    confirmation: z.string().min(1).max(100),
  })
  .strict();

export function formatValidationError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "The request is invalid.";
  const field = issue.path.join(".");
  return field ? `${field}: ${issue.message}` : issue.message;
}
