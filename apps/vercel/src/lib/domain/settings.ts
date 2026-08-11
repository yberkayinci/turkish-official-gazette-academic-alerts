import { z } from "zod";
import { ANALYSIS_MODES, DELIVERY_POLICIES, type AppSettings } from "./types";

const emailOrEmptySchema = z.union([z.literal(""), z.string().trim().email().max(254)]);
const keywordSchema = z.string().trim().min(1).max(100);

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase("tr-TR");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const keywordListSchema = z
  .array(keywordSchema)
  .max(30)
  .transform((values) => uniqueStrings(values));

export const appSettingsSchema = z
  .object({
    version: z.literal(1),
    monitoringEnabled: z.boolean(),
    checkIntervalHours: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(6),
      z.literal(8),
      z.literal(12),
      z.literal(24),
    ]),
    activeStartHour: z.number().int().min(0).max(23),
    activeEndHour: z.number().int().min(0).max(23),
    includeYesterday: z.boolean(),
    includeSupplements: z.boolean(),
    aiMode: z.enum(ANALYSIS_MODES),
    summarizeHeadlines: z.boolean(),
    customModel: z
      .string()
      .trim()
      .max(100)
      .refine(
        (value) => value === "" || /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value),
        "Model names may contain only letters, numbers, dots, underscores, and hyphens.",
      ),
    deliveryPolicy: z.enum(DELIVERY_POLICIES),
    senderName: z
      .string()
      .trim()
      .min(1)
      .max(70)
      .refine(
        (value) => !/[\u0000-\u001f\u007f]/.test(value),
        "The sender name cannot contain control characters.",
      ),
    senderEmail: emailOrEmptySchema,
    primaryRecipient: emailOrEmptySchema,
    additionalRecipients: z
      .array(z.string().trim().email().max(254))
      .max(2)
      .transform((values) => uniqueStrings(values)),
    notifyErrors: z.boolean(),
    notifyNoPublication: z.boolean(),
    includeHeadlines: z.boolean(),
    requiredKeywords: keywordListSchema,
    excludedKeywords: keywordListSchema,
    preferredInstitutions: keywordListSchema,
    includeCorrections: z.boolean(),
    includeCancellations: z.boolean(),
    includeUncertain: z.boolean(),
  })
  .strict()
  .superRefine((settings, context) => {
    if (settings.activeEndHour < settings.activeStartHour) {
      context.addIssue({
        code: "custom",
        path: ["activeEndHour"],
        message: "The active end hour must not be earlier than the start hour.",
      });
    }

    const primary = settings.primaryRecipient.toLocaleLowerCase("en-US");
    if (
      primary &&
      settings.additionalRecipients.some(
        (recipient) => recipient.toLocaleLowerCase("en-US") === primary,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["additionalRecipients"],
        message: "The primary recipient must not be repeated.",
      });
    }
  });

export const configuredAppSettingsSchema = appSettingsSchema.superRefine(
  (settings, context) => {
    if (!settings.primaryRecipient) {
      context.addIssue({
        code: "custom",
        path: ["primaryRecipient"],
        message: "A primary recipient is required.",
      });
    }
    if (!settings.senderEmail) {
      context.addIssue({
        code: "custom",
        path: ["senderEmail"],
        message: "A verified sender email is required.",
      });
    }
  },
);

export const DEFAULT_APP_SETTINGS: AppSettings = Object.freeze({
  version: 1,
  monitoringEnabled: false,
  checkIntervalHours: 24,
  activeStartHour: 6,
  activeEndHour: 23,
  includeYesterday: true,
  includeSupplements: true,
  aiMode: "off",
  summarizeHeadlines: true,
  customModel: "",
  deliveryPolicy: "matches_only",
  senderName: "Official Gazette Monitor",
  senderEmail: "",
  primaryRecipient: "",
  additionalRecipients: [],
  notifyErrors: true,
  notifyNoPublication: false,
  includeHeadlines: true,
  requiredKeywords: [],
  excludedKeywords: [],
  preferredInstitutions: [],
  includeCorrections: true,
  includeCancellations: true,
  includeUncertain: true,
});

export function parseStoredSettings(value: unknown): AppSettings {
  if (value === null || value === undefined) return appSettingsSchema.parse(DEFAULT_APP_SETTINGS);
  return appSettingsSchema.parse(value);
}

export function validateConfiguredSettings(value: unknown): AppSettings {
  return configuredAppSettingsSchema.parse(value);
}
