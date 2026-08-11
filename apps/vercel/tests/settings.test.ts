import { describe, expect, it } from "vitest";
import {
  DEFAULT_APP_SETTINGS,
  appSettingsSchema,
  parseStoredSettings,
  validateConfiguredSettings,
} from "@/lib/domain/settings";
import { settingsUpdateSchema } from "@/lib/validation";

function configuredSettings() {
  return {
    ...DEFAULT_APP_SETTINGS,
    senderEmail: "alerts@example.com",
    primaryRecipient: "owner@example.com",
  };
}

describe("application settings", () => {
  it("provides a safe, paused first-run default", () => {
    const settings = parseStoredSettings(null);
    expect(settings.monitoringEnabled).toBe(false);
    expect(settings.aiMode).toBe("off");
    expect(settings.checkIntervalHours).toBe(24);
    expect(settings.primaryRecipient).toBe("");
    expect(settings).not.toBe(DEFAULT_APP_SETTINGS);
  });

  it("trims and deduplicates list fields", () => {
    const result = appSettingsSchema.parse({
      ...configuredSettings(),
      requiredKeywords: ["  Yazılım  ", "yazılım", "Bilgisayar"],
      additionalRecipients: ["team@example.com", "TEAM@example.com"],
    });
    expect(result.requiredKeywords).toEqual(["Yazılım", "Bilgisayar"]);
    expect(result.additionalRecipients).toEqual(["team@example.com"]);
  });

  it("rejects invalid scheduling, addresses, duplicates, and unknown fields", () => {
    expect(() =>
      appSettingsSchema.parse({ ...configuredSettings(), activeStartHour: 20, activeEndHour: 8 }),
    ).toThrow();
    expect(() =>
      appSettingsSchema.parse({ ...configuredSettings(), primaryRecipient: "not-an-email" }),
    ).toThrow();
    expect(() =>
      appSettingsSchema.parse({
        ...configuredSettings(),
        additionalRecipients: ["owner@example.com"],
      }),
    ).toThrow(/must not be repeated/i);
    expect(() => appSettingsSchema.parse({ ...configuredSettings(), unexpected: true })).toThrow();
  });

  it("requires a sender and primary recipient before setup is considered complete", () => {
    expect(() => validateConfiguredSettings(DEFAULT_APP_SETTINGS)).toThrow();
    expect(validateConfiguredSettings(configuredSettings()).primaryRecipient).toBe(
      "owner@example.com",
    );
  });

  it("validates optimistic revisions and explicit secret mutations", () => {
    const valid = settingsUpdateSchema.parse({
      expectedRevision: 4,
      settings: { ...configuredSettings(), aiMode: "full" },
      geminiApiKey: { action: "replace", value: "test-gemini-key-not-a-secret-123456" },
      resendApiKey: { action: "replace", value: "re_" + "test_key_not_a_secret_123456" },
    });
    expect(valid.expectedRevision).toBe(4);
    expect(valid.geminiApiKey.action).toBe("replace");

    expect(() =>
      settingsUpdateSchema.parse({
        expectedRevision: -1,
        settings: configuredSettings(),
      }),
    ).toThrow();
    expect(() =>
      settingsUpdateSchema.parse({
        expectedRevision: 0,
        settings: configuredSettings(),
        resendApiKey: { action: "replace", value: "invalid-key-value" },
      }),
    ).toThrow(/Resend API key format/i);
  });
});
